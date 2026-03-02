import { generateKeyBetween } from "fractional-indexing";
import { buildAtUri, TASK_COLLECTION } from "../shared/collections.js";
import {
  getBoard,
  getTasksByBoard,
  getOpsByBoard,
  getTrustsByBoard,
  getCommentsByBoard,
  getApprovalsByBoard,
  getReactionsByBoard,
  getPlacementsByBoard,
  getPlacementOpsByBoard,
  getBoardOpsByBoard,
  getTasksByUris,
  getTaskOpsByTaskUris,
  getTaskTrustsByTaskUri,
  type TaskRow,
  type OpRow,
  type PlacementRow,
  type PlacementOpRow,
  type TaskOpRow,
} from "../db/client.js";

interface OpFields {
  title?: string;
  description?: string;
  columnId?: string;
  position?: string;
  labelIds?: string[];
  order?: number;
}

// Legacy ops only contribute board-level fields.
// Task-level fields (title, description, labelIds) are only modifiable via TaskOps.
const LEGACY_BOARD_FIELDS: (keyof OpFields)[] = ["columnId", "position"];

function orderToPosition(order: number | undefined): string {
  if (order === undefined || order === null)
    return generateKeyBetween(null, null);
  const clamped = Math.min(Math.max(0, order), 10_000);
  let pos: string | null = null;
  for (let i = 0; i <= clamped; i++) {
    pos = generateKeyBetween(pos, null);
  }
  return pos!;
}

function isTrusted(
  userDid: string,
  boardOwnerDid: string,
  trustedDids: Set<string>,
): boolean {
  return userDid === boardOwnerDid || trustedDids.has(userDid);
}

interface MaterializedTask {
  uri: string;
  did: string;
  rkey: string;
  effectiveTitle: string;
  effectiveDescription: string | undefined;
  effectiveColumnId: string;
  effectivePosition: string;
  effectiveLabelIds: string[];
  createdAt: string;
  lastModifiedBy: string;
  lastModifiedAt: string;
}

function materializeTasks(
  tasks: TaskRow[],
  ops: OpRow[],
  boardOwnerDid: string,
  trustedDids: Set<string>,
): MaterializedTask[] {
  // Group ops by targetTaskUri
  const opsByTask = new Map<string, OpRow[]>();
  for (const op of ops) {
    const list = opsByTask.get(op.targetTaskUri) || [];
    list.push(op);
    opsByTask.set(op.targetTaskUri, list);
  }

  return tasks.map((task) => {
    const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
    const taskOps = opsByTask.get(taskUri) || [];

    // Only apply ops from trusted sources
    const appliedOps = taskOps.filter(
      (op) =>
        op.did === boardOwnerDid ||
        op.did === task.did ||
        isTrusted(op.did, boardOwnerDid, trustedDids),
    );

    // Seed field states from base task values
    const fieldStates: Record<
      string,
      { value: unknown; timestamp: string; author: string }
    > = {};

    // Board-level fields
    for (const field of LEGACY_BOARD_FIELDS) {
      let value: unknown = task[field as keyof TaskRow];
      if (field === "position" && !value) {
        value = orderToPosition(task.order ?? undefined);
      }
      fieldStates[field] = {
        value,
        timestamp: task.createdAt,
        author: task.did,
      };
    }

    // Task-level fields (seeded from base task, not modified by legacy ops)
    let labelIds = task.labelIds;
    if (typeof labelIds === "string") {
      labelIds = JSON.parse(labelIds);
    }
    fieldStates.title = {
      value: task.title,
      timestamp: task.createdAt,
      author: task.did,
    };
    fieldStates.description = {
      value: task.description,
      timestamp: task.createdAt,
      author: task.did,
    };
    fieldStates.labelIds = {
      value: labelIds,
      timestamp: task.createdAt,
      author: task.did,
    };

    // Apply legacy ops — only board-level fields (columnId, position)
    const sortedOps = [...appliedOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    for (const op of sortedOps) {
      const fields: OpFields =
        typeof op.fields === "string" ? JSON.parse(op.fields) : op.fields;
      for (const field of LEGACY_BOARD_FIELDS) {
        const opValue = fields[field];
        if (opValue !== undefined) {
          const current = fieldStates[field];
          if (op.createdAt > current.timestamp) {
            fieldStates[field] = {
              value: opValue,
              timestamp: op.createdAt,
              author: op.did,
            };
          }
        }
      }
    }

    let lastModifiedBy = task.did;
    let lastModifiedAt = task.updatedAt || task.createdAt;
    for (const field of [
      ...LEGACY_BOARD_FIELDS,
      "title",
      "description",
      "labelIds",
    ]) {
      if (fieldStates[field].timestamp > lastModifiedAt) {
        lastModifiedAt = fieldStates[field].timestamp;
        lastModifiedBy = fieldStates[field].author;
      }
    }

    return {
      uri: taskUri,
      did: task.did,
      rkey: task.rkey,
      effectiveTitle: fieldStates.title.value as string,
      effectiveDescription: fieldStates.description.value as string | undefined,
      effectiveColumnId: fieldStates.columnId.value as string,
      effectivePosition: fieldStates.position.value as string,
      effectiveLabelIds:
        (fieldStates.labelIds.value as string[] | undefined) ?? [],
      createdAt: task.createdAt,
      lastModifiedBy,
      lastModifiedAt,
    };
  });
}

export interface BoardResponse {
  board: {
    uri: string;
    did: string;
    rkey: string;
    name: string;
    description: string | null;
    columns: unknown[];
    labels: unknown[];
    open: boolean;
    createdAt: string;
  };
  tasks: MaterializedTask[];
  rawTasks: Array<{
    uri: string;
    did: string;
    rkey: string;
    title: string;
    description: string | null;
    status: string | null;
    open: boolean;
    labelIds: string[] | null;
    forkedFrom: string | null;
    // Legacy fields
    columnId: string | null;
    boardUri: string | null;
    position: string | null;
    order: number | null;
    createdAt: string;
    updatedAt: string | null;
  }>;
  rawOps: Array<{
    uri: string;
    did: string;
    rkey: string;
    targetTaskUri: string;
    boardUri: string;
    fields: unknown;
    createdAt: string;
  }>;
  // New: explicit placements and placement ops
  placements: Array<{
    uri: string;
    did: string;
    rkey: string;
    taskUri: string;
    boardUri: string;
    columnId: string;
    position: string;
    createdAt: string;
  }>;
  placementOps: Array<{
    uri: string;
    did: string;
    rkey: string;
    targetPlacementUri: string;
    boardUri: string;
    fields: unknown;
    createdAt: string;
  }>;
  // New: task ops (task-level field changes)
  taskOps: Array<{
    uri: string;
    did: string;
    rkey: string;
    targetTaskUri: string;
    fields: unknown;
    createdAt: string;
  }>;
  // New: task trusts
  taskTrusts: Array<{
    uri: string;
    did: string;
    rkey: string;
    taskUri: string;
    trustedDid: string;
    createdAt: string;
  }>;
  comments: Array<{
    uri: string;
    did: string;
    rkey: string;
    targetTaskUri: string;
    text: string;
    createdAt: string;
  }>;
  approvals: Array<{
    uri: string;
    did: string;
    rkey: string;
    targetUri: string;
    createdAt: string;
  }>;
  reactions: Array<{
    uri: string;
    did: string;
    rkey: string;
    targetTaskUri: string;
    emoji: string;
    createdAt: string;
  }>;
  trusts: Array<{
    uri: string;
    did: string;
    rkey: string;
    trustedDid: string;
    createdAt: string;
  }>;
  boardOps: Array<{
    uri: string;
    did: string;
    rkey: string;
    targetBoardUri: string;
    fields: unknown;
    createdAt: string;
  }>;
}

export function getBoardData(did: string, rkey: string): BoardResponse | null {
  const boardRow = getBoard(did, rkey);
  if (!boardRow) return null;

  const boardUri = boardRow.uri;

  // Fetch legacy data (old board-coupled tasks + ops)
  const legacyTaskRows = getTasksByBoard(boardUri);
  const opRows = getOpsByBoard(boardUri);
  const trustRows = getTrustsByBoard(boardUri);
  const commentRows = getCommentsByBoard(boardUri);
  const approvalRows = getApprovalsByBoard(boardUri);
  const reactionRows = getReactionsByBoard(boardUri);

  // Fetch new-format data (explicit placements + placement ops + board ops)
  const placementRows = getPlacementsByBoard(boardUri);
  const placementOpRows = getPlacementOpsByBoard(boardUri);
  const boardOpRows = getBoardOpsByBoard(boardUri);

  // Collect all task URIs from placements to fetch standalone tasks
  const placementTaskUris = placementRows.map((p) => p.taskUri);
  const standaloneTasks = getTasksByUris(placementTaskUris);

  // Merge legacy + standalone tasks (deduplicate by URI)
  const allTaskUriSet = new Set<string>();
  const allTaskRows: TaskRow[] = [];
  for (const t of legacyTaskRows) {
    const uri = buildAtUri(t.did, TASK_COLLECTION, t.rkey);
    if (!allTaskUriSet.has(uri)) {
      allTaskUriSet.add(uri);
      allTaskRows.push(t);
    }
  }
  for (const t of standaloneTasks) {
    if (!allTaskUriSet.has(t.uri)) {
      allTaskUriSet.add(t.uri);
      allTaskRows.push(t);
    }
  }

  // Fetch task ops for all tasks in this board
  const allTaskUris = Array.from(allTaskUriSet);
  const taskOpRows = getTaskOpsByTaskUris(allTaskUris);

  // Collect task trusts for all tasks
  const allTaskTrustRows: Array<{
    uri: string;
    did: string;
    rkey: string;
    taskUri: string;
    trustedDid: string;
    createdAt: string;
  }> = [];
  for (const taskUri of allTaskUris) {
    const trusts = getTaskTrustsByTaskUri(taskUri);
    allTaskTrustRows.push(...trusts);
  }

  const trustedDids = new Set(
    trustRows.filter((t) => t.did === did).map((t) => t.trustedDid),
  );

  // Materialize legacy tasks (tasks with boardUri) using legacy ops
  const legacyMaterialized = materializeTasks(
    legacyTaskRows,
    opRows,
    did,
    trustedDids,
  );

  return {
    board: {
      uri: boardUri,
      did: boardRow.did,
      rkey: boardRow.rkey,
      name: boardRow.name,
      description: boardRow.description,
      columns: JSON.parse(boardRow.columns),
      labels: JSON.parse(boardRow.labels),
      open: boardRow.open === 1,
      createdAt: boardRow.createdAt,
    },
    tasks: legacyMaterialized,
    rawTasks: allTaskRows.map((t) => ({
      uri: t.uri,
      did: t.did,
      rkey: t.rkey,
      title: t.title,
      description: t.description,
      status: t.status,
      open: t.open === 1,
      labelIds: t.labelIds ? JSON.parse(t.labelIds) : null,
      forkedFrom: t.forkedFrom,
      columnId: t.columnId,
      boardUri: t.boardUri,
      position: t.position,
      order: t.order,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    rawOps: opRows.map((o) => ({
      uri: o.uri,
      did: o.did,
      rkey: o.rkey,
      targetTaskUri: o.targetTaskUri,
      boardUri: o.boardUri,
      fields: typeof o.fields === "string" ? JSON.parse(o.fields) : o.fields,
      createdAt: o.createdAt,
    })),
    placements: placementRows.map((p) => ({
      uri: p.uri,
      did: p.did,
      rkey: p.rkey,
      taskUri: p.taskUri,
      boardUri: p.boardUri,
      columnId: p.columnId,
      position: p.position,
      createdAt: p.createdAt,
    })),
    placementOps: placementOpRows.map((po) => ({
      uri: po.uri,
      did: po.did,
      rkey: po.rkey,
      targetPlacementUri: po.targetPlacementUri,
      boardUri: po.boardUri,
      fields: typeof po.fields === "string" ? JSON.parse(po.fields) : po.fields,
      createdAt: po.createdAt,
    })),
    taskOps: taskOpRows.map((to) => ({
      uri: to.uri,
      did: to.did,
      rkey: to.rkey,
      targetTaskUri: to.targetTaskUri,
      fields: typeof to.fields === "string" ? JSON.parse(to.fields) : to.fields,
      createdAt: to.createdAt,
    })),
    taskTrusts: allTaskTrustRows,
    comments: commentRows.map((c) => ({
      uri: c.uri,
      did: c.did,
      rkey: c.rkey,
      targetTaskUri: c.targetTaskUri,
      text: c.text,
      createdAt: c.createdAt,
    })),
    approvals: approvalRows.map((a) => ({
      uri: a.uri,
      did: a.did,
      rkey: a.rkey,
      targetUri: a.targetUri,
      createdAt: a.createdAt,
    })),
    reactions: reactionRows.map((r) => ({
      uri: r.uri,
      did: r.did,
      rkey: r.rkey,
      targetTaskUri: r.targetTaskUri,
      emoji: r.emoji,
      createdAt: r.createdAt,
    })),
    trusts: trustRows.map((t) => ({
      uri: t.uri,
      did: t.did,
      rkey: t.rkey,
      trustedDid: t.trustedDid,
      createdAt: t.createdAt,
    })),
    boardOps: boardOpRows.map((bo) => ({
      uri: bo.uri,
      did: bo.did,
      rkey: bo.rkey,
      targetBoardUri: bo.targetBoardUri,
      fields: typeof bo.fields === "string" ? JSON.parse(bo.fields) : bo.fields,
      createdAt: bo.createdAt,
    })),
  };
}

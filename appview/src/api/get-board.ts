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
  type TaskRow,
  type OpRow,
  type BoardRow,
} from "../db/client.js";

interface OpFields {
  title?: string;
  description?: string;
  columnId?: string;
  position?: string;
  labelIds?: string[];
  order?: number;
}

const MUTABLE_FIELDS: (keyof OpFields)[] = [
  "title",
  "description",
  "columnId",
  "position",
  "labelIds",
];

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

    // Start with base task values
    const fieldStates: Record<
      string,
      { value: unknown; timestamp: string; author: string }
    > = {};
    for (const field of MUTABLE_FIELDS) {
      let value: unknown = task[field as keyof TaskRow];
      if (field === "labelIds" && typeof value === "string") {
        value = JSON.parse(value);
      }
      if (field === "position" && !value) {
        value = orderToPosition(task.order ?? undefined);
      }
      fieldStates[field] = {
        value,
        timestamp: task.createdAt,
        author: task.did,
      };
    }

    // Apply ops using LWW per field
    const sortedOps = [...appliedOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    for (const op of sortedOps) {
      const fields: OpFields =
        typeof op.fields === "string" ? JSON.parse(op.fields) : op.fields;
      for (const field of MUTABLE_FIELDS) {
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
    for (const field of MUTABLE_FIELDS) {
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
      effectiveDescription: fieldStates.description.value as
        | string
        | undefined,
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
    columnId: string;
    boardUri: string;
    position: string | null;
    labelIds: string[] | null;
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
}

export function getBoardData(
  did: string,
  rkey: string,
): BoardResponse | null {
  const boardRow = getBoard(did, rkey);
  if (!boardRow) return null;

  const boardUri = boardRow.uri;
  const taskRows = getTasksByBoard(boardUri);
  const opRows = getOpsByBoard(boardUri);
  const trustRows = getTrustsByBoard(boardUri);
  const commentRows = getCommentsByBoard(boardUri);
  const approvalRows = getApprovalsByBoard(boardUri);
  const reactionRows = getReactionsByBoard(boardUri);

  const trustedDids = new Set(
    trustRows
      .filter((t) => t.did === did)
      .map((t) => t.trustedDid),
  );

  const tasks = materializeTasks(taskRows, opRows, did, trustedDids);

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
    tasks,
    rawTasks: taskRows.map((t) => ({
      uri: t.uri,
      did: t.did,
      rkey: t.rkey,
      title: t.title,
      description: t.description,
      columnId: t.columnId,
      boardUri: t.boardUri,
      position: t.position,
      labelIds: t.labelIds ? JSON.parse(t.labelIds) : null,
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
  };
}

import { buildAtUri, TASK_COLLECTION } from "./tid.js";
import { generateKeyBetween } from "fractional-indexing";
import type { Task, Op, OpFields, MaterializedTask } from "./types.js";
import { isTrusted } from "./permissions.js";

const MUTABLE_FIELDS: (keyof OpFields)[] = [
  "title",
  "description",
  "columnId",
  "position",
  "labelIds",
];

/**
 * Convert a legacy integer order to a fractional index position string.
 * Generates a position that maintains relative ordering.
 */
function orderToPosition(order: number | undefined): string {
  if (order === undefined || order === null)
    return generateKeyBetween(null, null);
  // Generate a chain of positions: null -> pos0 -> pos1 -> ... -> posN
  let pos: string | null = null;
  for (let i = 0; i <= order; i++) {
    pos = generateKeyBetween(pos, null);
  }
  return pos!;
}

interface FieldState {
  value: unknown;
  timestamp: string;
  author: string;
}

export function materializeTasks(
  tasks: Task[],
  ops: Op[],
  ownerTrustedDids: Set<string>,
  currentUserDid: string,
  boardOwnerDid: string,
): MaterializedTask[] {
  // Deduplicate tasks by did+rkey (sync race conditions can create duplicates)
  const seenTasks = new Set<string>();
  const uniqueTasks = tasks.filter((task) => {
    const key = `${task.did}:${task.rkey}`;
    if (seenTasks.has(key)) return false;
    seenTasks.add(key);
    return true;
  });

  // Group ops by targetTaskUri
  const opsByTask = new Map<string, Op[]>();
  for (const op of ops) {
    const list = opsByTask.get(op.targetTaskUri) || [];
    list.push(op);
    opsByTask.set(op.targetTaskUri, list);
  }

  return uniqueTasks.map((task) => {
    const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
    const taskOps = opsByTask.get(taskUri) || [];

    // Only apply ops from trusted sources: board owner, task owner, trusted users, current user
    // All other ops are ignored entirely
    const appliedOps: Op[] = [];

    for (const op of taskOps) {
      if (
        op.did === boardOwnerDid ||
        op.did === task.did ||
        op.did === currentUserDid ||
        isTrusted(op.did, boardOwnerDid, ownerTrustedDids)
      ) {
        appliedOps.push(op);
      }
    }

    // Start with base task values
    const fieldStates: Record<string, FieldState> = {};
    for (const field of MUTABLE_FIELDS) {
      let value: unknown = task[field as keyof Task];
      // Backward compat: derive position from legacy order if not set
      if (field === "position" && !value) {
        value = orderToPosition(task.order);
      }
      fieldStates[field] = {
        value,
        timestamp: task.createdAt,
        author: task.did,
      };
    }

    // Apply trusted ops using LWW per field (sort ascending, later overwrites)
    const sortedOps = [...appliedOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    for (const op of sortedOps) {
      for (const field of MUTABLE_FIELDS) {
        const opValue = op.fields[field];
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

    // Find the last modifier
    let lastModifiedBy = task.did;
    let lastModifiedAt = task.updatedAt || task.createdAt;
    for (const field of MUTABLE_FIELDS) {
      if (fieldStates[field].timestamp > lastModifiedAt) {
        lastModifiedAt = fieldStates[field].timestamp;
        lastModifiedBy = fieldStates[field].author;
      }
    }

    return {
      rkey: task.rkey,
      did: task.did,
      title: task.title,
      description: task.description,
      columnId: task.columnId,
      boardUri: task.boardUri,
      position: task.position,
      labelIds: task.labelIds,
      order: task.order,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      sourceTask: task,
      appliedOps,
      pendingOps: [],
      effectiveTitle: fieldStates.title.value as string,
      effectiveDescription: fieldStates.description.value as string | undefined,
      effectiveColumnId: fieldStates.columnId.value as string,
      effectivePosition: fieldStates.position.value as string,
      effectiveLabelIds: (fieldStates.labelIds.value as string[] | undefined) ?? [],
      ownerDid: task.did,
      lastModifiedBy,
      lastModifiedAt,
    };
  });
}

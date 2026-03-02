import { buildAtUri, TASK_COLLECTION, PLACEMENT_COLLECTION } from "./tid.js";
import { generateKeyBetween } from "fractional-indexing";
import type {
  Task,
  Op,
  OpFields,
  TaskOp,
  TaskOpFields,
  Placement,
  PlacementOp,
  PlacementOpFields,
  MaterializedTask,
  MaterializedPlacement,
  TaskStatus,
} from "./types.js";
import { isTrusted, isTaskTrusted } from "./permissions.js";

const TASK_MUTABLE_FIELDS: (keyof TaskOpFields)[] = [
  "title",
  "description",
  "labelIds",
  "status",
];

const LEGACY_MUTABLE_FIELDS: (keyof OpFields)[] = [
  "title",
  "description",
  "columnId",
  "position",
  "labelIds",
];

const PLACEMENT_MUTABLE_FIELDS: (keyof PlacementOpFields)[] = [
  "columnId",
  "position",
  "removed",
];

/**
 * Convert a legacy integer order to a fractional index position string.
 * Generates a position that maintains relative ordering.
 */
function orderToPosition(order: number | undefined): string {
  if (order === undefined || order === null)
    return generateKeyBetween(null, null);
  // Clamp to prevent DoS via huge order values
  const clamped = Math.min(Math.max(0, order), 10_000);
  // Generate a chain of positions: null -> pos0 -> pos1 -> ... -> posN
  let pos: string | null = null;
  for (let i = 0; i <= clamped; i++) {
    pos = generateKeyBetween(pos, null);
  }
  return pos!;
}

interface FieldState {
  value: unknown;
  timestamp: string;
  author: string;
}

/**
 * Materialize tasks using both legacy ops and new TaskOps.
 *
 * For task-level fields (title, description, labelIds, status):
 * - Legacy ops and new TaskOps are both applied
 * - Task permission model: task author, task-trusted DIDs, or task.open
 * - Falls back to board trust for legacy ops
 *
 * For board-level fields (columnId, position) from legacy ops:
 * - Still applied here for backward compat
 * - New placements/placementOps handle this separately
 */
export function materializeTasks(
  tasks: Task[],
  legacyOps: Op[],
  taskOps: TaskOp[],
  ownerTrustedDids: Set<string>,
  currentUserDid: string,
  boardOwnerDid: string,
  taskTrustsByTask?: Map<string, Set<string>>,
): MaterializedTask[] {
  // Deduplicate tasks by did+rkey (sync race conditions can create duplicates)
  const seenTasks = new Set<string>();
  const uniqueTasks = tasks.filter((task) => {
    const key = `${task.did}:${task.rkey}`;
    if (seenTasks.has(key)) return false;
    seenTasks.add(key);
    return true;
  });

  // Group legacy ops by targetTaskUri
  const legacyOpsByTask = new Map<string, Op[]>();
  for (const op of legacyOps) {
    const list = legacyOpsByTask.get(op.targetTaskUri) || [];
    list.push(op);
    legacyOpsByTask.set(op.targetTaskUri, list);
  }

  // Group new task ops by targetTaskUri
  const taskOpsByTask = new Map<string, TaskOp[]>();
  for (const op of taskOps) {
    const list = taskOpsByTask.get(op.targetTaskUri) || [];
    list.push(op);
    taskOpsByTask.set(op.targetTaskUri, list);
  }

  return uniqueTasks.map((task) => {
    const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
    const taskLegacyOps = legacyOpsByTask.get(taskUri) || [];
    const taskNewOps = taskOpsByTask.get(taskUri) || [];

    // Get task-level trust set
    const taskTrustedDids = taskTrustsByTask?.get(taskUri) ?? new Set<string>();

    // Filter legacy ops: board-trusted sources
    const appliedLegacyOps: Op[] = [];
    for (const op of taskLegacyOps) {
      if (
        op.did === boardOwnerDid ||
        op.did === task.did ||
        op.did === currentUserDid ||
        isTrusted(op.did, boardOwnerDid, ownerTrustedDids)
      ) {
        appliedLegacyOps.push(op);
      }
    }

    // Filter new task ops: task-trusted sources
    const appliedTaskOps: TaskOp[] = [];
    for (const op of taskNewOps) {
      if (
        isTaskTrusted(op.did, task.did, taskTrustedDids, task.open) ||
        op.did === currentUserDid
      ) {
        appliedTaskOps.push(op);
      }
    }

    // Start with base task values for all legacy fields
    const fieldStates: Record<string, FieldState> = {};
    for (const field of LEGACY_MUTABLE_FIELDS) {
      let value: unknown = task[field as keyof Task];
      if (field === "position" && !value) {
        value = orderToPosition(task.order);
      }
      fieldStates[field] = {
        value,
        timestamp: task.createdAt,
        author: task.did,
      };
    }

    // Add status field
    fieldStates.status = {
      value: task.status ?? "open",
      timestamp: task.createdAt,
      author: task.did,
    };

    // Apply legacy ops using LWW per field (sort ascending, later overwrites)
    const sortedLegacyOps = [...appliedLegacyOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    for (const op of sortedLegacyOps) {
      for (const field of LEGACY_MUTABLE_FIELDS) {
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

    // Apply new task ops (task-level fields only)
    const sortedTaskOps = [...appliedTaskOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    for (const op of sortedTaskOps) {
      for (const field of TASK_MUTABLE_FIELDS) {
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
    for (const field of [...LEGACY_MUTABLE_FIELDS, "status"]) {
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
      status: task.status,
      open: task.open,
      columnId: task.columnId,
      boardUri: task.boardUri,
      position: task.position,
      labelIds: task.labelIds,
      order: task.order,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      sourceTask: task,
      appliedOps: [...appliedLegacyOps, ...appliedTaskOps],
      pendingOps: [],
      effectiveTitle: fieldStates.title.value as string,
      effectiveDescription: fieldStates.description.value as string | undefined,
      effectiveStatus: (fieldStates.status.value as TaskStatus) ?? "open",
      effectiveLabelIds:
        (fieldStates.labelIds.value as string[] | undefined) ?? [],
      effectiveColumnId: fieldStates.columnId?.value as string | undefined,
      effectivePosition: fieldStates.position?.value as string | undefined,
      ownerDid: task.did,
      lastModifiedBy,
      lastModifiedAt,
    };
  });
}

/**
 * Materialize placements using PlacementOps.
 * Uses per-field LWW on columnId, position, and removed.
 * Permission: board owner or board-trusted users.
 */
export function materializePlacements(
  placements: Placement[],
  placementOps: PlacementOp[],
  boardOwnerDid: string,
  boardTrustedDids: Set<string>,
  currentUserDid: string,
): MaterializedPlacement[] {
  // Group placement ops by targetPlacementUri
  const opsByPlacement = new Map<string, PlacementOp[]>();
  for (const op of placementOps) {
    const list = opsByPlacement.get(op.targetPlacementUri) || [];
    list.push(op);
    opsByPlacement.set(op.targetPlacementUri, list);
  }

  return placements.map((placement) => {
    const placementUri = buildAtUri(
      placement.did,
      PLACEMENT_COLLECTION,
      placement.rkey,
    );
    const ops = opsByPlacement.get(placementUri) || [];

    // Filter ops: only board-trusted sources
    const appliedOps = ops.filter(
      (op) =>
        op.did === boardOwnerDid ||
        op.did === currentUserDid ||
        isTrusted(op.did, boardOwnerDid, boardTrustedDids),
    );

    // Start with base placement values
    const fieldStates: Record<string, FieldState> = {
      columnId: {
        value: placement.columnId,
        timestamp: placement.createdAt,
        author: placement.did,
      },
      position: {
        value: placement.position,
        timestamp: placement.createdAt,
        author: placement.did,
      },
      removed: {
        value: false,
        timestamp: placement.createdAt,
        author: placement.did,
      },
    };

    // Apply ops using LWW per field
    const sortedOps = [...appliedOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    for (const op of sortedOps) {
      for (const field of PLACEMENT_MUTABLE_FIELDS) {
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

    let lastModifiedBy = placement.did;
    let lastModifiedAt = placement.createdAt;
    for (const field of PLACEMENT_MUTABLE_FIELDS) {
      if (fieldStates[field].timestamp > lastModifiedAt) {
        lastModifiedAt = fieldStates[field].timestamp;
        lastModifiedBy = fieldStates[field].author;
      }
    }

    return {
      rkey: placement.rkey,
      did: placement.did,
      taskUri: placement.taskUri,
      boardUri: placement.boardUri,
      sourcePlacement: placement,
      appliedOps,
      effectiveColumnId: fieldStates.columnId.value as string,
      effectivePosition: fieldStates.position.value as string,
      effectiveRemoved: (fieldStates.removed.value as boolean) ?? false,
      lastModifiedBy,
      lastModifiedAt,
    };
  });
}

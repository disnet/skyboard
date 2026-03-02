import {
  buildAtUri,
  BOARD_COLLECTION,
  TASK_COLLECTION,
  TASK_OP_COLLECTION,
  PLACEMENT_COLLECTION,
  PROJECT_COLLECTION,
  COMMENT_COLLECTION,
} from "./tid.js";
import { generateKeyBetween } from "fractional-indexing";
import type {
  Board,
  BoardOp,
  BoardOpFields,
  Task,
  Op,
  OpFields,
  TaskOp,
  TaskOpFields,
  Placement,
  PlacementOp,
  PlacementOpFields,
  Project,
  ProjectOp,
  Comment,
  CommentOp,
  Column,
  MaterializedBoard,
  MaterializedTask,
  MaterializedPlacement,
  MaterializedProject,
  MaterializedComment,
  TaskStatus,
} from "./types.js";
import { isTrusted, isTaskTrusted } from "./permissions.js";

const TASK_MUTABLE_FIELDS: (keyof TaskOpFields)[] = [
  "title",
  "description",
  "labelIds",
  "labelUris",
  "status",
];

// Legacy ops only contribute board-level fields (columnId, position).
// Task-level fields (title, description, labelIds) are only modifiable via TaskOps.
const LEGACY_BOARD_FIELDS: (keyof OpFields)[] = ["columnId", "position"];

const BOARD_MUTABLE_FIELDS: (keyof BoardOpFields)[] = [
  "name",
  "description",
  "columns",
  "labelUris",
  "open",
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
 * Materialize boards by merging base board records with BoardOps.
 * Uses per-field LWW on name, description, columns, labelUris, open.
 * Permission: board owner or board-trusted users.
 *
 * Columns are immutable — they can be archived (archived: true) but never
 * removed, so existing placements always reference valid column IDs.
 */
export function materializeBoards(
  boards: Board[],
  boardOps: BoardOp[],
  trustedByBoard: Map<string, Set<string>>,
  currentUserDid: string,
): MaterializedBoard[] {
  const opsByBoard = new Map<string, BoardOp[]>();
  for (const op of boardOps) {
    const list = opsByBoard.get(op.targetBoardUri) || [];
    list.push(op);
    opsByBoard.set(op.targetBoardUri, list);
  }

  return boards.map((board) => {
    const boardUri = buildAtUri(board.did, BOARD_COLLECTION, board.rkey);
    const ops = opsByBoard.get(boardUri) || [];
    const trustedDids = trustedByBoard.get(boardUri) ?? new Set<string>();

    const appliedOps = ops.filter((op) =>
      isTrusted(op.did, board.did, trustedDids),
    );

    const fields: Record<string, FieldState> = {
      name: {
        value: board.name,
        timestamp: board.createdAt,
        author: board.did,
      },
      description: {
        value: board.description,
        timestamp: board.createdAt,
        author: board.did,
      },
      columns: {
        value: board.columns,
        timestamp: board.createdAt,
        author: board.did,
      },
      labelUris: {
        value: board.labelUris ?? ([] as string[]),
        timestamp: board.createdAt,
        author: board.did,
      },
      open: {
        value: board.open ?? false,
        timestamp: board.createdAt,
        author: board.did,
      },
    };

    const sorted = [...appliedOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    for (const op of sorted) {
      for (const field of BOARD_MUTABLE_FIELDS) {
        const val = op.fields[field];
        if (val !== undefined && op.createdAt > fields[field].timestamp) {
          fields[field] = {
            value: val,
            timestamp: op.createdAt,
            author: op.did,
          };
        }
      }
    }

    let lastModifiedBy = board.did;
    let lastModifiedAt = board.createdAt;
    for (const field of BOARD_MUTABLE_FIELDS) {
      if (fields[field].timestamp > lastModifiedAt) {
        lastModifiedAt = fields[field].timestamp;
        lastModifiedBy = fields[field].author;
      }
    }

    return {
      rkey: board.rkey,
      did: board.did,
      sourceBoard: board,
      appliedOps,
      effectiveName: fields.name.value as string,
      effectiveDescription: fields.description.value as string | undefined,
      effectiveColumns: fields.columns.value as Column[],
      effectiveLabelUris: (fields.labelUris.value as string[]) ?? [],
      effectiveOpen: (fields.open.value as boolean) ?? false,
      lastModifiedBy,
      lastModifiedAt,
    };
  });
}

/**
 * Materialize tasks using both legacy ops and new TaskOps.
 *
 * For task-level fields (title, description, labelIds, labelUris, status):
 * - Only TaskOps can modify task-level fields (legacy ops restricted to board fields)
 * - Task permission: task author, task-trusted DIDs, or assigned users
 * - Open tasks: untrusted TaskOps go to pending unless approved
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
  assignmentsByTask?: Map<string, Set<string>>,
  approvedUris?: Set<string>,
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

    // Get task-level trust and assignment sets
    const taskTrustedDids = taskTrustsByTask?.get(taskUri) ?? new Set<string>();
    const assignedDids = assignmentsByTask?.get(taskUri) ?? new Set<string>();

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

    // Filter new task ops: task-trusted or approved on open tasks
    const appliedTaskOps: TaskOp[] = [];
    const pendingTaskOps: TaskOp[] = [];
    for (const op of taskNewOps) {
      if (
        isTaskTrusted(op.did, task.did, taskTrustedDids, assignedDids) ||
        op.did === currentUserDid
      ) {
        appliedTaskOps.push(op);
      } else if (task.open) {
        // Open task: check if this op has been approved
        const opUri = buildAtUri(op.did, TASK_OP_COLLECTION, op.rkey);
        if (approvedUris?.has(opUri)) {
          appliedTaskOps.push(op);
        } else {
          pendingTaskOps.push(op);
        }
      }
      // Closed task + untrusted = silently ignored
    }

    // Seed field states from base task values
    const fieldStates: Record<string, FieldState> = {};

    // Board-level fields (from legacy ops and base task)
    for (const field of LEGACY_BOARD_FIELDS) {
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

    // Task-level fields (only modifiable by TaskOps)
    for (const field of TASK_MUTABLE_FIELDS) {
      let value: unknown = task[field as keyof Task];
      if (field === "status" && value === undefined) {
        value = "open";
      }
      fieldStates[field] = {
        value,
        timestamp: task.createdAt,
        author: task.did,
      };
    }

    // Apply legacy ops — only board-level fields (columnId, position)
    const sortedLegacyOps = [...appliedLegacyOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    for (const op of sortedLegacyOps) {
      for (const field of LEGACY_BOARD_FIELDS) {
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

    // Apply task ops — task-level fields only (title, description, labelIds, status)
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

    // Find the last modifier across all fields
    let lastModifiedBy = task.did;
    let lastModifiedAt = task.updatedAt || task.createdAt;
    for (const field of [...LEGACY_BOARD_FIELDS, ...TASK_MUTABLE_FIELDS]) {
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
      labelUris: task.labelUris,
      order: task.order,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      sourceTask: task,
      appliedOps: [...appliedLegacyOps, ...appliedTaskOps],
      pendingOps: pendingTaskOps,
      effectiveTitle: fieldStates.title.value as string,
      effectiveDescription: fieldStates.description.value as string | undefined,
      effectiveStatus: (fieldStates.status.value as TaskStatus) ?? "open",
      effectiveLabelIds:
        (fieldStates.labelIds.value as string[] | undefined) ?? [],
      effectiveLabelUris:
        (fieldStates.labelUris.value as string[] | undefined) ?? [],
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

/**
 * Materialize projects using ProjectOps.
 * Uses per-field LWW on name, description, labelUris.
 * Permission: project author or project-trusted users.
 */
export function materializeProjects(
  projects: Project[],
  projectOps: ProjectOp[],
  projectTrustedByProject: Map<string, Set<string>>,
  currentUserDid: string,
): MaterializedProject[] {
  const opsByProject = new Map<string, ProjectOp[]>();
  for (const op of projectOps) {
    const list = opsByProject.get(op.targetProjectUri) || [];
    list.push(op);
    opsByProject.set(op.targetProjectUri, list);
  }

  return projects.map((project) => {
    const projectUri = buildAtUri(
      project.did,
      PROJECT_COLLECTION,
      project.rkey,
    );
    const ops = opsByProject.get(projectUri) || [];
    const trustedDids =
      projectTrustedByProject.get(projectUri) ?? new Set<string>();

    const appliedOps = ops.filter(
      (op) =>
        op.did === project.did ||
        op.did === currentUserDid ||
        trustedDids.has(op.did),
    );

    const fields: Record<string, FieldState> = {
      name: {
        value: project.name,
        timestamp: project.createdAt,
        author: project.did,
      },
      description: {
        value: project.description,
        timestamp: project.createdAt,
        author: project.did,
      },
      labelUris: {
        value: project.labelUris ?? ([] as string[]),
        timestamp: project.createdAt,
        author: project.did,
      },
    };

    const sorted = [...appliedOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    for (const op of sorted) {
      for (const field of ["name", "description", "labelUris"] as const) {
        const val = op.fields[field];
        if (val !== undefined && op.createdAt > fields[field].timestamp) {
          fields[field] = {
            value: val,
            timestamp: op.createdAt,
            author: op.did,
          };
        }
      }
    }

    let lastModifiedBy = project.did;
    let lastModifiedAt = project.createdAt;
    for (const field of ["name", "description", "labelUris"]) {
      if (fields[field].timestamp > lastModifiedAt) {
        lastModifiedAt = fields[field].timestamp;
        lastModifiedBy = fields[field].author;
      }
    }

    return {
      rkey: project.rkey,
      did: project.did,
      sourceProject: project,
      appliedOps,
      effectiveName: fields.name.value as string,
      effectiveDescription: fields.description.value as string | undefined,
      effectiveLabelUris: (fields.labelUris.value as string[]) ?? [],
      lastModifiedBy,
      lastModifiedAt,
    };
  });
}

/**
 * Materialize comments using CommentOps.
 * Permission: only the comment author can edit their own comments.
 * Per-field LWW on text.
 */
export function materializeComments(
  comments: Comment[],
  commentOps: CommentOp[],
): MaterializedComment[] {
  const opsByComment = new Map<string, CommentOp[]>();
  for (const op of commentOps) {
    const list = opsByComment.get(op.targetCommentUri) || [];
    list.push(op);
    opsByComment.set(op.targetCommentUri, list);
  }

  return comments.map((comment) => {
    const commentUri = buildAtUri(
      comment.did,
      COMMENT_COLLECTION,
      comment.rkey,
    );
    const ops = opsByComment.get(commentUri) || [];

    // Only the comment author can edit their own comment
    const appliedOps = ops.filter((op) => op.did === comment.did);

    let effectiveText = comment.text;
    let editedAt: string | undefined;

    const sorted = [...appliedOps].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    for (const op of sorted) {
      if (op.fields.text !== undefined && op.createdAt > comment.createdAt) {
        effectiveText = op.fields.text;
        editedAt = op.createdAt;
      }
    }

    return {
      rkey: comment.rkey,
      did: comment.did,
      targetTaskUri: comment.targetTaskUri,
      sourceComment: comment,
      effectiveText,
      createdAt: comment.createdAt,
      editedAt,
    };
  });
}

import {
  BOARD_COLLECTION,
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
  PLACEMENT_COLLECTION,
  PLACEMENT_OP_COLLECTION,
  TASK_OP_COLLECTION,
  TASK_TRUST_COLLECTION,
  PROJECT_COLLECTION,
  MEMBERSHIP_COLLECTION,
  ASSIGNMENT_COLLECTION,
  PROJECT_TRUST_COLLECTION,
} from "../shared/collections.js";
import {
  safeParse,
  BoardRecordSchema,
  TaskRecordSchema,
  OpRecordSchema,
  TrustRecordSchema,
  CommentRecordSchema,
  ApprovalRecordSchema,
  ReactionRecordSchema,
  PlacementRecordSchema,
  PlacementOpRecordSchema,
  TaskOpRecordSchema,
  TaskTrustRecordSchema,
  ProjectRecordSchema,
  MembershipRecordSchema,
  AssignmentRecordSchema,
  ProjectTrustRecordSchema,
} from "../shared/schemas.js";
import {
  upsertBoard,
  deleteBoard,
  upsertTask,
  deleteTask,
  upsertOp,
  deleteOp,
  upsertTrust,
  deleteTrust,
  upsertComment,
  deleteComment,
  upsertApproval,
  deleteApproval,
  upsertReaction,
  deleteReaction,
  upsertPlacement,
  deletePlacement,
  upsertPlacementOp,
  deletePlacementOp,
  upsertTaskOp,
  deleteTaskOp,
  upsertTaskTrust,
  deleteTaskTrust,
  upsertProject,
  deleteProject,
  upsertMembership,
  deleteMembership,
  upsertAssignment,
  deleteAssignment,
  upsertProjectTrust,
  deleteProjectTrust,
  upsertParticipant,
} from "../db/client.js";

export interface CommitEvent {
  did: string;
  time_us: number;
  kind: "commit";
  commit: {
    rev: string;
    operation: "create" | "update" | "delete";
    collection: string;
    rkey: string;
    record?: Record<string, unknown>;
  };
}

/**
 * Infer the `open` flag from a PDS record that may have the old `permissions`
 * field but no `open` field.
 */
function inferOpen(value: Record<string, unknown>): boolean | undefined {
  if (value.open !== undefined) return (value.open as boolean) || undefined;
  const perms = value.permissions as
    | { rules?: Array<{ scope?: string }> }
    | undefined;
  if (perms?.rules?.some((r) => r.scope === "anyone")) return true;
  return undefined;
}

/**
 * Process a single Jetstream commit event. Returns the affected boardUri
 * (if any) so the caller can notify WebSocket subscribers.
 */
export function processEvent(event: CommitEvent): string | null {
  const { did, commit } = event;

  if (commit.operation === "delete") {
    return processDelete(did, commit.collection, commit.rkey);
  }

  if (!commit.record) return null;

  const record = commit.record;
  const boardUri = record.boardUri as string | undefined;

  switch (commit.collection) {
    case BOARD_COLLECTION:
      return processBoard(did, commit.rkey, record);
    case TASK_COLLECTION:
      return processTask(did, commit.rkey, record, boardUri);
    case OP_COLLECTION:
      return boardUri ? processOps(did, commit.rkey, record, boardUri) : null;
    case TRUST_COLLECTION:
      return boardUri ? processTrust(did, commit.rkey, record, boardUri) : null;
    case COMMENT_COLLECTION:
      return processComment(did, commit.rkey, record, boardUri);
    case APPROVAL_COLLECTION:
      return processApprovalRecord(did, commit.rkey, record, boardUri);
    case REACTION_COLLECTION:
      return processReaction(did, commit.rkey, record, boardUri);
    // New collection types
    case PLACEMENT_COLLECTION:
      return processPlacement(did, commit.rkey, record);
    case PLACEMENT_OP_COLLECTION:
      return processPlacementOp(did, commit.rkey, record);
    case TASK_OP_COLLECTION:
      return processTaskOp(did, commit.rkey, record);
    case TASK_TRUST_COLLECTION:
      return processTaskTrust(did, commit.rkey, record);
    case PROJECT_COLLECTION:
      return processProject(did, commit.rkey, record);
    case MEMBERSHIP_COLLECTION:
      return processMembership(did, commit.rkey, record);
    case ASSIGNMENT_COLLECTION:
      return processAssignment(did, commit.rkey, record);
    case PROJECT_TRUST_COLLECTION:
      return processProjectTrust(did, commit.rkey, record);
    default:
      return null;
  }
}

function processDelete(
  did: string,
  collection: string,
  rkey: string,
): string | null {
  switch (collection) {
    case BOARD_COLLECTION:
      deleteBoard(did, rkey);
      return null;
    case TASK_COLLECTION:
      return deleteTask(did, rkey);
    case OP_COLLECTION:
      return deleteOp(did, rkey);
    case TRUST_COLLECTION:
      return deleteTrust(did, rkey);
    case COMMENT_COLLECTION:
      return deleteComment(did, rkey);
    case APPROVAL_COLLECTION:
      return deleteApproval(did, rkey);
    case REACTION_COLLECTION:
      return deleteReaction(did, rkey);
    case PLACEMENT_COLLECTION:
      return deletePlacement(did, rkey);
    case PLACEMENT_OP_COLLECTION:
      return deletePlacementOp(did, rkey);
    case TASK_OP_COLLECTION:
      deleteTaskOp(did, rkey);
      return null; // TaskOps don't have a boardUri to broadcast
    case TASK_TRUST_COLLECTION:
      deleteTaskTrust(did, rkey);
      return null;
    case PROJECT_COLLECTION:
      deleteProject(did, rkey);
      return null;
    case MEMBERSHIP_COLLECTION:
      deleteMembership(did, rkey);
      return null;
    case ASSIGNMENT_COLLECTION:
      deleteAssignment(did, rkey);
      return null;
    case PROJECT_TRUST_COLLECTION:
      deleteProjectTrust(did, rkey);
      return null;
    default:
      return null;
  }
}

function processBoard(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): string | null {
  const validated = safeParse(BoardRecordSchema, record, "BoardRecord");
  if (!validated) return null;

  upsertBoard(did, rkey, {
    name: validated.name,
    description: validated.description,
    columns: validated.columns,
    labels: validated.labels,
    open: inferOpen(record),
    createdAt: validated.createdAt,
  });

  // Track board owner as participant
  const boardUri = `at://${did}/dev.skyboard.board/${rkey}`;
  upsertParticipant(did, boardUri);
  return boardUri;
}

function processTask(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
  boardUri: string | undefined,
): string | null {
  const validated = safeParse(TaskRecordSchema, record, "TaskRecord");
  if (!validated) return null;

  upsertTask(did, rkey, {
    title: validated.title,
    description: validated.description,
    status: validated.status,
    open: validated.open,
    labelIds: validated.labelIds,
    forkedFrom: validated.forkedFrom,
    columnId: validated.columnId,
    boardUri: validated.boardUri,
    position: validated.position,
    order: validated.order,
    createdAt: validated.createdAt,
    updatedAt: validated.updatedAt,
  });

  // Only track participation if task has a boardUri (legacy format)
  if (boardUri) {
    upsertParticipant(did, boardUri);
  }
  return boardUri ?? null;
}

function processOps(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
  boardUri: string,
): string | null {
  const validated = safeParse(OpRecordSchema, record, "OpRecord");
  if (!validated) return null;

  upsertOp(did, rkey, {
    targetTaskUri: validated.targetTaskUri,
    boardUri,
    fields: validated.fields,
    createdAt: validated.createdAt,
  });
  upsertParticipant(did, boardUri);
  return boardUri;
}

function processTrust(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
  boardUri: string,
): string | null {
  const validated = safeParse(TrustRecordSchema, record, "TrustRecord");
  if (!validated) return null;

  upsertTrust(did, rkey, {
    trustedDid: validated.trustedDid,
    boardUri,
    createdAt: validated.createdAt,
  });
  upsertParticipant(did, boardUri);
  upsertParticipant(validated.trustedDid, boardUri);
  return boardUri;
}

function processComment(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
  boardUri: string | undefined,
): string | null {
  const validated = safeParse(CommentRecordSchema, record, "CommentRecord");
  if (!validated) return null;

  upsertComment(did, rkey, {
    targetTaskUri: validated.targetTaskUri,
    boardUri: validated.boardUri,
    text: validated.text,
    createdAt: validated.createdAt,
  });
  if (boardUri) {
    upsertParticipant(did, boardUri);
  }
  return boardUri ?? null;
}

function processApprovalRecord(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
  boardUri: string | undefined,
): string | null {
  const validated = safeParse(ApprovalRecordSchema, record, "ApprovalRecord");
  if (!validated) return null;

  upsertApproval(did, rkey, {
    targetUri: validated.targetUri,
    boardUri: validated.boardUri,
    taskUri: validated.taskUri,
    createdAt: validated.createdAt,
  });
  if (boardUri) {
    upsertParticipant(did, boardUri);
  }
  return boardUri ?? null;
}

function processReaction(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
  boardUri: string | undefined,
): string | null {
  const validated = safeParse(ReactionRecordSchema, record, "ReactionRecord");
  if (!validated) return null;

  upsertReaction(did, rkey, {
    targetTaskUri: validated.targetTaskUri,
    boardUri: validated.boardUri,
    emoji: validated.emoji,
    createdAt: validated.createdAt,
  });
  if (boardUri) {
    upsertParticipant(did, boardUri);
  }
  return boardUri ?? null;
}

// --- New collection processors ---

function processPlacement(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): string | null {
  const validated = safeParse(PlacementRecordSchema, record, "PlacementRecord");
  if (!validated) return null;

  upsertPlacement(did, rkey, {
    taskUri: validated.taskUri,
    boardUri: validated.boardUri,
    columnId: validated.columnId,
    position: validated.position,
    createdAt: validated.createdAt,
  });
  upsertParticipant(did, validated.boardUri);
  return validated.boardUri;
}

function processPlacementOp(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): string | null {
  const validated = safeParse(
    PlacementOpRecordSchema,
    record,
    "PlacementOpRecord",
  );
  if (!validated) return null;

  upsertPlacementOp(did, rkey, {
    targetPlacementUri: validated.targetPlacementUri,
    boardUri: validated.boardUri,
    fields: validated.fields,
    createdAt: validated.createdAt,
  });
  upsertParticipant(did, validated.boardUri);
  return validated.boardUri;
}

function processTaskOp(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): string | null {
  const validated = safeParse(TaskOpRecordSchema, record, "TaskOpRecord");
  if (!validated) return null;

  upsertTaskOp(did, rkey, {
    targetTaskUri: validated.targetTaskUri,
    fields: validated.fields,
    createdAt: validated.createdAt,
  });
  // TaskOps are not board-scoped, so no boardUri to broadcast.
  // The appview will pick them up when a board is fetched.
  return null;
}

function processTaskTrust(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): string | null {
  const validated = safeParse(TaskTrustRecordSchema, record, "TaskTrustRecord");
  if (!validated) return null;

  upsertTaskTrust(did, rkey, {
    taskUri: validated.taskUri,
    trustedDid: validated.trustedDid,
    createdAt: validated.createdAt,
  });
  return null;
}

function processProject(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): string | null {
  const validated = safeParse(ProjectRecordSchema, record, "ProjectRecord");
  if (!validated) return null;

  upsertProject(did, rkey, {
    name: validated.name,
    description: validated.description,
    labels: validated.labels,
    open: validated.open,
    createdAt: validated.createdAt,
  });
  return null;
}

function processMembership(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): string | null {
  const validated = safeParse(
    MembershipRecordSchema,
    record,
    "MembershipRecord",
  );
  if (!validated) return null;

  upsertMembership(did, rkey, {
    taskUri: validated.taskUri,
    projectUri: validated.projectUri,
    createdAt: validated.createdAt,
  });
  return null;
}

function processAssignment(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): string | null {
  const validated = safeParse(
    AssignmentRecordSchema,
    record,
    "AssignmentRecord",
  );
  if (!validated) return null;

  upsertAssignment(did, rkey, {
    taskUri: validated.taskUri,
    assigneeDid: validated.assigneeDid,
    createdAt: validated.createdAt,
  });
  return null;
}

function processProjectTrust(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): string | null {
  const validated = safeParse(
    ProjectTrustRecordSchema,
    record,
    "ProjectTrustRecord",
  );
  if (!validated) return null;

  upsertProjectTrust(did, rkey, {
    projectUri: validated.projectUri,
    trustedDid: validated.trustedDid,
    createdAt: validated.createdAt,
  });
  return null;
}

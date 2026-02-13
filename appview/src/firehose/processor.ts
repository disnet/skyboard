import {
  BOARD_COLLECTION,
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
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
      return boardUri ? processTask(did, commit.rkey, record, boardUri) : null;
    case OP_COLLECTION:
      return boardUri ? processOps(did, commit.rkey, record, boardUri) : null;
    case TRUST_COLLECTION:
      return boardUri ? processTrust(did, commit.rkey, record, boardUri) : null;
    case COMMENT_COLLECTION:
      return boardUri
        ? processComment(did, commit.rkey, record, boardUri)
        : null;
    case APPROVAL_COLLECTION:
      return boardUri
        ? processApprovalRecord(did, commit.rkey, record, boardUri)
        : null;
    case REACTION_COLLECTION:
      return boardUri
        ? processReaction(did, commit.rkey, record, boardUri)
        : null;
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
  boardUri: string,
): string | null {
  const validated = safeParse(TaskRecordSchema, record, "TaskRecord");
  if (!validated) return null;

  upsertTask(did, rkey, {
    title: validated.title,
    description: validated.description,
    columnId: validated.columnId,
    boardUri,
    position: validated.position,
    labelIds: validated.labelIds,
    order: validated.order,
    createdAt: validated.createdAt,
    updatedAt: validated.updatedAt,
  });
  upsertParticipant(did, boardUri);
  return boardUri;
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
  boardUri: string,
): string | null {
  const validated = safeParse(CommentRecordSchema, record, "CommentRecord");
  if (!validated) return null;

  upsertComment(did, rkey, {
    targetTaskUri: validated.targetTaskUri,
    boardUri,
    text: validated.text,
    createdAt: validated.createdAt,
  });
  upsertParticipant(did, boardUri);
  return boardUri;
}

function processApprovalRecord(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
  boardUri: string,
): string | null {
  const validated = safeParse(ApprovalRecordSchema, record, "ApprovalRecord");
  if (!validated) return null;

  upsertApproval(did, rkey, {
    targetUri: validated.targetUri,
    boardUri,
    createdAt: validated.createdAt,
  });
  upsertParticipant(did, boardUri);
  return boardUri;
}

function processReaction(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
  boardUri: string,
): string | null {
  const validated = safeParse(ReactionRecordSchema, record, "ReactionRecord");
  if (!validated) return null;

  upsertReaction(did, rkey, {
    targetTaskUri: validated.targetTaskUri,
    boardUri,
    emoji: validated.emoji,
    createdAt: validated.createdAt,
  });
  upsertParticipant(did, boardUri);
  return boardUri;
}

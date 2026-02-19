export type SyncStatus = "synced" | "pending" | "error";

export interface Column {
  id: string;
  name: string;
  order: number;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface Board {
  id?: number; // Dexie auto-increment
  rkey: string;
  did: string;
  name: string;
  description?: string;
  columns: Column[];
  labels?: Label[];
  open?: boolean;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface Task {
  id?: number; // Dexie auto-increment
  rkey: string;
  did: string;
  title: string;
  description?: string;
  columnId: string;
  boardUri: string;
  position?: string;
  labelIds?: string[];
  order?: number; // Deprecated: use position
  createdAt: string;
  updatedAt?: string;
  syncStatus: SyncStatus;
}

export interface BoardRecord {
  $type: "dev.skyboard.board";
  name: string;
  description?: string;
  columns: Column[];
  labels?: Label[];
  open?: boolean;
  createdAt: string;
}

export interface TaskRecord {
  $type: "dev.skyboard.task";
  title: string;
  description?: string;
  columnId: string;
  boardUri: string;
  position?: string;
  labelIds?: string[];
  order?: number; // Deprecated: use position
  createdAt: string;
  updatedAt?: string;
}

// --- Op types ---

export interface OpFields {
  title?: string;
  description?: string;
  columnId?: string;
  position?: string;
  labelIds?: string[];
  order?: number; // Deprecated: use position
}

export interface Op {
  id?: number;
  rkey: string;
  did: string; // DID of the op author
  targetTaskUri: string;
  boardUri: string;
  fields: OpFields;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface OpRecord {
  $type: "dev.skyboard.op";
  targetTaskUri: string;
  boardUri: string;
  fields: OpFields;
  createdAt: string;
}

// --- Trust types ---

export interface Trust {
  id?: number;
  rkey: string;
  did: string; // DID of the user who granted trust
  trustedDid: string;
  boardUri: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface TrustRecord {
  $type: "dev.skyboard.trust";
  trustedDid: string;
  boardUri: string;
  createdAt: string;
}

// --- Comment types ---

export interface Comment {
  id?: number;
  rkey: string;
  did: string;
  targetTaskUri: string;
  boardUri: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
  syncStatus: SyncStatus;
}

export interface CommentRecord {
  $type: "dev.skyboard.comment";
  targetTaskUri: string;
  boardUri: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

// --- Reaction types ---

export interface Reaction {
  id?: number;
  rkey: string;
  did: string;
  targetTaskUri: string;
  boardUri: string;
  emoji: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface ReactionRecord {
  $type: "dev.skyboard.reaction";
  targetTaskUri: string;
  boardUri: string;
  emoji: string;
  createdAt: string;
}

// --- Block types (local-only, not synced to PDS) ---

export interface Block {
  id?: number;
  did: string; // DID of the board owner who blocked
  blockedDid: string;
  boardUri: string;
  createdAt: string;
}

// --- Materialized collaborative task view ---

export interface MaterializedTask {
  rkey: string;
  did: string;
  title: string;
  description?: string;
  columnId: string;
  boardUri: string;
  position?: string;
  order?: number;
  createdAt: string;
  updatedAt?: string;
  sourceTask: Task;
  appliedOps: Op[];
  pendingOps: Op[];
  effectiveTitle: string;
  effectiveDescription?: string;
  effectiveColumnId: string;
  effectivePosition: string;
  labelIds?: string[];
  effectiveLabelIds: string[];
  ownerDid: string;
  lastModifiedBy: string;
  lastModifiedAt: string;
}

// --- Approval types ---

export interface Approval {
  id?: number;
  rkey: string;
  did: string;
  targetUri: string; // AT URI of approved task or comment
  boardUri: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface ApprovalRecord {
  $type: "dev.skyboard.approval";
  targetUri: string;
  boardUri: string;
  createdAt: string;
}

// --- Notification types (local-only, not synced to PDS) ---

export type NotificationType = "task_created" | "comment_added" | "mention";

export interface Notification {
  id?: number;
  type: NotificationType;
  actorDid: string;
  boardUri: string;
  taskUri?: string;
  commentRkey?: string;
  text?: string;
  read: number; // 0 = unread, 1 = read (number for Dexie indexing)
  createdAt: string;
  dedupeKey: string;
}

// --- Filter view types (local-only, not synced to PDS) ---

export interface FilterView {
  id?: number;
  boardUri: string;
  name: string;
  titleFilter: string;
  labelIds: string[];
}

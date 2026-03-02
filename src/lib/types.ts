export type SyncStatus = "synced" | "pending" | "error";

export type TaskStatus = "open" | "closed";

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
  status?: TaskStatus;
  open?: boolean; // permission flag: anyone can edit
  labelIds?: string[];
  forkedFrom?: string; // AT URI of original task
  // Legacy fields (for backward compat with old board-coupled tasks)
  columnId?: string;
  boardUri?: string;
  position?: string;
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
  status?: TaskStatus;
  open?: boolean;
  labelIds?: string[];
  forkedFrom?: string;
  // Legacy fields
  columnId?: string;
  boardUri?: string;
  position?: string;
  order?: number; // Deprecated: use position
  createdAt: string;
  updatedAt?: string;
}

// --- Op types (legacy combined op — kept for backward compat) ---

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

// --- TaskOp types (new: task-level field changes) ---

export interface TaskOpFields {
  title?: string;
  description?: string;
  labelIds?: string[];
  status?: TaskStatus;
}

export interface TaskOp {
  id?: number;
  rkey: string;
  did: string; // DID of the op author
  targetTaskUri: string;
  fields: TaskOpFields;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface TaskOpRecord {
  $type: "dev.skyboard.taskOp";
  targetTaskUri: string;
  fields: TaskOpFields;
  createdAt: string;
}

// --- Placement types (new: links task → board) ---

export interface Placement {
  id?: number;
  rkey: string;
  did: string;
  taskUri: string;
  boardUri: string;
  columnId: string;
  position: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface PlacementRecord {
  $type: "dev.skyboard.placement";
  taskUri: string;
  boardUri: string;
  columnId: string;
  position: string;
  createdAt: string;
}

// --- PlacementOp types (new: modifies placement fields) ---

export interface PlacementOpFields {
  columnId?: string;
  position?: string;
  removed?: boolean;
}

export interface PlacementOp {
  id?: number;
  rkey: string;
  did: string; // DID of the op author
  targetPlacementUri: string;
  boardUri: string;
  fields: PlacementOpFields;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface PlacementOpRecord {
  $type: "dev.skyboard.placementOp";
  targetPlacementUri: string;
  boardUri: string;
  fields: PlacementOpFields;
  createdAt: string;
}

// --- Trust types (board-level trust — unchanged) ---

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

// --- TaskTrust types (new: task-level trust) ---

export interface TaskTrust {
  id?: number;
  rkey: string;
  did: string; // DID of the task author who granted trust
  taskUri: string;
  trustedDid: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface TaskTrustRecord {
  $type: "dev.skyboard.taskTrust";
  taskUri: string;
  trustedDid: string;
  createdAt: string;
}

// --- Comment types (now task-scoped, boardUri optional for legacy) ---

export interface Comment {
  id?: number;
  rkey: string;
  did: string;
  targetTaskUri: string;
  boardUri?: string; // Legacy: optional for backward compat
  text: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface CommentRecord {
  $type: "dev.skyboard.comment";
  targetTaskUri: string;
  boardUri?: string; // Legacy: optional for backward compat
  text: string;
  createdAt: string;
}

// --- Reaction types (now task-scoped, boardUri optional for legacy) ---

export interface Reaction {
  id?: number;
  rkey: string;
  did: string;
  targetTaskUri: string;
  boardUri?: string; // Legacy: optional for backward compat
  emoji: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface ReactionRecord {
  $type: "dev.skyboard.reaction";
  targetTaskUri: string;
  boardUri?: string; // Legacy: optional for backward compat
  emoji: string;
  createdAt: string;
}

// --- Project types (new: flat collection) ---

export interface Project {
  id?: number;
  rkey: string;
  did: string;
  name: string;
  description?: string;
  labels?: Label[];
  open?: boolean;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface ProjectRecord {
  $type: "dev.skyboard.project";
  name: string;
  description?: string;
  labels?: Label[];
  open?: boolean;
  createdAt: string;
}

// --- Membership types (new: links task → project) ---

export interface Membership {
  id?: number;
  rkey: string;
  did: string;
  taskUri: string;
  projectUri: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface MembershipRecord {
  $type: "dev.skyboard.membership";
  taskUri: string;
  projectUri: string;
  createdAt: string;
}

// --- ProjectTrust types (new: project-level trust) ---

export interface ProjectTrust {
  id?: number;
  rkey: string;
  did: string;
  projectUri: string;
  trustedDid: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface ProjectTrustRecord {
  $type: "dev.skyboard.projectTrust";
  projectUri: string;
  trustedDid: string;
  createdAt: string;
}

// --- Assignment types (new) ---

export interface Assignment {
  id?: number;
  rkey: string;
  did: string;
  taskUri: string;
  assigneeDid: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface AssignmentRecord {
  $type: "dev.skyboard.assignment";
  taskUri: string;
  assigneeDid: string;
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

// --- Approval types (re-scoped: boardUri and taskUri optional) ---

export interface Approval {
  id?: number;
  rkey: string;
  did: string;
  targetUri: string; // AT URI of approved task, comment, or placement
  boardUri?: string; // Optional: for board-level approvals
  taskUri?: string; // Optional: for task-level approvals
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface ApprovalRecord {
  $type: "dev.skyboard.approval";
  targetUri: string;
  boardUri?: string;
  taskUri?: string;
  createdAt: string;
}

// --- Materialized views ---

export interface MaterializedTask {
  rkey: string;
  did: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  open?: boolean;
  // Legacy fields from base task
  columnId?: string;
  boardUri?: string;
  position?: string;
  order?: number;
  createdAt: string;
  updatedAt?: string;
  sourceTask: Task;
  appliedOps: (Op | TaskOp)[];
  pendingOps: (Op | TaskOp)[];
  effectiveTitle: string;
  effectiveDescription?: string;
  effectiveStatus: TaskStatus;
  effectiveLabelIds: string[];
  // Legacy board-level effective fields (from old combined ops or placements)
  effectiveColumnId?: string;
  effectivePosition?: string;
  labelIds?: string[];
  ownerDid: string;
  lastModifiedBy: string;
  lastModifiedAt: string;
}

export interface MaterializedPlacement {
  rkey: string;
  did: string;
  taskUri: string;
  boardUri: string;
  sourcePlacement: Placement;
  appliedOps: PlacementOp[];
  effectiveColumnId: string;
  effectivePosition: string;
  effectiveRemoved: boolean;
  lastModifiedBy: string;
  lastModifiedAt: string;
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

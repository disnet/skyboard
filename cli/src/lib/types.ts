// Synced from ../src/lib/types.ts — stripped of Dexie auto-increment id fields

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
  rkey: string;
  did: string;
  name: string;
  description?: string;
  columns: Column[];
  labels?: Label[];
  open?: boolean;
  createdAt: string;
}

export interface Task {
  rkey: string;
  did: string;
  title: string;
  description?: string;
  columnId: string;
  boardUri: string;
  position?: string;
  labelIds?: string[];
  order?: number;
  createdAt: string;
  updatedAt?: string;
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
  order?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface OpFields {
  title?: string;
  description?: string;
  columnId?: string;
  position?: string;
  labelIds?: string[];
  order?: number;
}

export interface Op {
  rkey: string;
  did: string;
  targetTaskUri: string;
  boardUri: string;
  fields: OpFields;
  createdAt: string;
}

export interface OpRecord {
  $type: "dev.skyboard.op";
  targetTaskUri: string;
  boardUri: string;
  fields: OpFields;
  createdAt: string;
}

export interface Trust {
  rkey: string;
  did: string;
  trustedDid: string;
  boardUri: string;
  createdAt: string;
}

export interface TrustRecord {
  $type: "dev.skyboard.trust";
  trustedDid: string;
  boardUri: string;
  createdAt: string;
}

export interface Comment {
  rkey: string;
  did: string;
  targetTaskUri: string;
  boardUri: string;
  text: string;
  createdAt: string;
}

export interface CommentRecord {
  $type: "dev.skyboard.comment";
  targetTaskUri: string;
  boardUri: string;
  text: string;
  createdAt: string;
}

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
  effectiveLabelIds: string[];
  ownerDid: string;
  lastModifiedBy: string;
  lastModifiedAt: string;
}

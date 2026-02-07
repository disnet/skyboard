export type SyncStatus = 'synced' | 'pending' | 'error';

// --- Permission types ---

export type PermissionScope = 'author_only' | 'trusted' | 'anyone';

export type OperationType = 'create_task' | 'edit_title' | 'edit_description' | 'move_task' | 'reorder';

export interface PermissionRule {
	operation: OperationType;
	scope: PermissionScope;
	columnIds?: string[]; // For create_task: restrict to specific columns
}

export interface BoardPermissions {
	rules: PermissionRule[];
}

export interface Column {
	id: string;
	name: string;
	order: number;
}

export interface Board {
	id?: number; // Dexie auto-increment
	rkey: string;
	did: string;
	name: string;
	description?: string;
	columns: Column[];
	permissions?: BoardPermissions;
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
	order?: number; // Deprecated: use position
	createdAt: string;
	updatedAt?: string;
	syncStatus: SyncStatus;
}

export interface BoardRecord {
	$type: 'blue.kanban.board';
	name: string;
	description?: string;
	columns: Column[];
	permissions?: BoardPermissions;
	createdAt: string;
}

export interface TaskRecord {
	$type: 'blue.kanban.task';
	title: string;
	description?: string;
	columnId: string;
	boardUri: string;
	position?: string;
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
	$type: 'blue.kanban.op';
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
	$type: 'blue.kanban.trust';
	trustedDid: string;
	boardUri: string;
	createdAt: string;
}

// --- Known participants ---

export interface KnownParticipant {
	id?: number;
	did: string;
	boardUri: string;
	discoveredAt: string;
	lastFetchedAt?: string;
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
	ownerDid: string;
	lastModifiedBy: string;
	lastModifiedAt: string;
}

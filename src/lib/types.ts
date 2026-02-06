export type SyncStatus = 'synced' | 'pending' | 'error';

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
	order: number;
	createdAt: string;
	updatedAt?: string;
	syncStatus: SyncStatus;
}

export interface BoardRecord {
	$type: 'blue.kanban.board';
	name: string;
	description?: string;
	columns: Column[];
	createdAt: string;
}

export interface TaskRecord {
	$type: 'blue.kanban.task';
	title: string;
	description?: string;
	columnId: string;
	boardUri: string;
	order: number;
	createdAt: string;
	updatedAt?: string;
}

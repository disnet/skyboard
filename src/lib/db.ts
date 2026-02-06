import Dexie, { type EntityTable } from 'dexie';
import type { Board, Task } from './types.js';

const db = new Dexie('at-kanban') as Dexie & {
	boards: EntityTable<Board, 'id'>;
	tasks: EntityTable<Task, 'id'>;
};

db.version(1).stores({
	boards: '++id, rkey, did, syncStatus',
	tasks: '++id, rkey, did, columnId, boardUri, order, syncStatus'
});

export { db };

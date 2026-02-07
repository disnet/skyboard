import Dexie, { type EntityTable } from 'dexie';
import type { Board, Task, Op, Trust, KnownParticipant } from './types.js';

const db = new Dexie('at-kanban') as Dexie & {
	boards: EntityTable<Board, 'id'>;
	tasks: EntityTable<Task, 'id'>;
	ops: EntityTable<Op, 'id'>;
	trusts: EntityTable<Trust, 'id'>;
	knownParticipants: EntityTable<KnownParticipant, 'id'>;
};

db.version(1).stores({
	boards: '++id, rkey, did, syncStatus',
	tasks: '++id, rkey, did, columnId, boardUri, order, syncStatus'
});

db.version(2).stores({
	boards: '++id, rkey, did, syncStatus',
	tasks: '++id, rkey, did, columnId, boardUri, order, syncStatus, [did+rkey]',
	ops: '++id, rkey, did, targetTaskUri, boardUri, createdAt, syncStatus, [did+rkey]',
	trusts: '++id, rkey, did, trustedDid, boardUri, syncStatus, [did+boardUri+trustedDid]',
	knownParticipants: '++id, did, boardUri, [did+boardUri]'
});

export { db };

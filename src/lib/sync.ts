import type { Agent } from '@atproto/api';
import { db } from './db.js';
import { BOARD_COLLECTION, TASK_COLLECTION, OP_COLLECTION, TRUST_COLLECTION, buildAtUri } from './tid.js';
import type { Board, Task, Op, Trust, BoardRecord, TaskRecord } from './types.js';
import { opToRecord } from './ops.js';
import { trustToRecord } from './trust.js';

let syncInterval: ReturnType<typeof setInterval> | null = null;

function boardToRecord(board: Board): BoardRecord {
	return {
		$type: 'blue.kanban.board',
		name: board.name,
		...(board.description ? { description: board.description } : {}),
		columns: board.columns,
		...(board.permissions ? { permissions: board.permissions } : {}),
		createdAt: board.createdAt
	};
}

function taskToRecord(task: Task): TaskRecord {
	return {
		$type: 'blue.kanban.task',
		title: task.title,
		...(task.description ? { description: task.description } : {}),
		columnId: task.columnId,
		boardUri: task.boardUri,
		...(task.position ? { position: task.position } : {}),
		order: task.order ?? 0,
		createdAt: task.createdAt,
		...(task.updatedAt ? { updatedAt: task.updatedAt } : {})
	};
}

export async function syncPendingToPDS(agent: Agent, did: string): Promise<void> {
	const pendingBoards = await db.boards
		.where('syncStatus')
		.equals('pending')
		.filter((b) => b.did === did)
		.toArray();

	for (const board of pendingBoards) {
		try {
			await agent.com.atproto.repo.putRecord({
				repo: did,
				collection: BOARD_COLLECTION,
				rkey: board.rkey,
				record: boardToRecord(board),
				validate: false
			});
			if (board.id) {
				await db.boards.update(board.id, { syncStatus: 'synced' });
			}
		} catch (err) {
			console.error('Failed to sync board to PDS:', err);
			if (board.id) {
				await db.boards.update(board.id, { syncStatus: 'error' });
			}
		}
	}

	const pendingTasks = await db.tasks
		.where('syncStatus')
		.equals('pending')
		.filter((t) => t.did === did)
		.toArray();

	for (const task of pendingTasks) {
		try {
			await agent.com.atproto.repo.putRecord({
				repo: did,
				collection: TASK_COLLECTION,
				rkey: task.rkey,
				record: taskToRecord(task),
				validate: false
			});
			if (task.id) {
				await db.tasks.update(task.id, { syncStatus: 'synced' });
			}
		} catch (err) {
			console.error('Failed to sync task to PDS:', err);
			if (task.id) {
				await db.tasks.update(task.id, { syncStatus: 'error' });
			}
		}
	}

	// Sync pending ops
	const pendingOps = await db.ops
		.where('syncStatus')
		.equals('pending')
		.filter((o) => o.did === did)
		.toArray();

	for (const op of pendingOps) {
		try {
			await agent.com.atproto.repo.putRecord({
				repo: did,
				collection: OP_COLLECTION,
				rkey: op.rkey,
				record: opToRecord(op),
				validate: false
			});
			if (op.id) {
				await db.ops.update(op.id, { syncStatus: 'synced' });
			}
		} catch (err) {
			console.error('Failed to sync op to PDS:', err);
			if (op.id) {
				await db.ops.update(op.id, { syncStatus: 'error' });
			}
		}
	}

	// Sync pending trusts
	const pendingTrusts = await db.trusts
		.where('syncStatus')
		.equals('pending')
		.filter((t) => t.did === did)
		.toArray();

	for (const trust of pendingTrusts) {
		try {
			await agent.com.atproto.repo.putRecord({
				repo: did,
				collection: TRUST_COLLECTION,
				rkey: trust.rkey,
				record: trustToRecord(trust),
				validate: false
			});
			if (trust.id) {
				await db.trusts.update(trust.id, { syncStatus: 'synced' });
			}
		} catch (err) {
			console.error('Failed to sync trust to PDS:', err);
			if (trust.id) {
				await db.trusts.update(trust.id, { syncStatus: 'error' });
			}
		}
	}
}

export async function pullFromPDS(agent: Agent, did: string): Promise<void> {
	// Pull boards
	let cursor: string | undefined;
	do {
		const res = await agent.com.atproto.repo.listRecords({
			repo: did,
			collection: BOARD_COLLECTION,
			limit: 100,
			cursor
		});

		for (const record of res.data.records) {
			const rkey = record.uri.split('/').pop()!;
			const value = record.value as Record<string, unknown>;

			const existing = await db.boards.where('rkey').equals(rkey).first();
			if (existing && existing.syncStatus === 'pending') {
				// Local pending wins
				continue;
			}

			const boardData: Omit<Board, 'id'> = {
				rkey,
				did,
				name: (value.name as string) ?? '',
				description: value.description as string | undefined,
				columns: (value.columns as Board['columns']) ?? [],
				permissions: value.permissions as Board['permissions'],
				createdAt: (value.createdAt as string) ?? new Date().toISOString(),
				syncStatus: 'synced'
			};

			if (existing?.id) {
				await db.boards.update(existing.id, boardData);
			} else {
				await db.boards.add(boardData as Board);
			}
		}

		cursor = res.data.cursor;
	} while (cursor);

	// Pull tasks
	cursor = undefined;
	do {
		const res = await agent.com.atproto.repo.listRecords({
			repo: did,
			collection: TASK_COLLECTION,
			limit: 100,
			cursor
		});

		for (const record of res.data.records) {
			const rkey = record.uri.split('/').pop()!;
			const value = record.value as Record<string, unknown>;

			const existing = await db.tasks.where('rkey').equals(rkey).first();
			if (existing && existing.syncStatus === 'pending') {
				continue;
			}

			const taskData: Omit<Task, 'id'> = {
				rkey,
				did,
				title: (value.title as string) ?? '',
				description: value.description as string | undefined,
				columnId: (value.columnId as string) ?? '',
				boardUri: (value.boardUri as string) ?? '',
				position: value.position as string | undefined,
				order: (value.order as number) ?? 0,
				createdAt: (value.createdAt as string) ?? new Date().toISOString(),
				updatedAt: value.updatedAt as string | undefined,
				syncStatus: 'synced'
			};

			if (existing?.id) {
				await db.tasks.update(existing.id, taskData);
			} else {
				await db.tasks.add(taskData as Task);
			}
		}

		cursor = res.data.cursor;
	} while (cursor);

	// Pull ops
	cursor = undefined;
	do {
		const res = await agent.com.atproto.repo.listRecords({
			repo: did,
			collection: OP_COLLECTION,
			limit: 100,
			cursor
		});

		for (const record of res.data.records) {
			const rkey = record.uri.split('/').pop()!;
			const value = record.value as Record<string, unknown>;

			const existing = await db.ops.where('[did+rkey]').equals([did, rkey]).first();
			if (existing && existing.syncStatus === 'pending') {
				continue;
			}

			const opData: Omit<Op, 'id'> = {
				rkey,
				did,
				targetTaskUri: (value.targetTaskUri as string) ?? '',
				boardUri: (value.boardUri as string) ?? '',
				fields: (value.fields as Op['fields']) ?? {},
				createdAt: (value.createdAt as string) ?? new Date().toISOString(),
				syncStatus: 'synced'
			};

			if (existing?.id) {
				await db.ops.update(existing.id, opData);
			} else {
				await db.ops.add(opData as Op);
			}
		}

		cursor = res.data.cursor;
	} while (cursor);

	// Pull trusts
	cursor = undefined;
	do {
		const res = await agent.com.atproto.repo.listRecords({
			repo: did,
			collection: TRUST_COLLECTION,
			limit: 100,
			cursor
		});

		for (const record of res.data.records) {
			const rkey = record.uri.split('/').pop()!;
			const value = record.value as Record<string, unknown>;

			const existing = await db.trusts
				.where('[did+boardUri+trustedDid]')
				.equals([did, (value.boardUri as string) ?? '', (value.trustedDid as string) ?? ''])
				.first();
			if (existing && existing.syncStatus === 'pending') {
				continue;
			}

			const trustData: Omit<Trust, 'id'> = {
				rkey,
				did,
				trustedDid: (value.trustedDid as string) ?? '',
				boardUri: (value.boardUri as string) ?? '',
				createdAt: (value.createdAt as string) ?? new Date().toISOString(),
				syncStatus: 'synced'
			};

			if (existing?.id) {
				await db.trusts.update(existing.id, trustData);
			} else {
				await db.trusts.add(trustData as Trust);
			}
		}

		cursor = res.data.cursor;
	} while (cursor);
}

export async function deleteBoardFromPDS(
	agent: Agent,
	did: string,
	board: Board
): Promise<void> {
	// Delete tasks from PDS first
	const boardUri = buildAtUri(did, BOARD_COLLECTION, board.rkey);
	const tasks = await db.tasks.where('boardUri').equals(boardUri).toArray();

	for (const task of tasks) {
		if (task.syncStatus === 'synced') {
			try {
				await agent.com.atproto.repo.deleteRecord({
					repo: did,
					collection: TASK_COLLECTION,
					rkey: task.rkey
				});
			} catch (err) {
				console.error('Failed to delete task from PDS:', err);
			}
		}
	}

	// Delete board from PDS
	if (board.syncStatus === 'synced') {
		try {
			await agent.com.atproto.repo.deleteRecord({
				repo: did,
				collection: BOARD_COLLECTION,
				rkey: board.rkey
			});
		} catch (err) {
			console.error('Failed to delete board from PDS:', err);
		}
	}
}

export async function deleteTaskFromPDS(
	agent: Agent,
	did: string,
	task: Task
): Promise<void> {
	if (task.syncStatus === 'synced') {
		try {
			await agent.com.atproto.repo.deleteRecord({
				repo: did,
				collection: TASK_COLLECTION,
				rkey: task.rkey
			});
		} catch (err) {
			console.error('Failed to delete task from PDS:', err);
		}
	}
}

export function startBackgroundSync(agent: Agent, did: string): void {
	stopBackgroundSync();
	syncInterval = setInterval(() => {
		syncPendingToPDS(agent, did).catch(console.error);
	}, 5_000);
	// Also run immediately
	syncPendingToPDS(agent, did).catch(console.error);
}

export function stopBackgroundSync(): void {
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
	}
}

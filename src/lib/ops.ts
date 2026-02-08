import { db } from './db.js';
import { generateTID, buildAtUri, TASK_COLLECTION } from './tid.js';
import type { Op, OpFields, OpRecord, Task } from './types.js';

export async function createOp(
	authorDid: string,
	targetTask: Task,
	boardUri: string,
	fields: OpFields
): Promise<void> {
	const targetTaskUri = buildAtUri(targetTask.did, TASK_COLLECTION, targetTask.rkey);

	await db.ops.add({
		rkey: generateTID(),
		did: authorDid,
		targetTaskUri,
		boardUri,
		fields,
		createdAt: new Date().toISOString(),
		syncStatus: 'pending'
	});
}

export function opToRecord(op: Op): OpRecord {
	return {
		$type: 'blue.kanban.op',
		targetTaskUri: op.targetTaskUri,
		boardUri: op.boardUri,
		fields: op.fields,
		createdAt: op.createdAt
	};
}

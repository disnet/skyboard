import { buildAtUri, TASK_COLLECTION } from './tid.js';
import type { Task, Op, OpFields, MaterializedTask } from './types.js';

const MUTABLE_FIELDS: (keyof OpFields)[] = ['title', 'description', 'columnId', 'order'];

interface FieldState {
	value: unknown;
	timestamp: string;
	author: string;
}

export function materializeTasks(
	tasks: Task[],
	ops: Op[],
	trustedDids: Set<string>,
	currentUserDid: string
): MaterializedTask[] {
	// Group ops by targetTaskUri
	const opsByTask = new Map<string, Op[]>();
	for (const op of ops) {
		const list = opsByTask.get(op.targetTaskUri) || [];
		list.push(op);
		opsByTask.set(op.targetTaskUri, list);
	}

	return tasks.map((task) => {
		const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
		const taskOps = opsByTask.get(taskUri) || [];

		// Separate trusted vs untrusted ops
		const appliedOps: Op[] = [];
		const pendingOps: Op[] = [];

		for (const op of taskOps) {
			if (
				op.did === task.did ||
				op.did === currentUserDid ||
				trustedDids.has(op.did)
			) {
				appliedOps.push(op);
			} else {
				pendingOps.push(op);
			}
		}

		// Start with base task values
		const fieldStates: Record<string, FieldState> = {};
		for (const field of MUTABLE_FIELDS) {
			fieldStates[field] = {
				value: task[field as keyof Task],
				timestamp: task.updatedAt || task.createdAt,
				author: task.did
			};
		}

		// Apply trusted ops using LWW per field (sort ascending, later overwrites)
		const sortedOps = [...appliedOps].sort((a, b) =>
			a.createdAt.localeCompare(b.createdAt)
		);

		for (const op of sortedOps) {
			for (const field of MUTABLE_FIELDS) {
				const opValue = op.fields[field];
				if (opValue !== undefined) {
					const current = fieldStates[field];
					if (op.createdAt > current.timestamp) {
						fieldStates[field] = {
							value: opValue,
							timestamp: op.createdAt,
							author: op.did
						};
					}
				}
			}
		}

		// Find the last modifier
		let lastModifiedBy = task.did;
		let lastModifiedAt = task.updatedAt || task.createdAt;
		for (const field of MUTABLE_FIELDS) {
			if (fieldStates[field].timestamp > lastModifiedAt) {
				lastModifiedAt = fieldStates[field].timestamp;
				lastModifiedBy = fieldStates[field].author;
			}
		}

		return {
			rkey: task.rkey,
			did: task.did,
			title: task.title,
			description: task.description,
			columnId: task.columnId,
			boardUri: task.boardUri,
			order: task.order,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
			sourceTask: task,
			appliedOps,
			pendingOps,
			effectiveTitle: fieldStates.title.value as string,
			effectiveDescription: fieldStates.description.value as string | undefined,
			effectiveColumnId: fieldStates.columnId.value as string,
			effectiveOrder: fieldStates.order.value as number,
			ownerDid: task.did,
			lastModifiedBy,
			lastModifiedAt
		};
	});
}

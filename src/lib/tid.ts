import { TID } from '@atproto/common-web';

export const BOARD_COLLECTION = 'blue.kanban.board';
export const TASK_COLLECTION = 'blue.kanban.task';
export const OP_COLLECTION = 'blue.kanban.op';
export const TRUST_COLLECTION = 'blue.kanban.trust';

export function generateTID(): string {
	return TID.nextStr();
}

export function buildAtUri(did: string, collection: string, rkey: string): string {
	return `at://${did}/${collection}/${rkey}`;
}

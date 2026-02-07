import { db } from './db.js';
import { TASK_COLLECTION, OP_COLLECTION } from './tid.js';

const JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';

export interface JetstreamCommitEvent {
	did: string;
	time_us: number;
	kind: 'commit';
	commit: {
		rev: string;
		operation: 'create' | 'update' | 'delete';
		collection: string;
		rkey: string;
		record?: Record<string, unknown>;
	};
}

export interface JetstreamOptions {
	wantedCollections: string[];
	cursor?: number;
	onEvent: (event: JetstreamCommitEvent) => void;
	onError?: (error: Event) => void;
	onConnect?: () => void;
}

const CURSOR_KEY = 'jetstream-cursor';
const CURSOR_SAVE_INTERVAL = 5000;

export class JetstreamClient {
	private ws: WebSocket | null = null;
	private options: JetstreamOptions;
	private reconnectDelay = 1000;
	private maxReconnectDelay = 30000;
	private shouldReconnect = true;
	private lastCursor: number | null = null;
	private cursorSaveTimer: ReturnType<typeof setInterval> | null = null;

	constructor(options: JetstreamOptions) {
		this.options = options;
		if (options.cursor) {
			this.lastCursor = options.cursor;
		}
	}

	connect(): void {
		const params = new URLSearchParams();
		for (const collection of this.options.wantedCollections) {
			params.append('wantedCollections', collection);
		}
		if (this.lastCursor) {
			params.append('cursor', String(this.lastCursor));
		}

		const url = `${JETSTREAM_URL}?${params.toString()}`;
		this.ws = new WebSocket(url);

		this.ws.onopen = () => {
			this.reconnectDelay = 1000;
			this.options.onConnect?.();
			this.startCursorSaving();
		};

		this.ws.onmessage = (event: MessageEvent) => {
			this.handleMessage(event);
		};

		this.ws.onerror = (event: Event) => {
			this.options.onError?.(event);
		};

		this.ws.onclose = () => {
			this.stopCursorSaving();
			this.handleClose();
		};
	}

	private handleMessage(event: MessageEvent): void {
		try {
			const data = JSON.parse(event.data as string) as JetstreamCommitEvent;
			if (data.kind === 'commit' && data.time_us) {
				this.lastCursor = data.time_us;
				this.options.onEvent(data);
			}
		} catch {
			// Ignore malformed messages
		}
	}

	private handleClose(): void {
		if (!this.shouldReconnect) return;

		setTimeout(() => {
			if (this.shouldReconnect) {
				this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
				this.connect();
			}
		}, this.reconnectDelay);
	}

	private startCursorSaving(): void {
		this.cursorSaveTimer = setInterval(() => {
			if (this.lastCursor) {
				saveJetstreamCursor(this.lastCursor).catch(console.error);
			}
		}, CURSOR_SAVE_INTERVAL);
	}

	private stopCursorSaving(): void {
		if (this.cursorSaveTimer) {
			clearInterval(this.cursorSaveTimer);
			this.cursorSaveTimer = null;
		}
		// Save final cursor
		if (this.lastCursor) {
			saveJetstreamCursor(this.lastCursor).catch(console.error);
		}
	}

	disconnect(): void {
		this.shouldReconnect = false;
		this.stopCursorSaving();
		this.ws?.close();
		this.ws = null;
	}
}

export async function loadJetstreamCursor(): Promise<number | undefined> {
	try {
		const value = localStorage.getItem(CURSOR_KEY);
		return value ? Number(value) : undefined;
	} catch {
		return undefined;
	}
}

async function saveJetstreamCursor(cursor: number): Promise<void> {
	try {
		localStorage.setItem(CURSOR_KEY, String(cursor));
	} catch {
		// Ignore storage errors
	}
}

/**
 * Process a Jetstream event and upsert it into the local DB if it's relevant
 * to any board we're tracking. Returns the DID of the event author if it was
 * relevant (for known participant tracking).
 */
export async function processJetstreamEvent(
	event: JetstreamCommitEvent,
	watchedBoardUris: Set<string>
): Promise<string | null> {
	const { did, commit } = event;

	if (commit.operation === 'delete') {
		// Handle deletions
		if (commit.collection === TASK_COLLECTION) {
			const existing = await db.tasks.where('[did+rkey]').equals([did, commit.rkey]).first();
			if (existing?.id) {
				await db.tasks.delete(existing.id);
				return did;
			}
		} else if (commit.collection === OP_COLLECTION) {
			const existing = await db.ops.where('[did+rkey]').equals([did, commit.rkey]).first();
			if (existing?.id) {
				await db.ops.delete(existing.id);
				return did;
			}
		}
		return null;
	}

	if (!commit.record) return null;

	const record = commit.record;
	const boardUri = record.boardUri as string | undefined;

	// Only process records that reference boards we're watching
	if (!boardUri || !watchedBoardUris.has(boardUri)) return null;

	if (commit.collection === TASK_COLLECTION) {
		const existing = await db.tasks.where('[did+rkey]').equals([did, commit.rkey]).first();

		const taskData = {
			rkey: commit.rkey,
			did,
			title: (record.title as string) ?? '',
			description: record.description as string | undefined,
			columnId: (record.columnId as string) ?? '',
			boardUri,
			order: (record.order as number) ?? 0,
			createdAt: (record.createdAt as string) ?? new Date().toISOString(),
			updatedAt: record.updatedAt as string | undefined,
			syncStatus: 'synced' as const
		};

		if (existing?.id) {
			await db.tasks.update(existing.id, taskData);
		} else {
			await db.tasks.add(taskData);
		}
		return did;
	}

	if (commit.collection === OP_COLLECTION) {
		const existing = await db.ops.where('[did+rkey]').equals([did, commit.rkey]).first();

		const opData = {
			rkey: commit.rkey,
			did,
			targetTaskUri: (record.targetTaskUri as string) ?? '',
			boardUri,
			fields: (record.fields as Record<string, unknown>) ?? {},
			createdAt: (record.createdAt as string) ?? new Date().toISOString(),
			syncStatus: 'synced' as const
		};

		if (existing?.id) {
			await db.ops.update(existing.id, opData);
		} else {
			await db.ops.add(opData);
		}
		return did;
	}

	return null;
}

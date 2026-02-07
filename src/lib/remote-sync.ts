import { db } from './db.js';
import { TASK_COLLECTION, OP_COLLECTION, BOARD_COLLECTION } from './tid.js';
import type { Task, Op, Board } from './types.js';

// Cache resolved PDS endpoints to avoid repeated lookups
const pdsCache = new Map<string, string>();

/**
 * Resolve a DID to its PDS service endpoint.
 * For did:plc, queries plc.directory. For did:web, fetches /.well-known/did.json.
 */
async function resolvePDS(did: string): Promise<string | null> {
	const cached = pdsCache.get(did);
	if (cached) return cached;

	try {
		let didDoc: Record<string, unknown>;

		if (did.startsWith('did:plc:')) {
			const res = await fetch(`https://plc.directory/${did}`);
			if (!res.ok) return null;
			didDoc = await res.json();
		} else if (did.startsWith('did:web:')) {
			const host = did.slice('did:web:'.length).replaceAll(':', '/');
			const res = await fetch(`https://${host}/.well-known/did.json`);
			if (!res.ok) return null;
			didDoc = await res.json();
		} else {
			return null;
		}

		// Extract the PDS service endpoint from the DID document
		const services = didDoc.service as Array<{ id: string; type: string; serviceEndpoint: string }> | undefined;
		const pds = services?.find(
			(s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
		);
		if (!pds?.serviceEndpoint) return null;

		pdsCache.set(did, pds.serviceEndpoint);
		return pds.serviceEndpoint;
	} catch {
		return null;
	}
}

async function fetchRecordsFromRepo(
	repoDid: string,
	collection: string
): Promise<Array<{ uri: string; value: Record<string, unknown> }>> {
	const pds = await resolvePDS(repoDid);
	if (!pds) return [];

	const records: Array<{ uri: string; value: Record<string, unknown> }> = [];
	let cursor: string | undefined;

	do {
		const params = new URLSearchParams({
			repo: repoDid,
			collection,
			limit: '100'
		});
		if (cursor) params.set('cursor', cursor);

		const res = await fetch(
			`${pds}/xrpc/com.atproto.repo.listRecords?${params.toString()}`
		);
		if (!res.ok) break;

		const data = await res.json();
		records.push(...(data.records ?? []));
		cursor = data.cursor;
	} while (cursor);

	return records;
}

export async function fetchRemoteTasks(
	participantDid: string,
	boardUri: string
): Promise<void> {
	const records = await fetchRecordsFromRepo(participantDid, TASK_COLLECTION);

	for (const record of records) {
		const value = record.value;
		if (value.boardUri !== boardUri) continue;

		const rkey = record.uri.split('/').pop()!;
		const existing = await db.tasks
			.where('[did+rkey]')
			.equals([participantDid, rkey])
			.first();

		const taskData: Omit<Task, 'id'> = {
			rkey,
			did: participantDid,
			title: (value.title as string) ?? '',
			description: value.description as string | undefined,
			columnId: (value.columnId as string) ?? '',
			boardUri,
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
}

export async function fetchRemoteOps(
	participantDid: string,
	boardUri: string
): Promise<void> {
	const records = await fetchRecordsFromRepo(participantDid, OP_COLLECTION);

	for (const record of records) {
		const value = record.value;
		if (value.boardUri !== boardUri) continue;

		const rkey = record.uri.split('/').pop()!;
		const existing = await db.ops
			.where('[did+rkey]')
			.equals([participantDid, rkey])
			.first();

		const opData: Omit<Op, 'id'> = {
			rkey,
			did: participantDid,
			targetTaskUri: (value.targetTaskUri as string) ?? '',
			boardUri,
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
}

export async function fetchRemoteBoard(
	ownerDid: string,
	collection: string,
	rkey: string
): Promise<Board | null> {
	try {
		const pds = await resolvePDS(ownerDid);
		if (!pds) return null;

		const params = new URLSearchParams({
			repo: ownerDid,
			collection,
			rkey
		});
		const res = await fetch(
			`${pds}/xrpc/com.atproto.repo.getRecord?${params.toString()}`
		);
		if (!res.ok) return null;

		const data = await res.json();
		const value = data.value as Record<string, unknown>;

		return {
			rkey,
			did: ownerDid,
			name: (value.name as string) ?? '',
			description: value.description as string | undefined,
			columns: (value.columns as Board['columns']) ?? [],
			permissions: value.permissions as Board['permissions'],
			createdAt: (value.createdAt as string) ?? new Date().toISOString(),
			syncStatus: 'synced'
		};
	} catch {
		return null;
	}
}

// --- Known participants management ---

export async function addKnownParticipant(did: string, boardUri: string): Promise<void> {
	const existing = await db.knownParticipants
		.where('[did+boardUri]')
		.equals([did, boardUri])
		.first();
	if (existing) return;

	await db.knownParticipants.add({
		did,
		boardUri,
		discoveredAt: new Date().toISOString()
	});
}

export async function getKnownParticipants(boardUri: string): Promise<string[]> {
	const participants = await db.knownParticipants
		.where('boardUri')
		.equals(boardUri)
		.toArray();
	return participants.map((p) => p.did);
}

export async function fetchAllKnownParticipants(boardUri: string): Promise<void> {
	const dids = await getKnownParticipants(boardUri);

	// Fetch in parallel with concurrency limit of 3
	const concurrency = 3;
	for (let i = 0; i < dids.length; i += concurrency) {
		const batch = dids.slice(i, i + concurrency);
		await Promise.allSettled(
			batch.flatMap((did) => [fetchRemoteTasks(did, boardUri), fetchRemoteOps(did, boardUri)])
		);
	}
}

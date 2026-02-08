import { db } from './db.js';
import { generateTID } from './tid.js';
import { deleteTrustFromPDS } from './sync.js';
import { getAuth } from './auth.svelte.js';
import type { Trust, TrustRecord } from './types.js';

export async function grantTrust(
	did: string,
	trustedDid: string,
	boardUri: string
): Promise<void> {
	const existing = await db.trusts
		.where('[did+boardUri+trustedDid]')
		.equals([did, boardUri, trustedDid])
		.first();
	if (existing) return;

	await db.trusts.add({
		rkey: generateTID(),
		did,
		trustedDid,
		boardUri,
		createdAt: new Date().toISOString(),
		syncStatus: 'pending'
	});
}

export async function revokeTrust(
	did: string,
	trustedDid: string,
	boardUri: string
): Promise<void> {
	const trust = await db.trusts
		.where('[did+boardUri+trustedDid]')
		.equals([did, boardUri, trustedDid])
		.first();
	if (!trust || !trust.id) return;

	// Delete from PDS if it was synced
	if (trust.syncStatus === 'synced') {
		const auth = getAuth();
		if (auth.agent) {
			await deleteTrustFromPDS(auth.agent, did, trust);
		}
	}

	await db.trusts.delete(trust.id);
}

export async function getTrustedDids(did: string, boardUri: string): Promise<string[]> {
	const trusts = await db.trusts
		.where('did')
		.equals(did)
		.filter((t) => t.boardUri === boardUri)
		.toArray();
	return trusts.map((t) => t.trustedDid);
}

export function trustToRecord(trust: Trust): TrustRecord {
	return {
		$type: 'dev.skyboard.trust',
		trustedDid: trust.trustedDid,
		boardUri: trust.boardUri,
		createdAt: trust.createdAt
	};
}

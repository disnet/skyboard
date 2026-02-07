interface ProfileData {
	handle: string;
	displayName?: string;
	avatar?: string;
	fetchedAt: number;
}

interface ProfileState {
	loading: boolean;
	data: ProfileData | null;
	error: boolean;
}

const PUBLIC_API = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

const DEFAULT_STATE: ProfileState = { loading: false, data: null, error: false };

// Module-level reactive cache
let profiles = $state<Record<string, ProfileState>>({});

// In-flight request deduplication
const inflight = new Map<string, Promise<void>>();

async function fetchProfile(did: string): Promise<void> {
	if (inflight.has(did)) return;

	const promise = (async () => {
		try {
			const res = await fetch(`${PUBLIC_API}?actor=${encodeURIComponent(did)}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();

			profiles[did] = {
				loading: false,
				error: false,
				data: {
					handle: data.handle,
					displayName: data.displayName || undefined,
					avatar: data.avatar || undefined,
					fetchedAt: Date.now()
				}
			};
		} catch {
			profiles[did] = {
				loading: false,
				error: true,
				data: null
			};
		} finally {
			inflight.delete(did);
		}
	})();

	inflight.set(did, promise);
}

/**
 * Pure read — safe to call inside $derived.
 * Returns the current cached profile state without side effects.
 */
export function getProfile(did: string): ProfileState {
	return profiles[did] ?? DEFAULT_STATE;
}

/**
 * Side-effectful — call from $effect to trigger fetching.
 * Starts a fetch if the profile is missing, expired, or errored.
 */
export function ensureProfile(did: string): void {
	const cached = profiles[did];

	// Already valid and not expired
	if (cached?.data && Date.now() - cached.data.fetchedAt < TTL_MS) return;

	// Already loading
	if (cached?.loading) return;

	// Expired but have stale data — keep showing stale while refetching
	if (cached?.data) {
		profiles[did] = { loading: true, data: cached.data, error: false };
		fetchProfile(did);
		return;
	}

	// No data at all — start fresh fetch
	profiles[did] = { loading: true, data: null, error: false };
	fetchProfile(did);
}

export function shortDid(did: string): string {
	return did.length > 24 ? did.slice(0, 14) + '...' + did.slice(-6) : did;
}

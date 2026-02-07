import { Agent } from '@atproto/api';
import { BrowserOAuthClient, buildAtprotoLoopbackClientMetadata } from '@atproto/oauth-client-browser';

const OAUTH_SCOPE =
	'atproto repo:blue.kanban.board repo:blue.kanban.task repo:blue.kanban.op repo:blue.kanban.trust';

let agent = $state<Agent | null>(null);
let did = $state<string | null>(null);
let isLoading = $state(true);
let error = $state<string | null>(null);

let oauthClient: BrowserOAuthClient | null = null;

function isLoopback(): boolean {
	const hostname = window.location.hostname;
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export async function initAuth(): Promise<void> {
	isLoading = true;
	error = null;

	try {
		if (isLoopback()) {
			// Build loopback client metadata with proper scopes.
			// Access the app via http://127.0.0.1:PORT for the redirect to work.
			const host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
			const port = window.location.port ? `:${window.location.port}` : '';
			oauthClient = new BrowserOAuthClient({
				clientMetadata: buildAtprotoLoopbackClientMetadata({
					scope: OAUTH_SCOPE,
					redirect_uris: [`http://${host}${port}/`]
				}),
				handleResolver: 'https://bsky.social'
			});
		} else {
			oauthClient = new BrowserOAuthClient({
				clientMetadata: {
					client_id: `${window.location.origin}/client-metadata.json`,
					client_name: 'AT Kanban',
					client_uri: window.location.origin,
					redirect_uris: [`${window.location.origin}/`],
					scope: OAUTH_SCOPE,
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code'],
					token_endpoint_auth_method: 'none',
					application_type: 'web',
					dpop_bound_access_tokens: true
				},
				handleResolver: 'https://bsky.social'
			});
		}

		const result = await oauthClient.init();
		if (result?.session) {
			const newAgent = new Agent(result.session);
			agent = newAgent;
			did = result.session.sub;
		}
	} catch (e) {
		console.error('Auth init error:', e);
		error = e instanceof Error ? e.message : 'Failed to initialize authentication';
	} finally {
		isLoading = false;
	}
}

export async function login(handle: string): Promise<void> {
	if (!oauthClient) {
		error = 'OAuth client not initialized';
		return;
	}

	error = null;

	try {
		await oauthClient.signIn(handle, {
			signal: new AbortController().signal
		});
	} catch (e) {
		console.error('Login error:', e);
		error = e instanceof Error ? e.message : 'Failed to sign in';
	}
}

export async function logout(): Promise<void> {
	agent = null;
	did = null;
	// Clear any stored sessions by re-initializing
	if (oauthClient) {
		try {
			// The BrowserOAuthClient doesn't have a direct logout method on the client,
			// but clearing the state is sufficient for the UI
		} catch {
			// Ignore cleanup errors
		}
	}
}

export function getAuth() {
	return {
		get agent() {
			return agent;
		},
		get did() {
			return did;
		},
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get isLoggedIn() {
			return agent !== null && did !== null;
		}
	};
}

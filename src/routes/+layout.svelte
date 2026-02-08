<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { initAuth, getAuth, logout } from '$lib/auth.svelte.js';
	import { pullFromPDS, startBackgroundSync, stopBackgroundSync } from '$lib/sync.js';
	import { getProfile, ensureProfile } from '$lib/profile-cache.svelte.js';
	import LandingPage from '$lib/components/LandingPage.svelte';
	import SyncStatus from '$lib/components/SyncStatus.svelte';
	import '../app.css';

	const auth = getAuth();
	let { children } = $props();
	const currentProfile = $derived(auth.did ? getProfile(auth.did) : null);
	const isPublicRoute = $derived(/^\/board\/did:[^/]+\/[^/]+$/.test($page.url.pathname));

	$effect(() => {
		if (auth.did) ensureProfile(auth.did);
	});

	onMount(() => {
		initAuth();

		return () => {
			stopBackgroundSync();
		};
	});

	$effect(() => {
		if (auth.agent && auth.did) {
			pullFromPDS(auth.agent, auth.did).catch(console.error);
			startBackgroundSync(auth.agent, auth.did);
		}
	});

	async function handleLogout() {
		stopBackgroundSync();
		await logout();
	}
</script>

{#if auth.isLoading}
	<div class="loading">
		<div class="spinner"></div>
		<p>Loading...</p>
	</div>
{:else if !auth.isLoggedIn && !isPublicRoute}
	<LandingPage />
{:else if !auth.isLoggedIn && isPublicRoute}
	<div class="app">
		<header class="app-header">
			<div class="header-left">
				<a href="/" class="logo">Skyboard</a>
			</div>
			<div class="header-right">
				<a href="/" class="sign-in-link">Sign in</a>
			</div>
		</header>
		<main class="app-main">
			{@render children()}
		</main>
	</div>
{:else}
	<div class="app">
		<header class="app-header">
			<div class="header-left">
				<a href="/" class="logo">Skyboard</a>
			</div>
			<div class="header-right">
				<SyncStatus />
				<span class="user-did" title={auth.did ?? ''}>
					{#if currentProfile?.data?.avatar}
						<img class="user-avatar" src={currentProfile.data.avatar} alt="" />
					{/if}
					{currentProfile?.data
						? (currentProfile.data.displayName || `@${currentProfile.data.handle}`)
						: auth.did}
				</span>
				<button class="sign-out-btn" onclick={handleLogout}>Sign Out</button>
			</div>
		</header>
		<main class="app-main">
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: var(--color-text-secondary);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 1.5rem;
		height: 56px;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.header-left {
		display: flex;
		align-items: center;
	}

	.logo {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-primary);
		text-decoration: none;
	}

	.logo:hover {
		text-decoration: none;
		opacity: 0.85;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.user-did {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.user-avatar {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.sign-out-btn {
		padding: 0.375rem 0.75rem;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.sign-out-btn:hover {
		background: var(--color-bg);
		color: var(--color-text);
	}

	.sign-in-link {
		padding: 0.375rem 0.75rem;
		background: var(--color-primary);
		color: white;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 500;
		text-decoration: none;
		transition: opacity 0.15s;
	}

	.sign-in-link:hover {
		opacity: 0.85;
		text-decoration: none;
	}

	.app-main {
		flex: 1;
		overflow: auto;
	}
</style>

<script lang="ts">
	import { login, getAuth } from '$lib/auth.svelte.js';

	const auth = getAuth();
	let handle = $state('');
	let submitting = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!handle.trim()) return;
		submitting = true;
		await login(handle.trim());
		submitting = false;
	}
</script>

<div class="login-container">
	<div class="login-card">
		<h1>Skyboard</h1>
		<p class="subtitle">Sign in with your AT Protocol identity</p>

		<form onsubmit={handleSubmit}>
			<label for="handle">Handle</label>
			<input
				id="handle"
				type="text"
				bind:value={handle}
				placeholder="e.g. alice.bsky.social"
				disabled={submitting}
				required
			/>
			<button type="submit" disabled={submitting || !handle.trim()}>
				{submitting ? 'Signing in...' : 'Sign In'}
			</button>
		</form>

		{#if auth.error}
			<p class="error">{auth.error}</p>
		{/if}
	</div>
</div>

<style>
	.login-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 1rem;
	}

	.login-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 2.5rem;
		width: 100%;
		max-width: 400px;
		box-shadow: var(--shadow-lg);
	}

	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.75rem;
		color: var(--color-primary);
	}

	.subtitle {
		margin: 0 0 1.5rem;
		color: var(--color-text-secondary);
		font-size: 0.875rem;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	input {
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		background: var(--color-bg);
		color: var(--color-text);
		transition: border-color 0.15s;
	}

	input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px var(--color-primary-alpha);
	}

	button {
		padding: 0.625rem 1rem;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	button:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.error {
		margin: 1rem 0 0;
		padding: 0.625rem;
		background: var(--color-error-bg);
		color: var(--color-error);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
	}
</style>

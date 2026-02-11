<script lang="ts">
  import {
    getProfile,
    ensureProfile,
    shortDid,
  } from "$lib/profile-cache.svelte.js";

  let {
    did,
    isCurrentUser = false,
  }: {
    did: string;
    isCurrentUser?: boolean;
  } = $props();

  $effect(() => {
    ensureProfile(did);
  });

  const profile = $derived(getProfile(did));
  const displayText = $derived(
    profile.data
      ? profile.data.displayName || `@${profile.data.handle}`
      : shortDid(did),
  );
  const avatarUrl = $derived(profile.data?.avatar ?? null);
</script>

<span class="author-badge" class:own={isCurrentUser} title={did}>
  {#if avatarUrl}
    <img class="avatar" src={avatarUrl} alt="" />
  {/if}
  <span class="author-name">
    {displayText}
  </span>
</span>

<style>
  .author-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    background: var(--color-bg);
    padding: 0.0625rem 0.375rem;
    border-radius: var(--radius-sm);
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
  }

  .author-badge.own {
    color: var(--color-primary);
    background: var(--color-primary-alpha, rgba(0, 102, 204, 0.08));
  }

  .avatar {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .author-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

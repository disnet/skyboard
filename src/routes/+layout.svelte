<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { initAuth, getAuth, logout } from "$lib/auth.svelte.js";
  import { startBackgroundSync, stopBackgroundSync } from "$lib/sync.js";
  import { getProfile, ensureProfile } from "$lib/profile-cache.svelte.js";
  import { db } from "$lib/db.js";
  import { useLiveQuery } from "$lib/db.svelte.js";
  import { generateCatchUpNotifications } from "$lib/notifications.js";
  import { loadBoardFromAppview, AppviewSubscription } from "$lib/appview.js";
  import type { Board } from "$lib/types.js";
  import { initTheme, getTheme, cycleTheme } from "$lib/theme.svelte.js";
  import LandingPage from "$lib/components/LandingPage.svelte";
  import SyncStatus from "$lib/components/SyncStatus.svelte";
  import NotificationPanel from "$lib/components/NotificationPanel.svelte";
  import KeyboardShortcutsModal from "$lib/components/KeyboardShortcutsModal.svelte";
  import BoardSwitcherModal from "$lib/components/BoardSwitcherModal.svelte";
  import "../app.css";

  const auth = getAuth();
  const theme = getTheme();
  let { children } = $props();
  const currentProfile = $derived(auth.did ? getProfile(auth.did) : null);
  const isPublicRoute = $derived(
    /^\/board\/did:[^/]+\/[^/]+$/.test($page.url.pathname),
  );

  let showNotifications = $state(false);
  let showShortcuts = $state(false);
  let showBoardSwitcher = $state(false);
  let boardSubs: AppviewSubscription[] = [];
  let effectGeneration = 0;

  const unreadCount = useLiveQuery<number>(() => {
    if (!auth.did) return 0;
    return db.notifications.where("read").equals(0).count();
  });

  $effect(() => {
    if (auth.did) ensureProfile(auth.did);
  });

  onMount(() => {
    initAuth();
    initTheme();

    return () => {
      stopBackgroundSync();
      disconnectAllSubs();
    };
  });

  // Refresh all local boards via appview, then generate catch-up notifications
  async function catchUpAllBoards(userDid: string, handle: string | undefined) {
    const boards = await db.boards.toArray();
    await Promise.allSettled(
      boards.map(async (b) => {
        const boardUri = `at://${b.did}/dev.skyboard.board/${b.rkey}`;
        await loadBoardFromAppview(b.did, b.rkey, boardUri);
      }),
    );
    await generateCatchUpNotifications(userDid, handle);
  }

  function disconnectAllSubs() {
    for (const sub of boardSubs) sub.disconnect();
    boardSubs = [];
  }

  function connectBoardSubs(boards: Board[], userDid: string) {
    disconnectAllSubs();
    for (const b of boards) {
      const boardUri = `at://${b.did}/dev.skyboard.board/${b.rkey}`;
      const sub = new AppviewSubscription(boardUri, async () => {
        await loadBoardFromAppview(b.did, b.rkey, boardUri);
        const handle = getProfile(userDid)?.data?.handle;
        await generateCatchUpNotifications(userDid, handle);
      });
      sub.connect();
      boardSubs.push(sub);
    }
  }

  $effect(() => {
    if (auth.agent && auth.did) {
      const generation = ++effectGeneration;
      const userDid = auth.did;
      const handle = currentProfile?.data?.handle;
      catchUpAllBoards(userDid, handle)
        .then(async () => {
          if (generation !== effectGeneration) return;
          const boards = await db.boards.toArray();
          connectBoardSubs(boards, userDid);
        })
        .catch(console.error);
      startBackgroundSync(auth.agent, userDid);
    }
  });

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (showShortcuts || showNotifications || showBoardSwitcher) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if ((e.target as HTMLElement)?.isContentEditable) return;
    if (e.key === "?") {
      e.preventDefault();
      showShortcuts = true;
    }
    if (e.key === "b") {
      e.preventDefault();
      showBoardSwitcher = true;
    }
  }

  async function handleLogout() {
    stopBackgroundSync();
    disconnectAllSubs();
    await logout();
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

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
        <button
          class="theme-btn"
          onclick={cycleTheme}
          title="Toggle theme — {theme.mode}"
        >
          {#if theme.effectiveTheme === "dark"}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          {:else}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          {/if}
        </button>
        <a
          href="https://github.com/disnet/skyboard"
          target="_blank"
          rel="noopener noreferrer"
          class="github-link"
          title="GitHub"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
            />
          </svg>
        </a>
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
        <button
          class="bell-btn"
          onclick={() => (showNotifications = !showNotifications)}
          title="Notifications"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {#if (unreadCount.current ?? 0) > 0}
            <span class="bell-badge">{unreadCount.current}</span>
          {/if}
        </button>
        <button
          class="theme-btn"
          onclick={cycleTheme}
          title="Toggle theme — {theme.mode}"
        >
          {#if theme.effectiveTheme === "dark"}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          {:else}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          {/if}
        </button>
        <button
          class="help-btn"
          onclick={() => (showShortcuts = true)}
          title="Keyboard shortcuts (?)">?</button
        >
        <a
          href="https://github.com/disnet/skyboard"
          target="_blank"
          rel="noopener noreferrer"
          class="github-link"
          title="GitHub"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
            />
          </svg>
        </a>
        <span class="user-did" title={auth.did ?? ""}>
          {#if currentProfile?.data?.avatar}
            <img class="user-avatar" src={currentProfile.data.avatar} alt="" />
          {/if}
          {currentProfile?.data
            ? currentProfile.data.displayName ||
              `@${currentProfile.data.handle}`
            : auth.did}
        </span>
        <button class="sign-out-btn" onclick={handleLogout}>Sign Out</button>
      </div>
    </header>
    <main class="app-main">
      {@render children()}
    </main>
  </div>

  {#if showNotifications}
    <NotificationPanel onclose={() => (showNotifications = false)} />
  {/if}

  {#if showShortcuts}
    <KeyboardShortcutsModal onclose={() => (showShortcuts = false)} />
  {/if}

  {#if showBoardSwitcher}
    <BoardSwitcherModal onclose={() => (showBoardSwitcher = false)} />
  {/if}
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

  .github-link {
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    transition: color 0.15s;
  }

  .github-link:hover {
    color: var(--color-text);
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

  .theme-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .theme-btn:hover {
    color: var(--color-text);
    border-color: var(--color-text-secondary);
  }

  .help-btn {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .help-btn:hover {
    color: var(--color-text);
    border-color: var(--color-text-secondary);
  }

  .bell-btn {
    position: relative;
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    transition: color 0.15s;
  }

  .bell-btn:hover {
    color: var(--color-text);
  }

  .bell-badge {
    position: absolute;
    top: -4px;
    right: -6px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: var(--color-error);
    color: white;
    font-size: 0.625rem;
    font-weight: 700;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
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
    overflow-y: auto;
    overflow-x: hidden;
  }

  @media (max-width: 600px) {
    .app-header {
      padding: 0 0.75rem;
    }

    .header-right {
      gap: 0.5rem;
    }

    .user-did {
      max-width: none;
      font-size: 0;
    }

    .user-avatar {
      width: 22px;
      height: 22px;
    }

    .sign-out-btn {
      padding: 0.3125rem 0.5rem;
      font-size: 0.75rem;
    }
  }
</style>

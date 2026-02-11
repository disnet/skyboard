<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { initAuth, getAuth, logout } from "$lib/auth.svelte.js";
  import {
    pullFromPDS,
    startBackgroundSync,
    stopBackgroundSync,
  } from "$lib/sync.js";
  import { getProfile, ensureProfile } from "$lib/profile-cache.svelte.js";
  import { db } from "$lib/db.js";
  import { useLiveQuery } from "$lib/db.svelte.js";
  import {
    generateCatchUpNotifications,
    generateNotificationFromEvent,
  } from "$lib/notifications.js";
  import {
    JetstreamClient,
    loadJetstreamCursor,
    processJetstreamEvent,
  } from "$lib/jetstream.js";
  import {
    TASK_COLLECTION,
    COMMENT_COLLECTION,
    OP_COLLECTION,
  } from "$lib/tid.js";
  import {
    fetchAllKnownParticipants,
    addKnownParticipant,
  } from "$lib/remote-sync.js";
  import LandingPage from "$lib/components/LandingPage.svelte";
  import SyncStatus from "$lib/components/SyncStatus.svelte";
  import NotificationPanel from "$lib/components/NotificationPanel.svelte";
  import KeyboardShortcutsModal from "$lib/components/KeyboardShortcutsModal.svelte";
  import "../app.css";

  const auth = getAuth();
  let { children } = $props();
  const currentProfile = $derived(auth.did ? getProfile(auth.did) : null);
  const isPublicRoute = $derived(
    /^\/board\/did:[^/]+\/[^/]+$/.test($page.url.pathname),
  );

  let showNotifications = $state(false);
  let showShortcuts = $state(false);
  let globalJetstream: JetstreamClient | null = null;

  const unreadCount = useLiveQuery<number>(() => {
    if (!auth.did) return 0;
    return db.notifications.where("read").equals(0).count();
  });

  $effect(() => {
    if (auth.did) ensureProfile(auth.did);
  });

  onMount(() => {
    initAuth();

    return () => {
      stopBackgroundSync();
      globalJetstream?.disconnect();
      globalJetstream = null;
    };
  });

  // Fetch participants for all local boards, then generate catch-up notifications
  async function catchUpAllBoards(userDid: string, handle: string | undefined) {
    const boards = await db.boards.toArray();
    const boardUris = boards.map(
      (b) => `at://${b.did}/dev.skyboard.board/${b.rkey}`,
    );
    // Fetch known participants' data for each board
    await Promise.allSettled(
      boardUris.map((uri) => fetchAllKnownParticipants(uri)),
    );
    await generateCatchUpNotifications(userDid, handle);
  }

  $effect(() => {
    if (auth.agent && auth.did) {
      const userDid = auth.did;
      const handle = currentProfile?.data?.handle;
      pullFromPDS(auth.agent, userDid)
        .then(() => catchUpAllBoards(userDid, handle))
        .catch(console.error);
      startBackgroundSync(auth.agent, userDid);
    }
  });

  // Global Jetstream for real-time notifications on any page
  $effect(() => {
    if (!auth.did) return;
    const userDid = auth.did;

    loadJetstreamCursor().then((cursor) => {
      globalJetstream = new JetstreamClient({
        wantedCollections: [TASK_COLLECTION, COMMENT_COLLECTION, OP_COLLECTION],
        cursor,
        onEvent: async (event) => {
          if (event.did === userDid) return;
          // Store the record into Dexie so catch-up and board views stay current
          const result = await processJetstreamEvent(event);
          if (result) {
            addKnownParticipant(result.did, result.boardUri).catch(
              console.error,
            );
            if (event.commit.operation === "create") {
              const handle = getProfile(userDid)?.data?.handle;
              generateNotificationFromEvent(event, userDid, handle).catch(
                console.error,
              );
            }
          }
        },
        onReconnect: () => {
          catchUpAllBoards(userDid, getProfile(userDid)?.data?.handle).catch(
            console.error,
          );
        },
      });
      globalJetstream.connect();
    });

    return () => {
      globalJetstream?.disconnect();
      globalJetstream = null;
    };
  });

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (showShortcuts || showNotifications) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if ((e.target as HTMLElement)?.isContentEditable) return;
    if (e.key === "?") {
      e.preventDefault();
      showShortcuts = true;
    }
  }

  async function handleLogout() {
    stopBackgroundSync();
    globalJetstream?.disconnect();
    globalJetstream = null;
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
          class="help-btn"
          onclick={() => (showShortcuts = true)}
          title="Keyboard shortcuts (?)"
        >?</button>
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
    transition: color 0.15s, border-color 0.15s;
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
    overflow: auto;
  }
</style>

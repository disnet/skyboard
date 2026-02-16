<script lang="ts">
  let { onclose }: { onclose: () => void } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onclose();
    }
  }

  let mouseDownOnBackdrop = false;

  function handleBackdropMouseDown(e: MouseEvent) {
    mouseDownOnBackdrop = e.target === e.currentTarget;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && mouseDownOnBackdrop) onclose();
    mouseDownOnBackdrop = false;
  }

  const sections = [
    {
      title: "Navigation",
      shortcuts: [
        {
          keys: ["\u2190", "\u2191", "\u2193", "\u2192"],
          sep: "",
          alt: ["h", "j", "k", "l"],
          description: "Navigate between tasks",
        },
        { keys: ["Esc"], description: "Deselect task" },
      ],
    },
    {
      title: "Editing",
      shortcuts: [
        { keys: ["Enter"], description: "Open task editor" },
        { keys: ["e"], description: "Inline edit task title" },
        { keys: ["t"], description: "Quick label selected task" },
        { keys: ["n"], description: "New task in current column" },
      ],
    },
    {
      title: "Moving Tasks",
      shortcuts: [
        {
          keys: [","],
          sep: "/",
          alt: ["."],
          description: "Move task left / right",
        },
        {
          keys: ["<"],
          sep: "/",
          alt: [">"],
          description: "Move task to top of adjacent column",
        },
        {
          keys: ["\u21E7", "H"],
          sep: "/",
          alt: ["\u21E7", "L"],
          description: "Move task to top of adjacent column",
        },
        {
          keys: ["\u21E7", "\u2191"],
          sep: "/",
          alt: ["\u21E7", "\u2193"],
          description: "Reorder task up / down",
        },
        {
          keys: ["\u21E7", "K"],
          sep: "/",
          alt: ["\u21E7", "J"],
          description: "Reorder task up / down",
        },
        {
          keys: ["\u21E7", "Home"],
          sep: "/",
          alt: ["\u21E7", "End"],
          description: "Send task to top / bottom of column",
        },
        { keys: ["m"], description: "Quick move to column" },
      ],
    },
    {
      title: "General",
      shortcuts: [
        { keys: ["b"], description: "Switch board" },
        { keys: ["?"], description: "Show this help" },
      ],
    },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-backdrop"
  onmousedown={handleBackdropMouseDown}
  onclick={handleBackdropClick}
>
  <div class="modal" role="dialog" aria-label="Keyboard shortcuts">
    <div class="modal-header">
      <h3>Keyboard Shortcuts</h3>
      <button class="close-btn" onclick={onclose}>&times;</button>
    </div>
    <div class="modal-body">
      {#each sections as section}
        <div class="section">
          <h4 class="section-title">{section.title}</h4>
          {#each section.shortcuts as shortcut}
            <div class="shortcut-row">
              <div class="keys">
                {#each shortcut.keys as key}<kbd>{key}</kbd>{/each}
                {#if shortcut.alt}
                  <span class="sep">{shortcut.sep ?? "/"}</span>
                  {#each shortcut.alt as key}<kbd>{key}</kbd>{/each}
                {/if}
              </div>
              <span class="description">{shortcut.description}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--color-backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1rem;
  }

  .modal {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--color-border-light);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.25rem;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 0.25rem;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--color-text);
  }

  .modal-body {
    padding: 0.75rem 1.25rem 1.25rem;
  }

  .section {
    margin-bottom: 1rem;
  }

  .section:last-child {
    margin-bottom: 0;
  }

  .section-title {
    margin: 0 0 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-secondary);
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0;
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .sep {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    margin: 0 0.125rem;
  }

  kbd {
    display: inline-block;
    padding: 0.15rem 0.4rem;
    font-size: 0.75rem;
    font-family: inherit;
    color: var(--color-text);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    line-height: 1.4;
  }

  .description {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
</style>

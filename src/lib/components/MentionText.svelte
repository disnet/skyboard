<script lang="ts">
  let { text }: { text: string } = $props();

  const MENTION_RE =
    /@((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g;

  interface Segment {
    type: "text" | "mention";
    value: string;
  }

  const segments = $derived.by(() => {
    const result: Segment[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    MENTION_RE.lastIndex = 0;
    while ((m = MENTION_RE.exec(text)) !== null) {
      if (m.index > lastIndex) {
        result.push({ type: "text", value: text.slice(lastIndex, m.index) });
      }
      result.push({ type: "mention", value: m[0] });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) {
      result.push({ type: "text", value: text.slice(lastIndex) });
    }
    return result;
  });
</script>

{#each segments as seg}{#if seg.type === "mention"}<span class="mention"
      >{seg.value}</span
    >{:else}{seg.value}{/if}{/each}

<style>
  .mention {
    color: var(--color-primary);
    background: var(--color-primary-alpha, rgba(0, 102, 204, 0.1));
    font-weight: 500;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>

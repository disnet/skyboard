import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

const TYPEAHEAD_API =
  "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead";

export async function mentionCompletionSource(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const match = context.matchBefore(/@[a-zA-Z0-9._-]{2,}/);
  if (!match) return null;

  const query = match.text.slice(1); // strip leading @

  try {
    const url = `${TYPEAHEAD_API}?q=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const actors: Array<{ handle: string; displayName?: string }> =
      data.actors ?? [];

    if (actors.length === 0) return null;

    return {
      from: match.from,
      options: actors.map((a) => ({
        label: `@${a.handle}`,
        detail: a.displayName,
      })),
    };
  } catch {
    return null;
  }
}

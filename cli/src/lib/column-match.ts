import type { Column } from "./types.js";

/**
 * Match a column reference (name, prefix, or 1-based index) to a column.
 * Throws with a helpful message if no match found.
 */
export function resolveColumn(
  ref: string,
  columns: Column[],
): Column {
  const sorted = [...columns].sort((a, b) => a.order - b.order);

  // Try numeric index (1-based)
  const idx = parseInt(ref, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= sorted.length) {
    return sorted[idx - 1];
  }

  // Try exact match (case-insensitive)
  const exact = sorted.find((c) => c.name.toLowerCase() === ref.toLowerCase());
  if (exact) return exact;

  // Try prefix match
  const prefixMatches = sorted.filter((c) =>
    c.name.toLowerCase().startsWith(ref.toLowerCase()),
  );
  if (prefixMatches.length === 1) return prefixMatches[0];
  if (prefixMatches.length > 1) {
    const list = prefixMatches.map((c, i) => `  ${i + 1}. ${c.name}`).join("\n");
    throw new Error(`Ambiguous column "${ref}". Matches:\n${list}`);
  }

  // Try substring match
  const subMatches = sorted.filter((c) =>
    c.name.toLowerCase().includes(ref.toLowerCase()),
  );
  if (subMatches.length === 1) return subMatches[0];
  if (subMatches.length > 1) {
    const list = subMatches.map((c, i) => `  ${i + 1}. ${c.name}`).join("\n");
    throw new Error(`Ambiguous column "${ref}". Matches:\n${list}`);
  }

  const allCols = sorted.map((c, i) => `  ${i + 1}. ${c.name}`).join("\n");
  throw new Error(`No column matching "${ref}". Available columns:\n${allCols}`);
}

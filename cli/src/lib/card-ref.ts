import type { MaterializedTask } from "./types.js";

const MIN_PREFIX_LEN = 4;

/**
 * Resolve a card reference (TID rkey prefix) to a unique task.
 * Returns the matching task, or throws with a helpful message if
 * ambiguous or not found.
 */
export function resolveCardRef(
  ref: string,
  tasks: MaterializedTask[],
): MaterializedTask {
  if (ref.length < MIN_PREFIX_LEN) {
    throw new Error(
      `Card reference too short (min ${MIN_PREFIX_LEN} chars): ${ref}`,
    );
  }

  const matches = tasks.filter((t) => t.rkey.startsWith(ref));

  if (matches.length === 0) {
    throw new Error(`No card found matching "${ref}"`);
  }

  if (matches.length > 1) {
    const list = matches
      .map((t) => `  ${t.rkey.slice(0, 7)}  ${t.effectiveTitle}`)
      .join("\n");
    throw new Error(`Ambiguous reference "${ref}". Matches:\n${list}`);
  }

  return matches[0];
}

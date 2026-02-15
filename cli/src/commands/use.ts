import { requireAgent } from "../lib/auth.js";
import {
  fetchMyBoards,
  fetchBoardFromAppview,
  resolveHandle,
} from "../lib/pds.js";
import { setDefaultBoard, loadConfig } from "../lib/config.js";
import { BOARD_COLLECTION } from "../lib/tid.js";
import chalk from "chalk";

/**
 * Parse a board reference: name, rkey, AT URI, or web URL.
 * Returns { did, rkey } or null.
 */
async function parseBoardRef(
  ref: string,
  currentDid: string,
): Promise<{ did: string; rkey: string } | null> {
  // AT URI: at://did:plc:xxx/dev.skyboard.board/rkey
  if (ref.startsWith("at://")) {
    const parts = ref.replace("at://", "").split("/");
    if (parts.length >= 3 && parts[1] === BOARD_COLLECTION) {
      return { did: parts[0], rkey: parts[2] };
    }
    return null;
  }

  // Web URL: https://skyboard.dev/board/did:plc:xxx/rkey
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    const url = new URL(ref);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // /board/did:plc:xxx/rkey
    if (pathParts.length >= 3 && pathParts[0] === "board") {
      return { did: pathParts[1], rkey: pathParts[2] };
    }
    // /board/rkey (own board)
    if (pathParts.length === 2 && pathParts[0] === "board") {
      return { did: currentDid, rkey: pathParts[1] };
    }
    return null;
  }

  // Check known boards by name (fuzzy)
  const config = loadConfig();
  const lowerRef = ref.toLowerCase();
  const nameMatch = config.knownBoards.find((b) =>
    b.name.toLowerCase().includes(lowerRef),
  );
  if (nameMatch) return { did: nameMatch.did, rkey: nameMatch.rkey };

  // Try as rkey for own board
  const board = await fetchBoardFromAppview(currentDid, ref);
  if (board) return { did: currentDid, rkey: ref };

  return null;
}

export async function useCommand(boardRef: string): Promise<void> {
  const { did } = await requireAgent();

  const parsed = await parseBoardRef(boardRef, did);
  if (!parsed) {
    console.error(chalk.red(`Could not resolve board: ${boardRef}`));
    console.error("Try a board name, rkey, AT URI, or web URL.");
    process.exit(1);
  }

  const board = await fetchBoardFromAppview(parsed.did, parsed.rkey);
  if (!board) {
    console.error(chalk.red(`Board not found at ${parsed.did}/${parsed.rkey}`));
    process.exit(1);
  }

  setDefaultBoard({ did: parsed.did, rkey: parsed.rkey, name: board.name });
  console.log(chalk.green(`Default board set to: ${chalk.bold(board.name)}`));
}

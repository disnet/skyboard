import { getDefaultBoard, loadConfig } from "./config.js";
import { BOARD_COLLECTION } from "./tid.js";
import chalk from "chalk";

/**
 * Shared board resolver for all CLI commands.
 *
 * Parses --board option in these formats:
 * - AT URI: at://did:plc:xxx/dev.skyboard.board/rkey
 * - DID:rkey pair: did:plc:xxx:rkey (last colon separates DID from rkey)
 * - Falls back to getDefaultBoard() when boardOpt is not provided.
 */
export function resolveBoard(boardOpt?: string): { did: string; rkey: string } {
  if (boardOpt) {
    const parsed = parseBoardOpt(boardOpt);
    if (parsed) return parsed;

    console.error(chalk.red(`Could not parse board reference: ${boardOpt}`));
    console.error(
      "Accepted formats: at://did/dev.skyboard.board/rkey or did:plc:xxx:rkey",
    );
    process.exit(1);
  }

  const defaultBoard = getDefaultBoard();
  if (!defaultBoard) {
    console.error(
      chalk.red(
        "No default board set. Run `sb use <board>` first, or pass --board.",
      ),
    );
    process.exit(1);
  }
  return defaultBoard;
}

function parseBoardOpt(ref: string): { did: string; rkey: string } | null {
  // AT URI: at://did:plc:xxx/dev.skyboard.board/rkey
  if (ref.startsWith("at://")) {
    const parts = ref.replace("at://", "").split("/");
    if (parts.length >= 3 && parts[1] === BOARD_COLLECTION) {
      return { did: parts[0], rkey: parts[2] };
    }
    return null;
  }

  // DID:rkey pair — the DID itself contains colons (e.g. did:plc:abc123)
  // so we split on the last colon to get did + rkey
  if (ref.startsWith("did:")) {
    const lastColon = ref.lastIndexOf(":");
    // A bare DID like "did:plc:abc" has its last colon at the plc:abc boundary,
    // so we need at least 3 colon-separated parts (did:method:id:rkey)
    const parts = ref.split(":");
    if (parts.length >= 4) {
      const rkey = parts[parts.length - 1];
      const did = parts.slice(0, -1).join(":");
      return { did, rkey };
    }
    return null;
  }

  // Check known boards by name
  const config = loadConfig();
  const lowerRef = ref.toLowerCase();
  const nameMatch = config.knownBoards.find((b) =>
    b.name.toLowerCase().includes(lowerRef),
  );
  if (nameMatch) return { did: nameMatch.did, rkey: nameMatch.rkey };

  return null;
}

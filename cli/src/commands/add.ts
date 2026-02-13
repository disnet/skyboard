import { requireAgent } from "../lib/auth.js";
import { fetchBoardFromAppview } from "../lib/pds.js";
import { addKnownBoard } from "../lib/config.js";
import { BOARD_COLLECTION } from "../lib/tid.js";
import chalk from "chalk";

export async function addCommand(link: string): Promise<void> {
  await requireAgent();

  let boardDid: string | undefined;
  let boardRkey: string | undefined;

  // Parse AT URI
  if (link.startsWith("at://")) {
    const parts = link.replace("at://", "").split("/");
    if (parts.length >= 3 && parts[1] === BOARD_COLLECTION) {
      boardDid = parts[0];
      boardRkey = parts[2];
    }
  }

  // Parse web URL
  if (!boardDid && (link.startsWith("http://") || link.startsWith("https://"))) {
    const url = new URL(link);
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 3 && pathParts[0] === "board") {
      boardDid = pathParts[1];
      boardRkey = pathParts[2];
    }
  }

  if (!boardDid || !boardRkey) {
    console.error(chalk.red("Could not parse board link. Provide an AT URI or web URL."));
    console.error(chalk.dim("  AT URI: at://did:plc:xxx/dev.skyboard.board/rkey"));
    console.error(chalk.dim("  URL:    https://skyboard.dev/board/did:plc:xxx/rkey"));
    process.exit(1);
  }

  const board = await fetchBoardFromAppview(boardDid, boardRkey);
  if (!board) {
    console.error(chalk.red("Board not found."));
    process.exit(1);
  }

  addKnownBoard({ did: boardDid, rkey: boardRkey, name: board.name });
  console.log(chalk.green(`Added board: ${chalk.bold(board.name)}`));
}

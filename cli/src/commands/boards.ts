import { requireAgent } from "../lib/auth.js";
import { fetchMyBoards, fetchBoardData } from "../lib/pds.js";
import { loadConfig, getDefaultBoard } from "../lib/config.js";
import { buildAtUri, BOARD_COLLECTION } from "../lib/tid.js";
import chalk from "chalk";

export async function boardsCommand(opts: { json?: boolean }): Promise<void> {
  const { agent, did } = await requireAgent();

  const boards = await fetchMyBoards(agent, did);

  // Also include known boards from other users
  const config = loadConfig();
  const defaultBoard = getDefaultBoard();

  if (opts.json) {
    console.log(JSON.stringify(boards.map((b) => ({
      rkey: b.rkey,
      did: b.did,
      name: b.name,
      description: b.description,
      columns: b.columns.length,
      open: b.open ?? false,
    })), null, 2));
    return;
  }

  if (boards.length === 0) {
    console.log("No boards found.");
    return;
  }

  console.log(chalk.bold("Your boards:\n"));

  for (const board of boards) {
    const isDefault = defaultBoard?.did === board.did && defaultBoard?.rkey === board.rkey;
    const marker = isDefault ? chalk.green(" *") : "  ";
    const cols = board.columns.sort((a, b) => a.order - b.order);
    const colSummary = cols.map((c) => c.name).join(" | ");

    console.log(`${marker} ${chalk.bold(board.name)} ${chalk.dim(`(${board.rkey})`)}`);
    if (board.description) {
      console.log(`    ${chalk.dim(board.description)}`);
    }
    console.log(`    ${chalk.dim(colSummary)}`);
    console.log();
  }

  // Show known boards from other users
  const otherBoards = config.knownBoards.filter((b) => b.did !== did);
  if (otherBoards.length > 0) {
    console.log(chalk.bold("Joined boards:\n"));
    for (const board of otherBoards) {
      const isDefault = defaultBoard?.did === board.did && defaultBoard?.rkey === board.rkey;
      const marker = isDefault ? chalk.green(" *") : "  ";
      console.log(`${marker} ${chalk.bold(board.name)} ${chalk.dim(`(${board.did.slice(0, 20)}.../${board.rkey})`)}`);
    }
    console.log();
  }

  if (defaultBoard) {
    console.log(chalk.dim(`* = default board. Change with: sb use <board>`));
  }
}

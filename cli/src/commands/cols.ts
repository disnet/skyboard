import { requireAgent } from "../lib/auth.js";
import { fetchBoardData } from "../lib/pds.js";
import { getDefaultBoard } from "../lib/config.js";
import chalk from "chalk";

export async function colsCommand(opts: { board?: string; json?: boolean }): Promise<void> {
  const { did } = await requireAgent();

  const boardRef = resolveBoard(opts.board);

  const data = await fetchBoardData(boardRef.did, boardRef.rkey, did);
  if (!data) {
    console.error(chalk.red("Board not found."));
    process.exit(1);
  }

  const sortedColumns = [...data.board.columns].sort((a, b) => a.order - b.order);

  if (opts.json) {
    console.log(JSON.stringify(sortedColumns.map((col, i) => ({
      index: i + 1,
      id: col.id,
      name: col.name,
      taskCount: data.tasks.filter((t) => t.effectiveColumnId === col.id).length,
    })), null, 2));
    return;
  }

  console.log(chalk.bold(data.board.name) + "\n");

  for (let i = 0; i < sortedColumns.length; i++) {
    const col = sortedColumns[i];
    const count = data.tasks.filter((t) => t.effectiveColumnId === col.id).length;
    console.log(`  ${chalk.dim(`${i + 1}.`)} ${col.name} ${chalk.dim(`(${count})`)}`);
  }
}

function resolveBoard(boardOpt?: string): { did: string; rkey: string } {
  if (boardOpt) {
    // TODO: support full board ref parsing like use command
    const defaultBoard = getDefaultBoard();
    if (defaultBoard) return defaultBoard;
  }

  const defaultBoard = getDefaultBoard();
  if (!defaultBoard) {
    console.error(chalk.red("No default board set. Run `sb use <board>` first."));
    process.exit(1);
  }
  return defaultBoard;
}

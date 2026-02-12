import { requireAgent } from "../lib/auth.js";
import { fetchBoardData } from "../lib/pds.js";
import { getDefaultBoard } from "../lib/config.js";
import { printBoardCards, shortRkey, formatDate } from "../lib/display.js";
import chalk from "chalk";

export async function cardsCommand(opts: {
  column?: string;
  label?: string;
  search?: string;
  board?: string;
  json?: boolean;
}): Promise<void> {
  const { did } = await requireAgent();

  const boardRef = resolveBoard(opts.board);

  const data = await fetchBoardData(boardRef.did, boardRef.rkey, did);
  if (!data) {
    console.error(chalk.red("Board not found."));
    process.exit(1);
  }

  if (opts.json) {
    const sorted = [...data.board.columns].sort((a, b) => a.order - b.order);
    const result = sorted.map((col) => ({
      column: col.name,
      cards: data.tasks
        .filter((t) => t.effectiveColumnId === col.id)
        .sort((a, b) => a.effectivePosition.localeCompare(b.effectivePosition))
        .map((t) => ({
          rkey: t.rkey,
          shortRef: shortRkey(t.rkey),
          title: t.effectiveTitle,
          description: t.effectiveDescription,
          labels: t.effectiveLabelIds,
          createdAt: t.createdAt,
          lastModifiedAt: t.lastModifiedAt,
        })),
    }));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold(data.board.name));
  printBoardCards(data.board, data.tasks, {
    column: opts.column,
    label: opts.label,
    search: opts.search,
  });
}

function resolveBoard(boardOpt?: string): { did: string; rkey: string } {
  if (boardOpt) {
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

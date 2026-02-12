import { requireAgent } from "../lib/auth.js";
import { fetchBoardData } from "../lib/pds.js";
import { getDefaultBoard } from "../lib/config.js";
import { resolveColumn } from "../lib/column-match.js";
import { generateTID, buildAtUri, TASK_COLLECTION, BOARD_COLLECTION } from "../lib/tid.js";
import { shortRkey } from "../lib/display.js";
import { generateKeyBetween } from "fractional-indexing";
import chalk from "chalk";

export async function newCommand(
  title: string,
  opts: { column?: string; description?: string; board?: string; json?: boolean },
): Promise<void> {
  const { agent, did } = await requireAgent();

  const boardRef = resolveBoard(opts.board);

  const data = await fetchBoardData(boardRef.did, boardRef.rkey, did);
  if (!data) {
    console.error(chalk.red("Board not found."));
    process.exit(1);
  }

  // Determine target column
  const sortedColumns = [...data.board.columns].sort((a, b) => a.order - b.order);
  let targetCol;
  if (opts.column) {
    try {
      targetCol = resolveColumn(opts.column, data.board.columns);
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  } else {
    targetCol = sortedColumns[0];
  }

  // Generate position at end of column
  const colTasks = data.tasks
    .filter((t) => t.effectiveColumnId === targetCol.id)
    .sort((a, b) => a.effectivePosition.localeCompare(b.effectivePosition));
  const lastPos = colTasks.length > 0 ? colTasks[colTasks.length - 1].effectivePosition : null;
  const position = generateKeyBetween(lastPos, null);

  const boardUri = buildAtUri(boardRef.did, BOARD_COLLECTION, boardRef.rkey);
  const rkey = generateTID();
  const now = new Date().toISOString();

  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: TASK_COLLECTION,
    rkey,
    record: {
      $type: "dev.skyboard.task",
      title,
      ...(opts.description ? { description: opts.description } : {}),
      columnId: targetCol.id,
      boardUri,
      position,
      order: 0,
      createdAt: now,
    },
    validate: false,
  });

  if (opts.json) {
    console.log(JSON.stringify({ rkey, title, column: targetCol.name, position }));
  } else {
    console.log(chalk.green(`Created: ${shortRkey(rkey)}  ${title}  → ${targetCol.name}`));
  }
}

function resolveBoard(boardOpt?: string): { did: string; rkey: string } {
  const defaultBoard = getDefaultBoard();
  if (!defaultBoard) {
    console.error(chalk.red("No default board set. Run `sb use <board>` first."));
    process.exit(1);
  }
  return defaultBoard;
}

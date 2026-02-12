import { requireAgent } from "../lib/auth.js";
import { fetchBoardData } from "../lib/pds.js";
import { getDefaultBoard } from "../lib/config.js";
import { resolveCardRef } from "../lib/card-ref.js";
import { resolveColumn } from "../lib/column-match.js";
import { generateTID, buildAtUri, TASK_COLLECTION, OP_COLLECTION, BOARD_COLLECTION } from "../lib/tid.js";
import { shortRkey } from "../lib/display.js";
import { generateKeyBetween } from "fractional-indexing";
import chalk from "chalk";

export async function mvCommand(
  cardRef: string,
  columnRef: string,
  opts: { board?: string; json?: boolean },
): Promise<void> {
  const { agent, did } = await requireAgent();

  const boardRef = resolveBoard(opts.board);

  const data = await fetchBoardData(boardRef.did, boardRef.rkey, did);
  if (!data) {
    console.error(chalk.red("Board not found."));
    process.exit(1);
  }

  let task;
  try {
    task = resolveCardRef(cardRef, data.tasks);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  let targetCol;
  try {
    targetCol = resolveColumn(columnRef, data.board.columns);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  // Generate position at end of target column
  const colTasks = data.tasks
    .filter((t) => t.effectiveColumnId === targetCol.id)
    .sort((a, b) => a.effectivePosition.localeCompare(b.effectivePosition));
  const lastPos = colTasks.length > 0 ? colTasks[colTasks.length - 1].effectivePosition : null;
  const position = generateKeyBetween(lastPos, null);

  const boardUri = buildAtUri(boardRef.did, BOARD_COLLECTION, boardRef.rkey);
  const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
  const opRkey = generateTID();

  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: OP_COLLECTION,
    rkey: opRkey,
    record: {
      $type: "dev.skyboard.op",
      targetTaskUri: taskUri,
      boardUri,
      fields: {
        columnId: targetCol.id,
        position,
      },
      createdAt: new Date().toISOString(),
    },
    validate: false,
  });

  if (opts.json) {
    console.log(JSON.stringify({ rkey: task.rkey, column: targetCol.name }));
  } else {
    console.log(chalk.green(`Moved ${shortRkey(task.rkey)} "${task.effectiveTitle}" → ${targetCol.name}`));
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

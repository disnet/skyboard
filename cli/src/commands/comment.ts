import { requireAgent } from "../lib/auth.js";
import { fetchBoardData } from "../lib/pds.js";
import { getDefaultBoard } from "../lib/config.js";
import { resolveCardRef } from "../lib/card-ref.js";
import { generateTID, buildAtUri, TASK_COLLECTION, COMMENT_COLLECTION, BOARD_COLLECTION } from "../lib/tid.js";
import { shortRkey } from "../lib/display.js";
import chalk from "chalk";

export async function commentCommand(
  cardRef: string,
  text: string,
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

  const boardUri = buildAtUri(boardRef.did, BOARD_COLLECTION, boardRef.rkey);
  const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
  const commentRkey = generateTID();

  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: COMMENT_COLLECTION,
    rkey: commentRkey,
    record: {
      $type: "dev.skyboard.comment",
      targetTaskUri: taskUri,
      boardUri,
      text,
      createdAt: new Date().toISOString(),
    },
    validate: false,
  });

  if (opts.json) {
    console.log(JSON.stringify({ rkey: commentRkey, taskRkey: task.rkey, text }));
  } else {
    console.log(chalk.green(`Comment added to ${shortRkey(task.rkey)} "${task.effectiveTitle}"`));
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

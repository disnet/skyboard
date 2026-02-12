import { requireAgent } from "../lib/auth.js";
import { fetchBoardData } from "../lib/pds.js";
import { getDefaultBoard } from "../lib/config.js";
import { resolveCardRef } from "../lib/card-ref.js";
import { shortRkey } from "../lib/display.js";
import { TASK_COLLECTION } from "../lib/tid.js";
import chalk from "chalk";
import { createInterface } from "node:readline";

export async function rmCommand(
  cardRef: string,
  opts: { force?: boolean; board?: string; json?: boolean },
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

  // Can only delete your own tasks
  if (task.did !== did) {
    console.error(chalk.red("You can only delete your own tasks."));
    process.exit(1);
  }

  // Confirm unless --force
  if (!opts.force) {
    const confirmed = await confirm(
      `Delete "${task.effectiveTitle}" (${shortRkey(task.rkey)})? [y/N] `,
    );
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  await agent.com.atproto.repo.deleteRecord({
    repo: did,
    collection: TASK_COLLECTION,
    rkey: task.rkey,
  });

  if (opts.json) {
    console.log(JSON.stringify({ deleted: task.rkey }));
  } else {
    console.log(chalk.green(`Deleted ${shortRkey(task.rkey)} "${task.effectiveTitle}"`));
  }
}

function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function resolveBoard(boardOpt?: string): { did: string; rkey: string } {
  const defaultBoard = getDefaultBoard();
  if (!defaultBoard) {
    console.error(chalk.red("No default board set. Run `sb use <board>` first."));
    process.exit(1);
  }
  return defaultBoard;
}

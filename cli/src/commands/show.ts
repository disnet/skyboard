import { requireAgent } from "../lib/auth.js";
import { fetchBoardData } from "../lib/pds.js";
import { resolveBoard } from "../lib/board-resolver.js";
import { resolveCardRef } from "../lib/card-ref.js";
import { shortRkey, formatDate } from "../lib/display.js";
import { buildAtUri, TASK_COLLECTION } from "../lib/tid.js";
import chalk from "chalk";

export async function showCommand(
  ref: string,
  opts: { board?: string; json?: boolean },
): Promise<void> {
  const { did } = await requireAgent();

  const boardRef = resolveBoard(opts.board);

  const data = await fetchBoardData(boardRef.did, boardRef.rkey, did);
  if (!data) {
    console.error(chalk.red("Board not found."));
    process.exit(1);
  }

  let task;
  try {
    task = resolveCardRef(ref, data.tasks);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  const col = data.board.columns.find((c) => c.id === task.effectiveColumnId);
  const labels = task.effectiveLabelIds
    .map((id) => data.board.labels?.find((l) => l.id === id))
    .filter(Boolean);

  const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
  const comments = data.comments
    .filter((c) => c.targetTaskUri === taskUri)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          rkey: task.rkey,
          did: task.did,
          title: task.effectiveTitle,
          description: task.effectiveDescription,
          column: col?.name,
          labels: labels.map((l) => ({
            id: l!.id,
            name: l!.name,
            color: l!.color,
          })),
          createdAt: task.createdAt,
          lastModifiedAt: task.lastModifiedAt,
          lastModifiedBy: task.lastModifiedBy,
          opsApplied: task.appliedOps.length,
          comments: comments.map((c) => ({
            did: c.did,
            text: c.text,
            createdAt: c.createdAt,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log();
  console.log(chalk.bold(task.effectiveTitle));
  console.log(
    chalk.dim(
      `${shortRkey(task.rkey)}  by ${task.did.slice(0, 20)}...  ${formatDate(task.createdAt)}`,
    ),
  );
  console.log();

  if (col) {
    console.log(`${chalk.bold("Column:")}  ${col.name}`);
  }
  if (labels.length > 0) {
    const labelStr = labels
      .map((l) => chalk.hex(l!.color)(`[${l!.name}]`))
      .join(" ");
    console.log(`${chalk.bold("Labels:")}  ${labelStr}`);
  }
  if (task.effectiveDescription) {
    console.log();
    console.log(task.effectiveDescription);
  }

  if (task.appliedOps.length > 0) {
    console.log();
    console.log(chalk.dim(`${task.appliedOps.length} edit(s) applied`));
  }

  if (comments.length > 0) {
    console.log();
    console.log(chalk.bold.underline("Comments"));
    for (const comment of comments) {
      console.log();
      console.log(
        `  ${chalk.dim(comment.did.slice(0, 20) + "...")}  ${chalk.dim(formatDate(comment.createdAt))}`,
      );
      console.log(`  ${comment.text}`);
    }
  }
  console.log();
}

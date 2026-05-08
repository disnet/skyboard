import { requireAgent } from "../lib/auth.js";
import { fetchBoardData } from "../lib/pds.js";
import { resolveBoard } from "../lib/board-resolver.js";
import { resolveCardRef } from "../lib/card-ref.js";
import {
  generateTID,
  buildAtUri,
  TASK_COLLECTION,
  OP_COLLECTION,
  BOARD_COLLECTION,
} from "../lib/tid.js";
import { shortRkey } from "../lib/display.js";
import type { MaterializedTask, OpFields } from "../lib/types.js";
import chalk from "chalk";

function wouldCreateCycle(
  taskUri: string,
  parentUri: string,
  tasks: MaterializedTask[],
): boolean {
  const parentByUri = new Map<string, string | undefined>();
  for (const t of tasks) {
    parentByUri.set(
      buildAtUri(t.did, TASK_COLLECTION, t.rkey),
      t.effectiveParentTaskUri,
    );
  }
  let cursor: string | undefined = parentUri;
  while (cursor) {
    if (cursor === taskUri) return true;
    cursor = parentByUri.get(cursor);
  }
  return false;
}

export async function editCommand(
  cardRef: string,
  opts: {
    title?: string;
    description?: string;
    label?: string[];
    parent?: string;
    clearParent?: boolean;
    board?: string;
    json?: boolean;
  },
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

  const fields: OpFields = {};
  if (opts.title) fields.title = opts.title;
  if (opts.description) fields.description = opts.description;
  if (opts.parent && opts.clearParent) {
    console.error(
      chalk.red("Use either --parent or --clear-parent, not both."),
    );
    process.exit(1);
  }
  if (opts.parent) {
    try {
      const parent = resolveCardRef(opts.parent, data.tasks);
      if (parent.did === task.did && parent.rkey === task.rkey) {
        console.error(chalk.red("A card cannot be its own parent."));
        process.exit(1);
      }
      fields.parentTaskUri = buildAtUri(
        parent.did,
        TASK_COLLECTION,
        parent.rkey,
      );
    } catch (err) {
      console.error(
        chalk.red(err instanceof Error ? err.message : String(err)),
      );
      process.exit(1);
    }
  } else if (opts.clearParent) {
    fields.parentTaskUri = "";
  }
  if (opts.label && opts.label.length > 0) {
    // Resolve label names to IDs
    const labelIds: string[] = [];
    for (const name of opts.label) {
      const label = data.board.labels?.find(
        (l) => l.name.toLowerCase() === name.toLowerCase(),
      );
      if (label) {
        labelIds.push(label.id);
      } else {
        console.error(
          chalk.yellow(`Warning: label "${name}" not found, skipping.`),
        );
      }
    }
    if (labelIds.length > 0) fields.labelIds = labelIds;
  }

  if (Object.keys(fields).length === 0) {
    console.error(
      chalk.red("Nothing to edit. Use -t, -d, -l, -p, or --clear-parent."),
    );
    process.exit(1);
  }

  const boardUri = buildAtUri(boardRef.did, BOARD_COLLECTION, boardRef.rkey);
  const taskUri = buildAtUri(task.did, TASK_COLLECTION, task.rkey);
  if (
    fields.parentTaskUri &&
    wouldCreateCycle(taskUri, fields.parentTaskUri, data.tasks)
  ) {
    console.error(chalk.red("That parent would create a parent cycle."));
    process.exit(1);
  }
  const opRkey = generateTID();

  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: OP_COLLECTION,
    rkey: opRkey,
    record: {
      $type: "dev.skyboard.op",
      targetTaskUri: taskUri,
      boardUri,
      fields,
      createdAt: new Date().toISOString(),
    },
    validate: false,
  });

  if (opts.json) {
    console.log(JSON.stringify({ rkey: task.rkey, fields }));
  } else {
    const changes = Object.keys(fields).join(", ");
    console.log(
      chalk.green(
        `Edited ${shortRkey(task.rkey)} "${task.effectiveTitle}" (${changes})`,
      ),
    );
  }
}

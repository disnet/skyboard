import { loadAuthInfo, getDefaultBoard } from "../lib/config.js";
import { requireAgent } from "../lib/auth.js";
import { fetchBoardData } from "../lib/pds.js";
import chalk from "chalk";

export async function statusCommand(opts: { json?: boolean }): Promise<void> {
  const info = loadAuthInfo();

  if (!info) {
    if (opts.json) {
      console.log(JSON.stringify({ loggedIn: false }, null, 2));
    } else {
      console.log("Not logged in. Run `sb login <handle>` first.");
    }
    return;
  }

  const boardRef = getDefaultBoard();

  if (!boardRef) {
    if (opts.json) {
      console.log(JSON.stringify({ loggedIn: true, ...info, board: null }, null, 2));
    } else {
      console.log(`${chalk.bold("Handle:")}  ${info.handle}`);
      console.log(`${chalk.bold("DID:")}     ${info.did}`);
      console.log(`\nNo default board set. Run ${chalk.cyan("sb use <board>")} to select one.`);
    }
    return;
  }

  const { did } = await requireAgent();
  const data = await fetchBoardData(boardRef.did, boardRef.rkey, did);

  if (!data) {
    if (opts.json) {
      console.log(JSON.stringify({ loggedIn: true, ...info, board: null }, null, 2));
    } else {
      console.log(`${chalk.bold("Handle:")}  ${info.handle}`);
      console.log(`${chalk.bold("DID:")}     ${info.did}`);
      console.log(`\n${chalk.red("Board not found.")}`);
    }
    return;
  }

  const sortedColumns = [...data.board.columns].sort((a, b) => a.order - b.order);
  const columns = sortedColumns.map((col, i) => {
    const taskCount = data.tasks.filter((t) => t.effectiveColumnId === col.id).length;
    return { index: i + 1, name: col.name, id: col.id, taskCount };
  });
  const totalCards = data.tasks.length;

  if (opts.json) {
    console.log(JSON.stringify({
      loggedIn: true,
      handle: info.handle,
      did: info.did,
      board: {
        name: data.board.name,
        rkey: boardRef.rkey,
        did: boardRef.did,
        columns: columns.map(({ index, name, taskCount }) => ({ index, name, taskCount })),
        totalCards,
      },
    }, null, 2));
    return;
  }

  console.log(`${chalk.bold("Handle:")}  ${info.handle}`);
  console.log(`${chalk.bold("DID:")}     ${info.did}`);
  console.log(`${chalk.bold("Board:")}   ${data.board.name}`);
  console.log();

  for (const col of columns) {
    console.log(`  ${chalk.dim(`${col.index}.`)} ${col.name} ${chalk.dim(`(${col.taskCount})`)}`);
  }

  console.log(`\n  ${totalCards} cards total`);
}

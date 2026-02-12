import chalk from "chalk";
import type { MaterializedTask, Board, Column, Label } from "./types.js";

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
}

export function shortRkey(rkey: string): string {
  return rkey.slice(0, 7);
}

export function formatTask(task: MaterializedTask, board: Board): string {
  const col = board.columns.find((c) => c.id === task.effectiveColumnId);
  const colName = col?.name ?? "?";
  const labels = task.effectiveLabelIds
    .map((id) => board.labels?.find((l) => l.id === id))
    .filter(Boolean)
    .map((l) => chalk.hex(l!.color)(`[${l!.name}]`))
    .join(" ");

  const ref = chalk.dim(shortRkey(task.rkey));
  const title = task.effectiveTitle;
  const date = chalk.dim(formatDate(task.lastModifiedAt));

  let line = `  ${ref}  ${title}`;
  if (labels) line += ` ${labels}`;
  line += `  ${date}`;
  return line;
}

export function formatBoardHeader(board: Board): string {
  let header = chalk.bold(board.name);
  if (board.description) {
    header += chalk.dim(`  ${board.description}`);
  }
  return header;
}

export function formatColumnHeader(col: Column, taskCount: number): string {
  return `\n${chalk.bold.underline(col.name)} ${chalk.dim(`(${taskCount})`)}`;
}

export function printBoardCards(
  board: Board,
  tasks: MaterializedTask[],
  opts: { column?: string; label?: string; search?: string },
): void {
  // Sort columns by order
  const sortedColumns = [...board.columns].sort((a, b) => a.order - b.order);

  for (const col of sortedColumns) {
    // Filter tasks for this column
    let colTasks = tasks.filter((t) => t.effectiveColumnId === col.id);

    // Apply filters
    if (opts.column && !matchesColumn(col, opts.column, sortedColumns)) continue;
    if (opts.label) {
      const label = board.labels?.find(
        (l) => l.name.toLowerCase().includes(opts.label!.toLowerCase()),
      );
      if (label) {
        colTasks = colTasks.filter((t) => t.effectiveLabelIds.includes(label.id));
      } else {
        colTasks = [];
      }
    }
    if (opts.search) {
      const s = opts.search.toLowerCase();
      colTasks = colTasks.filter(
        (t) =>
          t.effectiveTitle.toLowerCase().includes(s) ||
          (t.effectiveDescription?.toLowerCase().includes(s) ?? false),
      );
    }

    // Sort by position
    colTasks.sort((a, b) => a.effectivePosition.localeCompare(b.effectivePosition));

    console.log(formatColumnHeader(col, colTasks.length));
    if (colTasks.length === 0) {
      console.log(chalk.dim("  (empty)"));
    } else {
      for (const task of colTasks) {
        console.log(formatTask(task, board));
      }
    }
  }
}

function matchesColumn(col: Column, query: string, allColumns: Column[]): boolean {
  // Check numeric index (1-based)
  const idx = parseInt(query, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= allColumns.length) {
    return allColumns[idx - 1].id === col.id;
  }
  // Check exact match (case-insensitive)
  if (col.name.toLowerCase() === query.toLowerCase()) return true;
  // Check prefix match
  if (col.name.toLowerCase().startsWith(query.toLowerCase())) return true;
  return false;
}

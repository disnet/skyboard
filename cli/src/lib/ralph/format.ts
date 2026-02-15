import chalk from "chalk";
import type { WriteStream } from "node:fs";

interface StreamEvent {
  type: string;
  subtype?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: string;
  duration_ms?: number;
  total_cost_usd?: number;
  num_turns?: number;
}

/**
 * Processes a line of stream-json output from the Claude CLI.
 * Writes formatted, human-readable output to the console and raw JSON to the log stream.
 */
export function processStreamLine(line: string, logStream: WriteStream): void {
  // Always write raw JSON to log
  logStream.write(line + "\n");

  const trimmed = line.trim();
  if (!trimmed) return;

  let event: StreamEvent;
  try {
    event = JSON.parse(trimmed);
  } catch {
    // Not JSON — pass through as-is
    process.stdout.write(line + "\n");
    return;
  }

  switch (event.type) {
    case "assistant": {
      const content = event.message?.content;
      if (!content) break;
      for (const block of content) {
        if (block.type === "text" && block.text) {
          process.stdout.write(block.text);
        } else if (block.type === "tool_use") {
          const summary = formatToolUse(block.name ?? "unknown", block.input);
          console.log(chalk.dim(`  ${chalk.cyan("tool")} ${summary}`));
        }
      }
      break;
    }
    case "result": {
      if (event.duration_ms != null) {
        const secs = (event.duration_ms / 1000).toFixed(1);
        const cost =
          event.total_cost_usd != null
            ? ` · $${event.total_cost_usd.toFixed(4)}`
            : "";
        const turns =
          event.num_turns != null ? ` · ${event.num_turns} turns` : "";
        console.log(chalk.dim(`\n  [${secs}s${turns}${cost}]`));
      }
      break;
    }
    // Skip system events (hooks, init) — they're noise for the user
    default:
      break;
  }
}

function formatToolUse(name: string, input?: Record<string, unknown>): string {
  if (!input) return name;

  switch (name) {
    case "Edit":
      return `Edit ${chalk.white((input.file_path as string) ?? "")}`;
    case "Write":
      return `Write ${chalk.white((input.file_path as string) ?? "")}`;
    case "Read":
      return `Read ${chalk.white((input.file_path as string) ?? "")}`;
    case "Bash":
      return `Bash ${chalk.white(truncate((input.command as string) ?? "", 80))}`;
    case "Grep":
      return `Grep ${chalk.white(truncate((input.pattern as string) ?? "", 40))}${input.path ? ` in ${input.path}` : ""}`;
    case "Glob":
      return `Glob ${chalk.white((input.pattern as string) ?? "")}`;
    case "Skill":
      return `Skill ${chalk.white((input.skill as string) ?? "")}`;
    case "Task":
      return `Task ${chalk.white(truncate((input.description as string) ?? "", 60))}`;
    case "TodoWrite":
      return `TodoWrite`;
    case "WebFetch":
      return `WebFetch ${chalk.white(truncate((input.url as string) ?? "", 60))}`;
    case "WebSearch":
      return `WebSearch ${chalk.white(truncate((input.query as string) ?? "", 60))}`;
    default:
      return name;
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

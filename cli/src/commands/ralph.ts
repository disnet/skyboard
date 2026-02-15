import type { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadRalphConfig, saveRalphConfig } from "../lib/ralph/config.js";
import type { WorkflowType, BranchingStrategy } from "../lib/ralph/config.js";
import { writeDefaultProtocol } from "../lib/ralph/protocol.js";
import { runLoop } from "../lib/ralph/runner.js";
import { getDefaultBoard } from "../lib/config.js";
import { requireAgent } from "../lib/auth.js";
import { fetchBoardFromAppview } from "../lib/pds.js";
import { BOARD_COLLECTION } from "../lib/tid.js";
import { loadConfig } from "../lib/config.js";
import { select, input, number } from "@inquirer/prompts";

/**
 * Parse a board reference: name, rkey, AT URI, or web URL.
 * Returns { did, rkey } or null.
 */
async function parseBoardRef(
  ref: string,
  currentDid: string,
): Promise<{ did: string; rkey: string } | null> {
  // AT URI
  if (ref.startsWith("at://")) {
    const parts = ref.replace("at://", "").split("/");
    if (parts.length >= 3 && parts[1] === BOARD_COLLECTION) {
      return { did: parts[0], rkey: parts[2] };
    }
    return null;
  }

  // Web URL
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    const url = new URL(ref);
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 3 && pathParts[0] === "board") {
      return { did: pathParts[1], rkey: pathParts[2] };
    }
    if (pathParts.length === 2 && pathParts[0] === "board") {
      return { did: currentDid, rkey: pathParts[1] };
    }
    return null;
  }

  // Check known boards by name
  const config = loadConfig();
  const lowerRef = ref.toLowerCase();
  const nameMatch = config.knownBoards.find((b) =>
    b.name.toLowerCase().includes(lowerRef),
  );
  if (nameMatch) return { did: nameMatch.did, rkey: nameMatch.rkey };

  // Try as rkey for own board
  const board = await fetchBoardFromAppview(currentDid, ref);
  if (board) return { did: currentDid, rkey: ref };

  return null;
}

export function ralphCommand(program: Command): void {
  const ralph = program
    .command("ralph")
    .description("Skyboard-driven autonomous dev loop");

  ralph
    .command("init")
    .description("Set up .skyboard-ralph/ config and generate protocol file")
    .option("--board <ref>", "Board reference (rkey, AT URI, URL, name)")
    .option("--max-iterations <n>", "Default max iterations")
    .option("--workflow <type>", "Workflow type: simple, standard, or custom")
    .option(
      "--branching <strategy>",
      "Branching strategy: per-card or current-branch",
    )
    .action(
      async (opts: {
        board?: string;
        maxIterations?: string;
        workflow?: string;
        branching?: string;
      }) => {
        const cwd = process.cwd();

        console.log(chalk.bold("\nRalph Init\n"));

        // --- Step 1: Board selection ---
        let boardRef: { did: string; rkey: string };
        let boardName: string | undefined;

        if (opts.board) {
          // Non-interactive: use provided flag
          const { did } = await requireAgent();
          const parsed = await parseBoardRef(opts.board, did);
          if (!parsed) {
            console.error(chalk.red(`Could not resolve board: ${opts.board}`));
            console.error("Try a board name, rkey, AT URI, or web URL.");
            process.exit(1);
          }
          const board = await fetchBoardFromAppview(parsed.did, parsed.rkey);
          if (!board) {
            console.error(
              chalk.red(`Board not found at ${parsed.did}/${parsed.rkey}`),
            );
            process.exit(1);
          }
          boardRef = parsed;
          boardName = board.name;
        } else {
          // Interactive: show choices
          const userConfig = loadConfig();
          const defaultBoard = userConfig.defaultBoard;
          const knownBoards = userConfig.knownBoards;

          if (knownBoards.length > 0) {
            const choices = knownBoards.map((b) => ({
              name: `${b.name}${defaultBoard && b.rkey === defaultBoard.rkey ? chalk.dim(" (default)") : ""}`,
              value: `${b.did}/${b.rkey}`,
            }));
            choices.push({
              name: "Enter a board reference manually",
              value: "__manual__",
            });

            const boardChoice = await select({
              message: "Which board?",
              choices,
              default: defaultBoard
                ? `${defaultBoard.did}/${defaultBoard.rkey}`
                : undefined,
            });

            if (boardChoice === "__manual__") {
              const ref = await input({
                message: "Board reference (rkey, AT URI, or URL):",
              });
              const { did } = await requireAgent();
              const parsed = await parseBoardRef(ref, did);
              if (!parsed) {
                console.error(chalk.red(`Could not resolve board: ${ref}`));
                process.exit(1);
              }
              const board = await fetchBoardFromAppview(
                parsed.did,
                parsed.rkey,
              );
              if (!board) {
                console.error(
                  chalk.red(`Board not found at ${parsed.did}/${parsed.rkey}`),
                );
                process.exit(1);
              }
              boardRef = parsed;
              boardName = board.name;
            } else {
              const [did, rkey] = boardChoice.split("/");
              boardRef = { did, rkey };
              boardName = knownBoards.find(
                (b) => b.did === did && b.rkey === rkey,
              )?.name;
            }
          } else if (defaultBoard) {
            boardRef = { did: defaultBoard.did, rkey: defaultBoard.rkey };
            boardName = defaultBoard.name;
            console.log(
              `Board: ${chalk.bold(defaultBoard.name)} (from default)`,
            );
          } else {
            const ref = await input({
              message: "Board reference (rkey, AT URI, or URL):",
            });
            const { did } = await requireAgent();
            const parsed = await parseBoardRef(ref, did);
            if (!parsed) {
              console.error(chalk.red(`Could not resolve board: ${ref}`));
              process.exit(1);
            }
            const board = await fetchBoardFromAppview(parsed.did, parsed.rkey);
            if (!board) {
              console.error(
                chalk.red(`Board not found at ${parsed.did}/${parsed.rkey}`),
              );
              process.exit(1);
            }
            boardRef = parsed;
            boardName = board.name;
          }
        }

        console.log(
          `${chalk.dim("Board:")} ${boardName ?? `${boardRef.did}/${boardRef.rkey}`}`,
        );

        // --- Step 2: Workflow selection ---
        let workflow: WorkflowType;
        let customColumns: string[] | undefined;

        if (opts.workflow) {
          if (!["simple", "standard", "custom"].includes(opts.workflow)) {
            console.error(
              chalk.red(
                "Invalid workflow type. Use: simple, standard, or custom.",
              ),
            );
            process.exit(1);
          }
          workflow = opts.workflow as WorkflowType;
        } else {
          workflow = await select({
            message: "Which workflow?",
            choices: [
              {
                name: "Standard (Backlog → Planned → In Progress → In Review → Done)",
                value: "standard" as WorkflowType,
              },
              {
                name: "Simple (Backlog → In Progress → Done)",
                value: "simple" as WorkflowType,
              },
              {
                name: "Custom (define your own columns)",
                value: "custom" as WorkflowType,
              },
            ],
            default: "standard" as WorkflowType,
          });
        }

        if (workflow === "custom") {
          const columnsStr = await input({
            message: "Column names (comma-separated, first to last):",
            default: "Backlog, In Progress, Done",
            validate: (v) => {
              const cols = v
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean);
              if (cols.length < 2) return "Need at least 2 columns.";
              return true;
            },
          });
          customColumns = columnsStr
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
        }

        console.log(
          `${chalk.dim("Workflow:")} ${workflow}${customColumns ? ` (${customColumns.join(" → ")})` : ""}`,
        );

        // --- Step 3: Branching strategy ---
        let branching: BranchingStrategy;

        if (opts.branching) {
          if (!["per-card", "current-branch"].includes(opts.branching)) {
            console.error(
              chalk.red(
                "Invalid branching strategy. Use: per-card or current-branch.",
              ),
            );
            process.exit(1);
          }
          branching = opts.branching as BranchingStrategy;
        } else {
          branching = await select({
            message: "How should Claude handle branches?",
            choices: [
              {
                name: "Create per-card branches (card/<rkey>)",
                value: "per-card" as BranchingStrategy,
              },
              {
                name: "Commit to current branch",
                value: "current-branch" as BranchingStrategy,
              },
            ],
            default: "per-card" as BranchingStrategy,
          });
        }

        console.log(`${chalk.dim("Branching:")} ${branching}`);

        // --- Step 4: Max iterations ---
        let maxIterations: number;

        if (opts.maxIterations) {
          maxIterations = parseInt(opts.maxIterations, 10);
          if (isNaN(maxIterations) || maxIterations < 1) {
            console.error(chalk.red("Invalid max-iterations value."));
            process.exit(1);
          }
        } else {
          maxIterations =
            (await number({
              message: "Max iterations per run?",
              default: 50,
              min: 1,
            })) ?? 50;
        }

        console.log(`${chalk.dim("Max iterations:")} ${maxIterations}`);

        // --- Build and save config ---
        const protocolFile = ".skyboard-ralph/protocol.md";

        const config = {
          board: boardRef,
          maxIterations,
          workflow,
          ...(customColumns ? { columns: customColumns } : {}),
          branching,
          statusFile: ".skyboard-ralph/loop-status",
          logFile: ".skyboard-ralph/loop.log",
          protocolFile,
        };

        saveRalphConfig(config, cwd);
        console.log(`\nCreated ${chalk.cyan(".skyboard-ralph/config.json")}`);

        // Always regenerate protocol to match current config
        const protocolPath = resolve(cwd, protocolFile);
        writeDefaultProtocol(protocolPath, config);
        console.log(`Created ${chalk.cyan(protocolFile)}`);

        console.log(
          chalk.green("\nRalph initialized! Run `sb ralph start` to begin."),
        );
        console.log(chalk.dim("All ralph files are under .skyboard-ralph/"));
      },
    );

  ralph
    .command("start")
    .description("Run the autonomous dev loop")
    .option("--max-iterations <n>", "Override max iterations from config")
    .option("--interactive", "Disable --dangerously-skip-permissions")
    .action(async (opts: { maxIterations?: string; interactive?: boolean }) => {
      const cwd = process.cwd();
      const config = loadRalphConfig(cwd);

      if (!config) {
        console.error(
          chalk.red(
            "No .skyboard-ralph/config.json found. Run `sb ralph init` first.",
          ),
        );
        process.exit(1);
      }

      const protocolPath = resolve(cwd, config.protocolFile);
      if (!existsSync(protocolPath)) {
        console.error(
          chalk.red(
            `Protocol file not found: ${config.protocolFile}. Run \`sb ralph init\` to regenerate.`,
          ),
        );
        process.exit(1);
      }

      let maxIterations = config.maxIterations;
      if (opts.maxIterations) {
        maxIterations = parseInt(opts.maxIterations, 10);
        if (isNaN(maxIterations) || maxIterations < 1) {
          console.error(chalk.red("Invalid max-iterations value."));
          process.exit(1);
        }
      }

      const status = await runLoop({
        config,
        maxIterations,
        interactive: opts.interactive ?? false,
        cwd,
      });

      // Exit with appropriate code
      process.exit(status === "DONE" ? 0 : status === "BLOCKED" ? 0 : 0);
    });

  ralph
    .command("status")
    .description("Show current loop state")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const config = loadRalphConfig(cwd);

      if (!config) {
        if (opts.json) {
          console.log(JSON.stringify({ initialized: false }, null, 2));
        } else {
          console.log("Ralph not initialized. Run `sb ralph init` first.");
        }
        return;
      }

      // Read status file
      const statusPath = resolve(cwd, config.statusFile);
      let loopStatus = "unknown";
      if (existsSync(statusPath)) {
        const { readFileSync } = await import("node:fs");
        loopStatus = readFileSync(statusPath, "utf-8").trim() || "unknown";
      }

      // Count iterations from log
      let iterationCount = 0;
      const logPath = resolve(cwd, config.logFile);
      if (existsSync(logPath)) {
        const { readFileSync } = await import("node:fs");
        const logContent = readFileSync(logPath, "utf-8");
        const matches = logContent.match(/=== Iteration \d+/g);
        iterationCount = matches ? matches.length : 0;
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              initialized: true,
              board: config.board,
              maxIterations: config.maxIterations,
              lastStatus: loopStatus,
              iterationsRun: iterationCount,
              protocolFile: config.protocolFile,
              statusFile: config.statusFile,
              logFile: config.logFile,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(
          `${chalk.bold("Board:")}       ${config.board.did}/${config.board.rkey}`,
        );
        console.log(`${chalk.bold("Status:")}      ${loopStatus}`);
        console.log(
          `${chalk.bold("Iterations:")}  ${iterationCount} run (max ${config.maxIterations})`,
        );
        console.log(`${chalk.bold("Protocol:")}    ${config.protocolFile}`);
        console.log(`${chalk.bold("Log:")}         ${config.logFile}`);
      }
    });
}

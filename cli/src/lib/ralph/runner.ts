import { spawn } from "node:child_process";
import { createWriteStream, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateProtocol } from "./protocol.js";
import type { RalphConfig } from "./config.js";

export type LoopStatus = "CONTINUE" | "DONE" | "BLOCKED" | "UNKNOWN";

function readStatus(statusFile: string): LoopStatus {
  if (!existsSync(statusFile)) return "UNKNOWN";
  const raw = readFileSync(statusFile, "utf-8").trim();
  if (raw === "CONTINUE" || raw === "DONE" || raw === "BLOCKED") return raw;
  return "UNKNOWN";
}

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export interface RunLoopOptions {
  config: RalphConfig;
  maxIterations: number;
  interactive: boolean;
  cwd: string;
}

export async function runLoop(opts: RunLoopOptions): Promise<LoopStatus> {
  const { config, maxIterations, interactive, cwd } = opts;
  const statusFile = resolve(cwd, config.statusFile);
  const logFile = resolve(cwd, config.logFile);
  const protocolFile = resolve(cwd, config.protocolFile);

  // Ensure directories exist
  mkdirSync(dirname(statusFile), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });

  const logStream = createWriteStream(logFile, { flags: "a" });

  function log(msg: string): void {
    const line = `[${timestamp()}] ${msg}`;
    console.log(line);
    logStream.write(line + "\n");
  }

  let interrupted = false;
  const onSignal = () => {
    if (interrupted) {
      // Second signal — force exit
      process.exit(1);
    }
    interrupted = true;
    log("Interrupt received. Finishing current iteration...");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  log(`Starting ralph loop (max ${maxIterations} iterations)`);

  let lastStatus: LoopStatus = "UNKNOWN";

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (interrupted) {
      log("Interrupted before starting next iteration.");
      break;
    }

    // Clear previous status
    try { unlinkSync(statusFile); } catch { /* ok */ }

    log(`=== Iteration ${iteration} / ${maxIterations} ===`);

    const prompt = generateProtocol(protocolFile, {
      iteration,
      maxIterations,
      boardDid: config.board.did,
      boardRkey: config.board.rkey,
    });

    const args = ["-p", prompt];
    if (!interactive) {
      args.push("--dangerously-skip-permissions");
    }

    // Run claude
    const exitCode = await new Promise<number>((resolvePromise) => {
      const child = spawn("claude", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      child.stdout.on("data", (data: Buffer) => {
        process.stdout.write(data);
        logStream.write(data);
      });

      child.stderr.on("data", (data: Buffer) => {
        process.stderr.write(data);
        logStream.write(data);
      });

      child.on("close", (code) => {
        resolvePromise(code ?? 1);
      });

      child.on("error", (err) => {
        log(`Failed to spawn claude: ${err.message}`);
        resolvePromise(1);
      });
    });

    if (exitCode !== 0) {
      log(`claude exited with code ${exitCode}`);
    }

    lastStatus = readStatus(statusFile);

    switch (lastStatus) {
      case "DONE":
        log("All tasks complete!");
        cleanup();
        return lastStatus;
      case "BLOCKED":
        log("All remaining tasks are blocked. Stopping.");
        log("Unblock cards on the board and re-run to continue.");
        cleanup();
        return lastStatus;
      case "CONTINUE":
        log("Transition complete, continuing to next iteration...");
        break;
      case "UNKNOWN":
        log("WARNING: No valid status file written. Agent may have crashed. Continuing...");
        break;
    }
  }

  log(`Max iterations (${maxIterations}) reached.`);
  cleanup();
  return lastStatus;

  function cleanup(): void {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    logStream.end();
  }
}

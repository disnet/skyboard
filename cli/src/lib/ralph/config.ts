import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type WorkflowType = "simple" | "standard" | "custom";
export type BranchingStrategy = "per-card" | "current-branch";

export interface RalphConfig {
  board: { did: string; rkey: string };
  maxIterations: number;
  workflow: WorkflowType;
  columns?: string[];
  branching: BranchingStrategy;
  statusFile: string;
  logFile: string;
  protocolFile: string;
}

const CONFIG_DIR = ".skyboard-ralph";
const CONFIG_FILENAME = "config.json";

export function loadRalphConfig(cwd = process.cwd()): RalphConfig | null {
  const configPath = join(cwd, CONFIG_DIR, CONFIG_FILENAME);
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as RalphConfig;
    // Apply defaults for fields added after initial release
    if (!config.workflow) {
      config.workflow = "standard";
    }
    if (!config.branching) {
      config.branching = "per-card";
    }
    return config;
  } catch {
    return null;
  }
}

export function saveRalphConfig(
  config: RalphConfig,
  cwd = process.cwd(),
): void {
  const configDir = join(cwd, CONFIG_DIR);
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, CONFIG_FILENAME);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

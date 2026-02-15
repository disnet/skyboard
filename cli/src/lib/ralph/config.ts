import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface RalphConfig {
  board: { did: string; rkey: string };
  maxIterations: number;
  statusFile: string;
  logFile: string;
  protocolFile: string;
}

const CONFIG_FILENAME = ".ralph.json";

export function loadRalphConfig(cwd = process.cwd()): RalphConfig | null {
  const configPath = join(cwd, CONFIG_FILENAME);
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as RalphConfig;
  } catch {
    return null;
  }
}

export function saveRalphConfig(config: RalphConfig, cwd = process.cwd()): void {
  const configPath = join(cwd, CONFIG_FILENAME);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

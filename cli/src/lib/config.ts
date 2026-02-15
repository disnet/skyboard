import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface BoardRef {
  did: string;
  rkey: string;
  name: string;
}

export interface Config {
  defaultBoard?: BoardRef;
  knownBoards: BoardRef[];
}

const CONFIG_DIR = join(homedir(), ".config", "skyboard");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const AUTH_DIR = join(CONFIG_DIR, "auth");
const STATE_DIR = join(CONFIG_DIR, "state");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getAuthDir(): string {
  return AUTH_DIR;
}

export function getStateDir(): string {
  return STATE_DIR;
}

function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function ensureAuthDir(): void {
  ensureConfigDir();
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
}

function ensureStateDir(): void {
  ensureConfigDir();
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

export function loadConfig(): Config {
  ensureConfigDir();
  if (!existsSync(CONFIG_PATH)) {
    return { knownBoards: [] };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as Config;
  } catch {
    return { knownBoards: [] };
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function setDefaultBoard(board: BoardRef): void {
  const config = loadConfig();
  config.defaultBoard = board;
  if (
    !config.knownBoards.some(
      (b) => b.did === board.did && b.rkey === board.rkey,
    )
  ) {
    config.knownBoards.push(board);
  }
  saveConfig(config);
}

export function getDefaultBoard(): BoardRef | undefined {
  return loadConfig().defaultBoard;
}

export function clearDefaultBoard(): void {
  const config = loadConfig();
  delete config.defaultBoard;
  saveConfig(config);
}

export function addKnownBoard(board: BoardRef): void {
  const config = loadConfig();
  if (
    !config.knownBoards.some(
      (b) => b.did === board.did && b.rkey === board.rkey,
    )
  ) {
    config.knownBoards.push(board);
  }
  saveConfig(config);
}

// File-based state store for OAuth CSRF tokens
export function writeStateFile(key: string, data: unknown): void {
  ensureStateDir();
  writeFileSync(join(STATE_DIR, `${key}.json`), JSON.stringify(data), {
    mode: 0o600,
  });
}

export function readStateFile(key: string): unknown | undefined {
  const path = join(STATE_DIR, `${key}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
}

export function deleteStateFile(key: string): void {
  const path = join(STATE_DIR, `${key}.json`);
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}

// File-based session store for OAuth sessions
export function writeSessionFile(sub: string, data: unknown): void {
  ensureAuthDir();
  const filename = Buffer.from(sub).toString("base64url");
  writeFileSync(join(AUTH_DIR, `${filename}.json`), JSON.stringify(data), {
    mode: 0o600,
  });
}

export function readSessionFile(sub: string): unknown | undefined {
  const filename = Buffer.from(sub).toString("base64url");
  const path = join(AUTH_DIR, `${filename}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
}

export function deleteSessionFile(sub: string): void {
  const filename = Buffer.from(sub).toString("base64url");
  const path = join(AUTH_DIR, `${filename}.json`);
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}

// Simple auth info storage (which DID is logged in)
const AUTH_INFO_PATH = join(CONFIG_DIR, "session.json");

export interface AuthInfo {
  did: string;
  handle: string;
  service: string;
}

export function loadAuthInfo(): AuthInfo | null {
  if (!existsSync(AUTH_INFO_PATH)) return null;
  try {
    return JSON.parse(readFileSync(AUTH_INFO_PATH, "utf-8")) as AuthInfo;
  } catch {
    return null;
  }
}

export function saveAuthInfo(info: AuthInfo): void {
  ensureConfigDir();
  writeFileSync(AUTH_INFO_PATH, JSON.stringify(info, null, 2), {
    mode: 0o600,
  });
}

export function clearAuthInfo(): void {
  try {
    unlinkSync(AUTH_INFO_PATH);
  } catch {
    // ignore
  }
}

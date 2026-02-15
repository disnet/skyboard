import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// Mock modules before importing
vi.mock("../lib/auth.js", () => ({
  requireAgent: vi.fn(),
}));

vi.mock("../lib/ralph/config.js", () => ({
  loadRalphConfig: vi.fn(),
  saveRalphConfig: vi.fn(),
}));

vi.mock("../lib/ralph/runner.js", () => ({
  runLoop: vi.fn(),
}));

vi.mock("../lib/ralph/protocol.js", () => ({
  writeDefaultProtocol: vi.fn(),
}));

vi.mock("../lib/config.js", () => ({
  getDefaultBoard: vi.fn(),
  loadConfig: vi.fn(() => ({ knownBoards: [] })),
}));

vi.mock("../lib/pds.js", () => ({
  fetchBoardFromAppview: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  return {
    ...orig,
    existsSync: vi.fn(() => true),
  };
});

import { requireAgent } from "../lib/auth.js";
import { loadRalphConfig } from "../lib/ralph/config.js";
import { runLoop } from "../lib/ralph/runner.js";
import { ralphCommand } from "../commands/ralph.js";
import { existsSync } from "node:fs";

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride(); // Throw instead of calling process.exit for parse errors
  ralphCommand(program);
  return program;
}

const validConfig = {
  board: { did: "did:plc:test", rkey: "testrkey" },
  maxIterations: 10,
  workflow: "standard" as const,
  branching: "per-card" as const,
  statusFile: ".skyboard-ralph/loop-status",
  logFile: ".skyboard-ralph/loop.log",
  protocolFile: ".skyboard-ralph/protocol.md",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ralph start", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("exits with error when not logged in", async () => {
    vi.mocked(loadRalphConfig).mockReturnValue(validConfig);
    vi.mocked(requireAgent).mockRejectedValue(new Error("process.exit"));

    const program = makeProgram();

    await expect(
      program.parseAsync(["node", "sb", "ralph", "start"]),
    ).rejects.toThrow("process.exit");

    expect(requireAgent).toHaveBeenCalledOnce();
    expect(runLoop).not.toHaveBeenCalled();
  });

  it("exits with error when config is missing", async () => {
    vi.mocked(loadRalphConfig).mockReturnValue(null);

    const program = makeProgram();

    await expect(
      program.parseAsync(["node", "sb", "ralph", "start"]),
    ).rejects.toThrow("process.exit");

    expect(requireAgent).not.toHaveBeenCalled();
    expect(runLoop).not.toHaveBeenCalled();
  });

  it("proceeds to runLoop when logged in and config exists", async () => {
    vi.mocked(loadRalphConfig).mockReturnValue(validConfig);
    vi.mocked(requireAgent).mockResolvedValue({
      agent: {} as any,
      did: "did:plc:test",
      handle: "test.user",
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(runLoop).mockResolvedValue("DONE");

    const program = makeProgram();

    // runLoop succeeds, but process.exit(0) is called at the end of the handler
    await expect(
      program.parseAsync(["node", "sb", "ralph", "start"]),
    ).rejects.toThrow("process.exit");

    expect(requireAgent).toHaveBeenCalledOnce();
    expect(runLoop).toHaveBeenCalledOnce();
    // exit(0) means success
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits with error when protocol file is missing", async () => {
    vi.mocked(loadRalphConfig).mockReturnValue(validConfig);
    vi.mocked(requireAgent).mockResolvedValue({
      agent: {} as any,
      did: "did:plc:test",
      handle: "test.user",
    });
    vi.mocked(existsSync).mockReturnValue(false);

    const program = makeProgram();

    await expect(
      program.parseAsync(["node", "sb", "ralph", "start"]),
    ).rejects.toThrow("process.exit");

    expect(requireAgent).toHaveBeenCalledOnce();
    expect(runLoop).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BoardData } from "../lib/pds.js";
import {
  OWNER_DID,
  USER_DID,
  BOARD_RKEY,
  BOARD_URI,
  TASK_RKEY_1,
  TASK_URI_1,
  COLUMNS,
  makeBoard,
  makeMaterializedTask,
  makeComment,
} from "./helpers.js";

// Mock modules before importing commands
vi.mock("../lib/auth.js", () => ({
  requireAgent: vi.fn(),
}));

vi.mock("../lib/config.js", () => ({
  getDefaultBoard: vi.fn(),
  loadConfig: vi.fn(() => ({ knownBoards: [] })),
  saveConfig: vi.fn(),
}));

vi.mock("../lib/pds.js", () => ({
  fetchBoardData: vi.fn(),
  fetchBoard: vi.fn(),
}));

// Mock generateTID to return a predictable value
vi.mock("../lib/tid.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/tid.js")>();
  return {
    ...orig,
    generateTID: vi.fn(() => "3juitestid0000000"),
  };
});

import { requireAgent } from "../lib/auth.js";
import { getDefaultBoard } from "../lib/config.js";
import { fetchBoardData } from "../lib/pds.js";
import { newCommand } from "../commands/new.js";
import { mvCommand } from "../commands/mv.js";
import { editCommand } from "../commands/edit.js";
import { rmCommand } from "../commands/rm.js";
import { showCommand } from "../commands/show.js";
import { cardsCommand } from "../commands/cards.js";

const mockPutRecord = vi.fn(async (_input: any) => ({
  uri: "at://fake",
  cid: "fakecid",
}));
const mockDeleteRecord = vi.fn(async (_input: any) => ({}));
const mockAgent = {
  com: {
    atproto: {
      repo: {
        putRecord: mockPutRecord,
        deleteRecord: mockDeleteRecord,
        listRecords: vi.fn(async () => ({ data: { records: [] } })),
      },
    },
  },
};

function setupMocks(
  taskOverrides?: Parameters<typeof makeMaterializedTask>[0],
) {
  vi.mocked(requireAgent).mockResolvedValue({
    agent: mockAgent as any,
    did: OWNER_DID,
    handle: "owner.test",
  });

  vi.mocked(getDefaultBoard).mockReturnValue({
    did: OWNER_DID,
    rkey: BOARD_RKEY,
    name: "Test Board",
  });

  const task = makeMaterializedTask(
    { rkey: TASK_RKEY_1, did: OWNER_DID, title: "Test Task", ...taskOverrides },
    { effectiveTitle: taskOverrides?.title ?? "Test Task" },
  );

  const boardData: BoardData = {
    board: makeBoard(),
    tasks: [task],
    trusts: [],
    comments: [],
    allParticipants: [OWNER_DID],
  };

  vi.mocked(fetchBoardData).mockResolvedValue(boardData);

  return { task, boardData };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Suppress console output during tests
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("newCommand", () => {
  it("creates a task record via putRecord", async () => {
    setupMocks();

    await newCommand("My New Task", { json: true });

    expect(mockPutRecord).toHaveBeenCalledOnce();
    const call = mockPutRecord.mock.calls[0][0];
    expect(call.repo).toBe(OWNER_DID);
    expect(call.collection).toBe("dev.skyboard.task");
    expect(call.record.$type).toBe("dev.skyboard.task");
    expect(call.record.title).toBe("My New Task");
    expect(call.record.columnId).toBe("col-todo"); // first column
    expect(call.record.position).toBeDefined();
    expect(call.record.boardUri).toContain(BOARD_RKEY);
  });

  it("creates task in specified column", async () => {
    setupMocks();

    await newCommand("Task in Done", { column: "Done", json: true });

    const call = mockPutRecord.mock.calls[0][0];
    expect(call.record.columnId).toBe("col-done");
  });

  it("includes description when provided", async () => {
    setupMocks();

    await newCommand("With Desc", { description: "A description", json: true });

    const call = mockPutRecord.mock.calls[0][0];
    expect(call.record.description).toBe("A description");
  });

  it("outputs JSON when --json flag is set", async () => {
    setupMocks();

    await newCommand("JSON Task", { json: true });

    expect(console.log).toHaveBeenCalled();
    const output = vi.mocked(console.log).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.title).toBe("JSON Task");
    expect(parsed.column).toBe("To Do");
  });
});

describe("mvCommand", () => {
  it("creates an op record with columnId and position", async () => {
    setupMocks();

    await mvCommand(TASK_RKEY_1, "Done", { json: true });

    expect(mockPutRecord).toHaveBeenCalledOnce();
    const call = mockPutRecord.mock.calls[0][0];
    expect(call.repo).toBe(OWNER_DID);
    expect(call.collection).toBe("dev.skyboard.op");
    expect(call.record.$type).toBe("dev.skyboard.op");
    expect(call.record.fields.columnId).toBe("col-done");
    expect(call.record.fields.position).toBeDefined();
    expect(call.record.targetTaskUri).toContain(TASK_RKEY_1);
  });

  it("outputs JSON with rkey and column name", async () => {
    setupMocks();

    await mvCommand(TASK_RKEY_1, "In Progress", { json: true });

    const output = vi.mocked(console.log).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.rkey).toBe(TASK_RKEY_1);
    expect(parsed.column).toBe("In Progress");
  });
});

describe("editCommand", () => {
  it("creates an op with title field", async () => {
    setupMocks();

    await editCommand(TASK_RKEY_1, { title: "New Title", json: true });

    expect(mockPutRecord).toHaveBeenCalledOnce();
    const call = mockPutRecord.mock.calls[0][0];
    expect(call.collection).toBe("dev.skyboard.op");
    expect(call.record.fields.title).toBe("New Title");
    expect(call.record.targetTaskUri).toContain(TASK_RKEY_1);
  });

  it("creates an op with description field", async () => {
    setupMocks();

    await editCommand(TASK_RKEY_1, { description: "New Desc", json: true });

    const call = mockPutRecord.mock.calls[0][0];
    expect(call.record.fields.description).toBe("New Desc");
  });

  it("resolves label names to IDs", async () => {
    setupMocks();

    await editCommand(TASK_RKEY_1, { label: ["bug"], json: true });

    const call = mockPutRecord.mock.calls[0][0];
    expect(call.record.fields.labelIds).toEqual(["lbl-bug"]);
  });

  it("exits when no fields provided", async () => {
    setupMocks();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(editCommand(TASK_RKEY_1, {})).rejects.toThrow("process.exit");
    expect(mockPutRecord).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });
});

describe("rmCommand", () => {
  it("deletes own task via deleteRecord with --force", async () => {
    setupMocks();

    await rmCommand(TASK_RKEY_1, { force: true, json: true });

    expect(mockDeleteRecord).toHaveBeenCalledOnce();
    const call = mockDeleteRecord.mock.calls[0][0];
    expect(call.repo).toBe(OWNER_DID);
    expect(call.collection).toBe("dev.skyboard.task");
    expect(call.rkey).toBe(TASK_RKEY_1);
  });

  it("rejects deletion of task owned by another user", async () => {
    // Task owned by USER_DID, but we're logged in as OWNER_DID
    setupMocks({ did: USER_DID });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      rmCommand(TASK_RKEY_1, { force: true, json: true }),
    ).rejects.toThrow("process.exit");

    expect(mockDeleteRecord).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it("outputs JSON with deleted rkey", async () => {
    setupMocks();

    await rmCommand(TASK_RKEY_1, { force: true, json: true });

    const output = vi.mocked(console.log).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.deleted).toBe(TASK_RKEY_1);
  });
});

describe("showCommand", () => {
  it("displays card details in JSON mode", async () => {
    const { boardData } = setupMocks();

    await showCommand(TASK_RKEY_1, { json: true });

    expect(console.log).toHaveBeenCalled();
    const output = vi.mocked(console.log).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.rkey).toBe(TASK_RKEY_1);
    expect(parsed.title).toBe("Test Task");
    expect(parsed.column).toBe("To Do");
  });

  it("includes comments in JSON output", async () => {
    const { boardData } = setupMocks();
    const comment = makeComment({
      targetTaskUri: `at://${OWNER_DID}/dev.skyboard.task/${TASK_RKEY_1}`,
      text: "Hello!",
    });
    boardData.comments = [comment];
    vi.mocked(fetchBoardData).mockResolvedValue(boardData);

    await showCommand(TASK_RKEY_1, { json: true });

    const output = vi.mocked(console.log).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0].text).toBe("Hello!");
  });
});

describe("cardsCommand", () => {
  it("outputs JSON with columns and cards", async () => {
    setupMocks();

    await cardsCommand({ json: true });

    expect(console.log).toHaveBeenCalled();
    const output = vi.mocked(console.log).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed).toHaveLength(3); // 3 columns
    expect(parsed[0].column).toBe("To Do");
    expect(parsed[0].cards).toHaveLength(1);
    expect(parsed[0].cards[0].title).toBe("Test Task");
  });

  it("includes all columns even if empty", async () => {
    setupMocks();

    await cardsCommand({ json: true });

    const output = vi.mocked(console.log).mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed[1].column).toBe("In Progress");
    expect(parsed[1].cards).toHaveLength(0);
    expect(parsed[2].column).toBe("Done");
    expect(parsed[2].cards).toHaveLength(0);
  });
});

import type {
  Board,
  Task,
  Op,
  Trust,
  Comment,
  Column,
  MaterializedTask,
} from "../lib/types.js";

// Fake DIDs
export const OWNER_DID = "did:plc:owner111111111111";
export const TRUSTED_DID = "did:plc:trusted22222222222";
export const USER_DID = "did:plc:user3333333333333";
export const UNTRUSTED_DID = "did:plc:untrusted44444444";

// Fake rkeys (TID-like strings)
export const BOARD_RKEY = "3jui7a2zbbb11";
export const TASK_RKEY_1 = "3jui7a2zbbb22";
export const TASK_RKEY_2 = "3jui7a2zbbb33";
export const TASK_RKEY_3 = "3jui7a2zbcc44";
export const OP_RKEY_1 = "3jui7a2zbdd55";
export const OP_RKEY_2 = "3jui7a2zbdd66";

export const BOARD_URI = `at://${OWNER_DID}/dev.skyboard.board/${BOARD_RKEY}`;
export const TASK_URI_1 = `at://${OWNER_DID}/dev.skyboard.task/${TASK_RKEY_1}`;
export const TASK_URI_2 = `at://${OWNER_DID}/dev.skyboard.task/${TASK_RKEY_2}`;
export const TASK_URI_3 = `at://${USER_DID}/dev.skyboard.task/${TASK_RKEY_3}`;

export const PDS_ENDPOINT = "https://pds.example.com";

export const COLUMNS: Column[] = [
  { id: "col-todo", name: "To Do", order: 0 },
  { id: "col-doing", name: "In Progress", order: 1 },
  { id: "col-done", name: "Done", order: 2 },
];

export function makeBoard(overrides?: Partial<Board>): Board {
  return {
    rkey: BOARD_RKEY,
    did: OWNER_DID,
    name: "Test Board",
    description: "A board for testing",
    columns: COLUMNS,
    labels: [
      { id: "lbl-bug", name: "bug", color: "#ff0000" },
      { id: "lbl-feat", name: "feature", color: "#00ff00" },
    ],
    open: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeTask(overrides?: Partial<Task>): Task {
  return {
    rkey: TASK_RKEY_1,
    did: OWNER_DID,
    title: "Test Task",
    description: "A task for testing",
    columnId: "col-todo",
    boardUri: BOARD_URI,
    position: "a0",
    createdAt: "2025-01-01T12:00:00.000Z",
    ...overrides,
  };
}

export function makeOp(overrides?: Partial<Op>): Op {
  return {
    rkey: OP_RKEY_1,
    did: OWNER_DID,
    targetTaskUri: TASK_URI_1,
    boardUri: BOARD_URI,
    fields: {},
    createdAt: "2025-01-02T00:00:00.000Z",
    ...overrides,
  };
}

export function makeTrust(overrides?: Partial<Trust>): Trust {
  return {
    rkey: "3jui7trust1111111",
    did: OWNER_DID,
    trustedDid: TRUSTED_DID,
    boardUri: BOARD_URI,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeComment(overrides?: Partial<Comment>): Comment {
  return {
    rkey: "3jui7comment11111",
    did: USER_DID,
    targetTaskUri: TASK_URI_1,
    boardUri: BOARD_URI,
    text: "A test comment",
    createdAt: "2025-01-03T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Wraps a task into a MaterializedTask with no ops applied.
 */
export function makeMaterializedTask(
  taskOverrides?: Partial<Task>,
  matOverrides?: Partial<MaterializedTask>,
): MaterializedTask {
  const task = makeTask(taskOverrides);
  return {
    rkey: task.rkey,
    did: task.did,
    title: task.title,
    description: task.description,
    columnId: task.columnId,
    boardUri: task.boardUri,
    position: task.position,
    order: task.order,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    sourceTask: task,
    appliedOps: [],
    pendingOps: [],
    effectiveTitle: task.title,
    effectiveDescription: task.description,
    effectiveColumnId: task.columnId,
    effectivePosition: task.position ?? "a0",
    effectiveLabelIds: task.labelIds ?? [],
    ownerDid: task.did,
    lastModifiedBy: task.did,
    lastModifiedAt: task.createdAt,
    ...matOverrides,
  };
}

/**
 * Build a fake DID document response for resolvePDS.
 */
export function makePLCResponse(did: string, pdsEndpoint: string) {
  return {
    id: did,
    service: [
      {
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: pdsEndpoint,
      },
    ],
  };
}

/**
 * Build a listRecords response.
 */
export function makeListRecordsResponse(
  records: Array<{ uri: string; value: Record<string, unknown> }>,
  cursor?: string,
) {
  return { records, cursor };
}

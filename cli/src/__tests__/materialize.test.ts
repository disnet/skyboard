import { describe, it, expect } from "vitest";
import { materializeTasks } from "../lib/materialize.js";
import {
  OWNER_DID,
  TRUSTED_DID,
  USER_DID,
  UNTRUSTED_DID,
  BOARD_URI,
  TASK_RKEY_1,
  TASK_RKEY_2,
  TASK_URI_1,
  TASK_URI_2,
  makeTask,
  makeOp,
} from "./helpers.js";

describe("materializeTasks", () => {
  const trustedDids = new Set([TRUSTED_DID]);

  it("returns a materialized task with no ops applied", () => {
    const task = makeTask();
    const result = materializeTasks([task], [], trustedDids, USER_DID, OWNER_DID);

    expect(result).toHaveLength(1);
    expect(result[0].effectiveTitle).toBe("Test Task");
    expect(result[0].effectiveColumnId).toBe("col-todo");
    expect(result[0].effectiveDescription).toBe("A task for testing");
    expect(result[0].appliedOps).toHaveLength(0);
    expect(result[0].sourceTask).toBe(task);
  });

  it("applies owner ops (per-field LWW)", () => {
    const task = makeTask({ createdAt: "2025-01-01T00:00:00.000Z" });
    const op = makeOp({
      did: OWNER_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "Updated Title" },
      createdAt: "2025-01-02T00:00:00.000Z",
    });

    const result = materializeTasks([task], [op], trustedDids, USER_DID, OWNER_DID);

    expect(result[0].effectiveTitle).toBe("Updated Title");
    expect(result[0].appliedOps).toHaveLength(1);
  });

  it("applies trusted user ops", () => {
    const task = makeTask({ createdAt: "2025-01-01T00:00:00.000Z" });
    const op = makeOp({
      did: TRUSTED_DID,
      targetTaskUri: TASK_URI_1,
      fields: { columnId: "col-done" },
      createdAt: "2025-01-02T00:00:00.000Z",
    });

    const result = materializeTasks([task], [op], trustedDids, USER_DID, OWNER_DID);

    expect(result[0].effectiveColumnId).toBe("col-done");
    expect(result[0].appliedOps).toHaveLength(1);
  });

  it("applies current user ops (even if not trusted)", () => {
    const task = makeTask({ createdAt: "2025-01-01T00:00:00.000Z" });
    const op = makeOp({
      did: USER_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "My Edit" },
      createdAt: "2025-01-02T00:00:00.000Z",
    });

    const result = materializeTasks([task], [op], trustedDids, USER_DID, OWNER_DID);

    expect(result[0].effectiveTitle).toBe("My Edit");
    expect(result[0].appliedOps).toHaveLength(1);
  });

  it("filters out untrusted ops", () => {
    const task = makeTask({ createdAt: "2025-01-01T00:00:00.000Z" });
    const op = makeOp({
      did: UNTRUSTED_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "Hacked Title" },
      createdAt: "2025-01-02T00:00:00.000Z",
    });

    const result = materializeTasks([task], [op], trustedDids, USER_DID, OWNER_DID);

    expect(result[0].effectiveTitle).toBe("Test Task"); // unchanged
    expect(result[0].appliedOps).toHaveLength(0);
  });

  it("resolves per-field LWW independently", () => {
    const task = makeTask({
      title: "Original",
      description: "Original desc",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const op1 = makeOp({
      rkey: "op1",
      did: OWNER_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "Title v2" },
      createdAt: "2025-01-02T00:00:00.000Z",
    });

    const op2 = makeOp({
      rkey: "op2",
      did: OWNER_DID,
      targetTaskUri: TASK_URI_1,
      fields: { description: "Desc v2" },
      createdAt: "2025-01-03T00:00:00.000Z",
    });

    const op3 = makeOp({
      rkey: "op3",
      did: OWNER_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "Title v3" },
      createdAt: "2025-01-04T00:00:00.000Z",
    });

    const result = materializeTasks(
      [task],
      [op1, op2, op3],
      trustedDids,
      USER_DID,
      OWNER_DID,
    );

    expect(result[0].effectiveTitle).toBe("Title v3");
    expect(result[0].effectiveDescription).toBe("Desc v2");
    expect(result[0].appliedOps).toHaveLength(3);
  });

  it("latest op wins (LWW) even if received out of order", () => {
    const task = makeTask({ createdAt: "2025-01-01T00:00:00.000Z" });

    const earlyOp = makeOp({
      rkey: "early",
      did: OWNER_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "Early" },
      createdAt: "2025-01-02T00:00:00.000Z",
    });

    const lateOp = makeOp({
      rkey: "late",
      did: OWNER_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "Late" },
      createdAt: "2025-01-03T00:00:00.000Z",
    });

    // Pass late op first — should still resolve to "Late"
    const result = materializeTasks(
      [task],
      [lateOp, earlyOp],
      trustedDids,
      USER_DID,
      OWNER_DID,
    );

    expect(result[0].effectiveTitle).toBe("Late");
  });

  it("does not apply op older than the task creation", () => {
    const task = makeTask({ createdAt: "2025-01-05T00:00:00.000Z" });
    const op = makeOp({
      did: OWNER_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "Old Op" },
      createdAt: "2025-01-01T00:00:00.000Z", // before task creation
    });

    const result = materializeTasks([task], [op], trustedDids, USER_DID, OWNER_DID);

    expect(result[0].effectiveTitle).toBe("Test Task"); // base task wins
  });

  it("deduplicates tasks with same did:rkey", () => {
    const task = makeTask();
    const dupe = makeTask(); // same rkey+did

    const result = materializeTasks([task, dupe], [], trustedDids, USER_DID, OWNER_DID);

    expect(result).toHaveLength(1);
  });

  it("handles multiple tasks with separate ops", () => {
    const task1 = makeTask({ rkey: TASK_RKEY_1 });
    const task2 = makeTask({ rkey: TASK_RKEY_2, title: "Task 2" });

    const op1 = makeOp({
      rkey: "op-for-t1",
      did: OWNER_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "Task 1 Updated" },
      createdAt: "2025-01-02T00:00:00.000Z",
    });
    const op2 = makeOp({
      rkey: "op-for-t2",
      did: OWNER_DID,
      targetTaskUri: TASK_URI_2,
      fields: { title: "Task 2 Updated" },
      createdAt: "2025-01-02T00:00:00.000Z",
    });

    const result = materializeTasks(
      [task1, task2],
      [op1, op2],
      trustedDids,
      USER_DID,
      OWNER_DID,
    );

    expect(result).toHaveLength(2);
    expect(result[0].effectiveTitle).toBe("Task 1 Updated");
    expect(result[1].effectiveTitle).toBe("Task 2 Updated");
  });

  it("tracks lastModifiedBy and lastModifiedAt", () => {
    const task = makeTask({ createdAt: "2025-01-01T00:00:00.000Z" });
    const op = makeOp({
      did: TRUSTED_DID,
      targetTaskUri: TASK_URI_1,
      fields: { title: "Trusted Edit" },
      createdAt: "2025-01-05T00:00:00.000Z",
    });

    const result = materializeTasks([task], [op], trustedDids, USER_DID, OWNER_DID);

    expect(result[0].lastModifiedBy).toBe(TRUSTED_DID);
    expect(result[0].lastModifiedAt).toBe("2025-01-05T00:00:00.000Z");
  });

  it("applies task author ops on their own task", () => {
    const task = makeTask({
      did: USER_DID,
      rkey: TASK_RKEY_1,
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    // The task URI for user-owned task
    const taskUri = `at://${USER_DID}/dev.skyboard.task/${TASK_RKEY_1}`;
    const op = makeOp({
      did: USER_DID,
      targetTaskUri: taskUri,
      fields: { title: "Author Edit" },
      createdAt: "2025-01-02T00:00:00.000Z",
    });

    const result = materializeTasks([task], [op], trustedDids, "did:plc:somebodyelse", OWNER_DID);

    expect(result[0].effectiveTitle).toBe("Author Edit");
    expect(result[0].appliedOps).toHaveLength(1);
  });
});

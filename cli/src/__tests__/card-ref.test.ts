import { describe, it, expect } from "vitest";
import { resolveCardRef } from "../lib/card-ref.js";
import {
  makeMaterializedTask,
  TASK_RKEY_1,
  TASK_RKEY_2,
  TASK_RKEY_3,
} from "./helpers.js";

describe("resolveCardRef", () => {
  const tasks = [
    makeMaterializedTask({ rkey: TASK_RKEY_1, title: "First Task" }),
    makeMaterializedTask({ rkey: TASK_RKEY_2, title: "Second Task" }),
    makeMaterializedTask({ rkey: TASK_RKEY_3, title: "Third Task" }),
  ];

  it("matches a task by 4+ character rkey prefix", () => {
    // TASK_RKEY_1 = "3jui7a2zbbb22" — need enough chars to disambiguate from TASK_RKEY_2 "3jui7a2zbbb33"
    const result = resolveCardRef(TASK_RKEY_1.slice(0, 12), tasks);
    expect(result.rkey).toBe(TASK_RKEY_1);
  });

  it("matches a task by full rkey", () => {
    const result = resolveCardRef(TASK_RKEY_2, tasks);
    expect(result.rkey).toBe(TASK_RKEY_2);
  });

  it("throws on too-short prefix (< 4 chars)", () => {
    expect(() => resolveCardRef("3ju", tasks)).toThrow("too short");
  });

  it("throws when no task matches", () => {
    expect(() => resolveCardRef("zzzz", tasks)).toThrow("No card found");
  });

  it("throws on ambiguous match with list of candidates", () => {
    // TASK_RKEY_1 = "3jui7a2zbbb22", TASK_RKEY_2 = "3jui7a2zbbb33"
    // They share prefix "3jui7a2zbbb"
    expect(() => resolveCardRef("3jui7a2zbbb", tasks)).toThrow("Ambiguous");
  });

  it("resolves unambiguous prefix that partially overlaps", () => {
    // TASK_RKEY_3 = "3jui7a2zbcc44" — prefix "3jui7a2zbcc" is unique
    const result = resolveCardRef("3jui7a2zbcc", tasks);
    expect(result.rkey).toBe(TASK_RKEY_3);
  });
});

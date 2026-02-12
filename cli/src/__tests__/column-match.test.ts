import { describe, it, expect } from "vitest";
import { resolveColumn } from "../lib/column-match.js";
import { COLUMNS } from "./helpers.js";

describe("resolveColumn", () => {
  // COLUMNS: To Do (0), In Progress (1), Done (2)

  it("matches by 1-based numeric index", () => {
    expect(resolveColumn("1", COLUMNS)).toEqual(COLUMNS[0]); // To Do
    expect(resolveColumn("2", COLUMNS)).toEqual(COLUMNS[1]); // In Progress
    expect(resolveColumn("3", COLUMNS)).toEqual(COLUMNS[2]); // Done
  });

  it("matches by exact name (case-insensitive)", () => {
    expect(resolveColumn("To Do", COLUMNS)).toEqual(COLUMNS[0]);
    expect(resolveColumn("to do", COLUMNS)).toEqual(COLUMNS[0]);
    expect(resolveColumn("IN PROGRESS", COLUMNS)).toEqual(COLUMNS[1]);
    expect(resolveColumn("done", COLUMNS)).toEqual(COLUMNS[2]);
  });

  it("matches by prefix", () => {
    expect(resolveColumn("Do", COLUMNS)).toEqual(COLUMNS[2]); // "Done" unique prefix
  });

  it("matches by substring", () => {
    expect(resolveColumn("Prog", COLUMNS)).toEqual(COLUMNS[1]); // "In Progress"
  });

  it("throws on ambiguous prefix match", () => {
    // Columns with ambiguous prefixes
    const cols = [
      { id: "a", name: "Alpha One", order: 0 },
      { id: "b", name: "Alpha Two", order: 1 },
    ];
    expect(() => resolveColumn("Alpha", cols)).toThrow("Ambiguous");
  });

  it("throws on ambiguous substring match", () => {
    const cols = [
      { id: "a", name: "Pre-Review", order: 0 },
      { id: "b", name: "Post-Review", order: 1 },
    ];
    // "Review" is a substring of both but not a prefix of either
    expect(() => resolveColumn("Review", cols)).toThrow("Ambiguous");
  });

  it("throws on no match with available columns", () => {
    expect(() => resolveColumn("Nonexistent", COLUMNS)).toThrow("No column matching");
    expect(() => resolveColumn("Nonexistent", COLUMNS)).toThrow("To Do");
  });

  it("ignores out-of-range numeric index", () => {
    // "0" is out of 1-based range, and doesn't match any name
    expect(() => resolveColumn("0", COLUMNS)).toThrow("No column matching");
    expect(() => resolveColumn("99", COLUMNS)).toThrow("No column matching");
  });
});

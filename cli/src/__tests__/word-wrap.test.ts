import { describe, it, expect } from "vitest";
import { wordWrap } from "../lib/ralph/format.js";

describe("wordWrap", () => {
  it("returns short lines unchanged", () => {
    expect(wordWrap("hello world", 80)).toBe("hello world");
  });

  it("wraps a long line at word boundaries", () => {
    const input = "the quick brown fox jumps over the lazy dog and keeps on running far away";
    const result = wordWrap(input, 40);
    for (const line of result.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
    // Content is preserved
    expect(result.replace(/\n/g, " ")).toBe(input);
  });

  it("preserves existing newlines", () => {
    const input = "line one\nline two\nline three";
    expect(wordWrap(input, 80)).toBe(input);
  });

  it("preserves indentation on continuation lines", () => {
    const input = "  - this is a bullet point that is really quite long and should wrap to the next line properly";
    const result = wordWrap(input, 50);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // Continuation lines should start with the same indent
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]).toMatch(/^  /);
    }
  });

  it("handles very long words (like URLs) without breaking them", () => {
    const url = "https://example.com/very/long/path/that/exceeds/the/width/limit";
    const input = `Check this link: ${url} for more info`;
    const result = wordWrap(input, 40);
    // The URL should appear intact in the output
    expect(result).toContain(url);
  });

  it("handles empty string", () => {
    expect(wordWrap("", 80)).toBe("");
  });

  it("handles multiple paragraphs", () => {
    const input = "First paragraph that is short.\n\nSecond paragraph that is also short.";
    expect(wordWrap(input, 80)).toBe(input);
  });
});

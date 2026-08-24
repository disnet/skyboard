import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BOARD_RKEY,
  OWNER_DID,
  PDS_ENDPOINT,
  TRUSTED_DID,
  USER_DID,
  makePLCResponse,
} from "./helpers.js";

let resolveHandle: typeof import("../lib/pds.js").resolveHandle;
let fetchBoardData: typeof import("../lib/pds.js").fetchBoardData;

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();

  const mod = await import("../lib/pds.js");
  resolveHandle = mod.resolveHandle;
  fetchBoardData = mod.fetchBoardData;
});

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const mockFetch = vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return handler(url);
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

const boardRecord = {
  name: "Test Board",
  columns: [{ id: "todo", name: "To do", order: 0 }],
  createdAt: "2025-01-01T00:00:00.000Z",
};

function successfulBoardReadResponse(url: string): Response {
  if (url.startsWith(`https://plc.directory/${OWNER_DID}`)) {
    return jsonResponse(makePLCResponse(OWNER_DID, PDS_ENDPOINT));
  }
  if (url.includes("com.atproto.repo.getRecord")) {
    return jsonResponse({ value: boardRecord });
  }
  if (url.includes("links/distinct-dids")) {
    return jsonResponse({ linking_dids: [] });
  }
  if (url.includes("com.atproto.repo.listRecords")) {
    return jsonResponse({ records: [] });
  }
  return new Response("", { status: 404 });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

describe("resolveHandle", () => {
  it("resolves via .well-known/atproto-did", async () => {
    stubFetch((url) => {
      if (url.includes(".well-known/atproto-did")) {
        return textResponse(OWNER_DID);
      }
      return new Response("", { status: 404 });
    });

    const result = await resolveHandle("alice.example.com");
    expect(result).toBe(OWNER_DID);
  });

  it("falls back to bsky.social resolution", async () => {
    stubFetch((url) => {
      if (url.includes(".well-known/atproto-did")) {
        return new Response("", { status: 404 });
      }
      if (url.includes("bsky.social/xrpc/com.atproto.identity.resolveHandle")) {
        return jsonResponse({ did: USER_DID });
      }
      return new Response("", { status: 404 });
    });

    const result = await resolveHandle("bob.bsky.social");
    expect(result).toBe(USER_DID);
  });

  it("returns null when all resolution methods fail", async () => {
    stubFetch(() => new Response("", { status: 404 }));

    const result = await resolveHandle("nobody.example.com");
    expect(result).toBeNull();
  });

  it("trims whitespace from .well-known response", async () => {
    stubFetch((url) => {
      if (url.includes(".well-known/atproto-did")) {
        return textResponse(`  ${OWNER_DID}  \n`);
      }
      return new Response("", { status: 404 });
    });

    const result = await resolveHandle("alice.example.com");
    expect(result).toBe(OWNER_DID);
  });

  it("rejects .well-known response that is not a DID", async () => {
    stubFetch((url) => {
      if (url.includes(".well-known/atproto-did")) {
        return textResponse("not-a-did");
      }
      if (url.includes("bsky.social")) {
        return new Response("", { status: 404 });
      }
      return new Response("", { status: 404 });
    });

    const result = await resolveHandle("alice.example.com");
    expect(result).toBeNull();
  });
});

describe("fetchBoardData degraded reads", () => {
  it("rejects when Constellation participant discovery fails", async () => {
    stubFetch((url) => {
      if (url.includes("links/distinct-dids")) {
        return new Response("", { status: 503 });
      }
      return successfulBoardReadResponse(url);
    });

    await expect(fetchBoardData(OWNER_DID, BOARD_RKEY, "")).rejects.toThrow(
      /Constellation returned HTTP 503/,
    );
  });

  it("rejects when a participant PDS cannot be resolved", async () => {
    stubFetch((url) => {
      if (
        url.includes("links/distinct-dids") &&
        url.includes("collection=dev.skyboard.task")
      ) {
        return jsonResponse({ linking_dids: [TRUSTED_DID] });
      }
      if (url.startsWith(`https://plc.directory/${TRUSTED_DID}`)) {
        return new Response("", { status: 503 });
      }
      return successfulBoardReadResponse(url);
    });

    await expect(fetchBoardData(OWNER_DID, BOARD_RKEY, "")).rejects.toThrow(
      `Could not resolve PDS for ${TRUSTED_DID}`,
    );
  });

  it("rejects instead of returning records from only the first PDS page", async () => {
    stubFetch((url) => {
      if (
        url.includes("com.atproto.repo.listRecords") &&
        url.includes("collection=dev.skyboard.task")
      ) {
        if (url.includes("cursor=next-page")) {
          return new Response("", { status: 503 });
        }
        return jsonResponse({ records: [], cursor: "next-page" });
      }
      return successfulBoardReadResponse(url);
    });

    await expect(fetchBoardData(OWNER_DID, BOARD_RKEY, "")).rejects.toThrow(
      /PDS returned HTTP 503.*dev.skyboard.task/,
    );
  });
});

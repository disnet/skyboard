import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OWNER_DID,
  USER_DID,
  BOARD_RKEY,
  BOARD_URI,
  TASK_RKEY_1,
  PDS_ENDPOINT,
  COLUMNS,
  makePLCResponse,
  makeListRecordsResponse,
} from "./helpers.js";

// We need to reset the pdsCache between tests since it's a module-level Map.
// The simplest approach: re-import fresh each time via dynamic import + vi.resetModules.

let resolvePDS: typeof import("../lib/pds.js").resolvePDS;
let fetchBoard: typeof import("../lib/pds.js").fetchBoard;
let resolveHandle: typeof import("../lib/pds.js").resolveHandle;

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();

  const mod = await import("../lib/pds.js");
  resolvePDS = mod.resolvePDS;
  fetchBoard = mod.fetchBoard;
  resolveHandle = mod.resolveHandle;
});

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const mockFetch = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url);
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
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

describe("resolvePDS", () => {
  it("resolves a did:plc via plc.directory", async () => {
    stubFetch((url) => {
      if (url.includes("plc.directory")) {
        return jsonResponse(makePLCResponse(OWNER_DID, PDS_ENDPOINT));
      }
      return new Response("", { status: 404 });
    });

    const result = await resolvePDS(OWNER_DID);
    expect(result).toBe(PDS_ENDPOINT);
  });

  it("resolves a did:web via .well-known/did.json", async () => {
    const webDid = "did:web:example.com";
    stubFetch((url) => {
      if (url.includes("example.com/.well-known/did.json")) {
        return jsonResponse(makePLCResponse(webDid, PDS_ENDPOINT));
      }
      return new Response("", { status: 404 });
    });

    const result = await resolvePDS(webDid);
    expect(result).toBe(PDS_ENDPOINT);
  });

  it("returns null for unknown DID method", async () => {
    stubFetch(() => new Response("", { status: 404 }));
    const result = await resolvePDS("did:key:z12345");
    expect(result).toBeNull();
  });

  it("returns null on fetch failure", async () => {
    stubFetch(() => new Response("", { status: 500 }));
    const result = await resolvePDS(OWNER_DID);
    expect(result).toBeNull();
  });

  it("caches resolved PDS endpoints", async () => {
    const mockFetch = stubFetch((url) => {
      if (url.includes("plc.directory")) {
        return jsonResponse(makePLCResponse(OWNER_DID, PDS_ENDPOINT));
      }
      return new Response("", { status: 404 });
    });

    await resolvePDS(OWNER_DID);
    await resolvePDS(OWNER_DID);

    // Should only call fetch once (second call uses cache)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("fetchBoard", () => {
  it("fetches and parses a board record", async () => {
    const boardRecord = {
      $type: "dev.skyboard.board",
      name: "Test Board",
      description: "A test board",
      columns: COLUMNS,
      createdAt: "2025-01-01T00:00:00.000Z",
    };

    stubFetch((url) => {
      if (url.includes("plc.directory")) {
        return jsonResponse(makePLCResponse(OWNER_DID, PDS_ENDPOINT));
      }
      if (url.includes("getRecord")) {
        return jsonResponse({ uri: `at://${OWNER_DID}/dev.skyboard.board/${BOARD_RKEY}`, value: boardRecord });
      }
      return new Response("", { status: 404 });
    });

    const board = await fetchBoard(OWNER_DID, BOARD_RKEY);
    expect(board).not.toBeNull();
    expect(board!.name).toBe("Test Board");
    expect(board!.columns).toEqual(COLUMNS);
    expect(board!.did).toBe(OWNER_DID);
    expect(board!.rkey).toBe(BOARD_RKEY);
  });

  it("returns null when board not found", async () => {
    stubFetch((url) => {
      if (url.includes("plc.directory")) {
        return jsonResponse(makePLCResponse(OWNER_DID, PDS_ENDPOINT));
      }
      return new Response("", { status: 404 });
    });

    const board = await fetchBoard(OWNER_DID, "nonexistent");
    expect(board).toBeNull();
  });

  it("returns null when PDS cannot be resolved", async () => {
    stubFetch(() => new Response("", { status: 500 }));
    const board = await fetchBoard(OWNER_DID, BOARD_RKEY);
    expect(board).toBeNull();
  });
});

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

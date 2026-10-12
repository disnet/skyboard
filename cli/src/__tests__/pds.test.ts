import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BOARD_RKEY,
  OWNER_DID,
  PDS_ENDPOINT,
  TRUSTED_DID,
  UNTRUSTED_DID,
  USER_DID,
  makePLCResponse,
} from "./helpers.js";

let resolveHandle: typeof import("../lib/pds.js").resolveHandle;
let fetchBoardData: typeof import("../lib/pds.js").fetchBoardData;
let fetchBoardFromPds: typeof import("../lib/pds.js").fetchBoardFromPds;
let BoardReadError: typeof import("../lib/pds.js").BoardReadError;

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();

  const mod = await import("../lib/pds.js");
  resolveHandle = mod.resolveHandle;
  fetchBoardData = mod.fetchBoardData;
  fetchBoardFromPds = mod.fetchBoardFromPds;
  BoardReadError = mod.BoardReadError;
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

describe("fetchBoardFromPds", () => {
  function stubBoardRead(handler: (url: string) => Response) {
    return stubFetch((url) => {
      if (url.startsWith(`https://plc.directory/${OWNER_DID}`)) {
        return jsonResponse(makePLCResponse(OWNER_DID, PDS_ENDPOINT));
      }
      return handler(url);
    });
  }

  it("returns the board record", async () => {
    stubBoardRead(() => jsonResponse({ value: boardRecord }));

    const board = await fetchBoardFromPds(OWNER_DID, BOARD_RKEY);
    expect(board?.name).toBe("Test Board");
  });

  it("returns null when the PDS reports the record as missing", async () => {
    stubBoardRead(() =>
      jsonResponse(
        { error: "RecordNotFound", message: "Could not locate record" },
        400,
      ),
    );

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).resolves.toBeNull();
  });

  it("returns null when the PDS answers 404", async () => {
    stubBoardRead(() => new Response("", { status: 404 }));

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).resolves.toBeNull();
  });

  it("returns null when the repo does not exist", async () => {
    stubBoardRead(() =>
      jsonResponse(
        { error: "InvalidRequest", message: "Could not find repo: did:plc:x" },
        400,
      ),
    );

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).resolves.toBeNull();
  });

  it("returns null for a syntactically impossible record key", async () => {
    const mockFetch = stubBoardRead(() => jsonResponse({ value: boardRecord }));

    await expect(
      fetchBoardFromPds(OWNER_DID, "not a rkey"),
    ).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects instead of reporting a missing board when the PDS is failing", async () => {
    stubBoardRead(() => new Response("", { status: 503 }));

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).rejects.toThrow(
      BoardReadError,
    );
    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it("rejects when the request throws", async () => {
    stubBoardRead(() => {
      throw new Error("network down");
    });

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).rejects.toThrow(
      /Could not read dev\.skyboard\.board/,
    );
  });

  it("rejects when the owner's PDS cannot be resolved", async () => {
    stubFetch(() => new Response("", { status: 503 }));

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).rejects.toThrow(
      `Could not resolve PDS for ${OWNER_DID}`,
    );
  });

  it("returns null when the owner's identity does not exist", async () => {
    stubFetch((url) =>
      url.startsWith(`https://plc.directory/${OWNER_DID}`)
        ? new Response("DID not registered", { status: 404 })
        : jsonResponse({ value: boardRecord }),
    );

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).resolves.toBeNull();
  });

  it("rejects for a DID method it cannot resolve", async () => {
    stubFetch(() => jsonResponse({ value: boardRecord }));

    await expect(fetchBoardFromPds("did:key:zabc", BOARD_RKEY)).rejects.toThrow(
      /unsupported DID method/,
    );
  });

  it("rejects when the response carries no record", async () => {
    stubBoardRead(() => jsonResponse({}));

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).rejects.toThrow(
      /contained no record/,
    );
  });

  it("rejects when the response is not JSON", async () => {
    stubBoardRead(() => textResponse("<html>proxy error</html>"));

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).rejects.toThrow(
      /unreadable response/,
    );
  });

  it("rejects when the board record does not validate", async () => {
    stubBoardRead(() => jsonResponse({ value: { name: 42 } }));

    await expect(fetchBoardFromPds(OWNER_DID, BOARD_RKEY)).rejects.toThrow(
      /is not a valid board/,
    );
  });
});

describe("fetchBoardData", () => {
  const BOARD_URI = `at://${OWNER_DID}/dev.skyboard.board/${BOARD_RKEY}`;
  const CONSTELLATION = "https://constellation.microcosm.blue";

  type Stored = {
    did: string;
    collection: string;
    rkey: string;
    value: object;
  };

  /**
   * A fake network: Constellation links every stored record whose `boardUri`
   * is this board (or that is listed in `extraLinks`), and each PDS serves
   * the stored records. `override` sees every request first.
   */
  function stubNetwork(
    stored: Stored[],
    override: (url: string) => Response | undefined = () => undefined,
    extraLinks: Stored[] = [],
  ) {
    return stubFetch((url) => {
      const custom = override(url);
      if (custom) return custom;

      const plc = url.match(/^https:\/\/plc\.directory\/(.+)$/);
      if (plc) {
        return jsonResponse(
          makePLCResponse(decodeURIComponent(plc[1]), PDS_ENDPOINT),
        );
      }

      const parsed = new URL(url);
      if (url.startsWith(`${CONSTELLATION}/links?`)) {
        const collection = parsed.searchParams.get("collection");
        const linking_records = [
          ...stored.filter(
            (r) => (r.value as { boardUri?: string }).boardUri === BOARD_URI,
          ),
          ...extraLinks,
        ]
          .filter((r) => r.collection === collection)
          .map(({ did, collection, rkey }) => ({ did, collection, rkey }));
        return jsonResponse({ linking_records, cursor: null });
      }

      if (url.includes("com.atproto.repo.getRecord")) {
        const repo = parsed.searchParams.get("repo");
        const collection = parsed.searchParams.get("collection");
        const rkey = parsed.searchParams.get("rkey");
        if (collection === "dev.skyboard.board" && repo === OWNER_DID) {
          return jsonResponse({ value: boardRecord });
        }
        const found = stored.find(
          (r) =>
            r.did === repo && r.collection === collection && r.rkey === rkey,
        );
        return found
          ? jsonResponse({ value: found.value })
          : jsonResponse({ error: "RecordNotFound" }, 400);
      }
      return new Response("", { status: 404 });
    });
  }

  function task(
    did: string,
    rkey: string,
    title: string,
    boardUri = BOARD_URI,
  ): Stored {
    return {
      did,
      collection: "dev.skyboard.task",
      rkey,
      value: {
        boardUri,
        title,
        columnId: "todo",
        position: "a0",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    };
  }

  const ownerTrust: Stored = {
    did: OWNER_DID,
    collection: "dev.skyboard.trust",
    rkey: "trust1",
    value: {
      $type: "dev.skyboard.trust",
      boardUri: BOARD_URI,
      trustedDid: TRUSTED_DID,
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  };

  it("hydrates each linked record from its author's PDS", async () => {
    const mockFetch = stubNetwork([
      task(OWNER_DID, "t1", "Owner task"),
      task(USER_DID, "t2", "User task"),
      ownerTrust,
    ]);

    const data = await fetchBoardData(OWNER_DID, BOARD_RKEY, USER_DID);
    expect(data?.tasks.map((t) => t.title).sort()).toEqual([
      "Owner task",
      "User task",
    ]);
    expect(data?.trusts.map((t) => t.trustedDid)).toEqual([TRUSTED_DID]);
    // Only the board's own records are read — never whole repos
    expect(
      mockFetch.mock.calls.some(([u]) => String(u).includes("listRecords")),
    ).toBe(false);
  });

  it("classifies records by the collection they were linked from, not $type", async () => {
    // `task()` records carry no $type at all
    stubNetwork([task(OWNER_DID, "t1", "Untyped task")]);

    const data = await fetchBoardData(OWNER_DID, BOARD_RKEY, "");
    expect(data?.tasks.map((t) => t.title)).toEqual(["Untyped task"]);
  });

  it("drops linked records that were deleted or moved to another board", async () => {
    stubNetwork(
      [
        task(OWNER_DID, "t1", "Still here"),
        task(
          OWNER_DID,
          "t2",
          "Moved",
          `at://${OWNER_DID}/dev.skyboard.board/other`,
        ),
      ],
      undefined,
      [
        task(OWNER_DID, "t2", "Moved"),
        task(OWNER_DID, "gone", "Deleted since indexed"),
      ],
    );

    const data = await fetchBoardData(OWNER_DID, BOARD_RKEY, "");
    expect(data?.tasks.map((t) => t.title)).toEqual(["Still here"]);
  });

  it("returns null when the board record is genuinely missing", async () => {
    stubNetwork([], (url) =>
      url.includes("com.atproto.repo.getRecord")
        ? jsonResponse({ error: "RecordNotFound" }, 400)
        : undefined,
    );

    await expect(fetchBoardData(OWNER_DID, BOARD_RKEY, "")).resolves.toBeNull();
  });

  it("rejects instead of returning null when the owner's PDS is failing", async () => {
    stubNetwork([], (url) =>
      url.includes("com.atproto.repo.getRecord")
        ? new Response("", { status: 503 })
        : undefined,
    );

    await expect(fetchBoardData(OWNER_DID, BOARD_RKEY, "")).rejects.toThrow(
      /HTTP 503.*dev\.skyboard\.board/,
    );
  });

  it("rejects when Constellation discovery fails", async () => {
    stubNetwork([], (url) =>
      url.startsWith(`${CONSTELLATION}/links?`)
        ? new Response("", { status: 503 })
        : undefined,
    );

    await expect(fetchBoardData(OWNER_DID, BOARD_RKEY, "")).rejects.toThrow(
      /Constellation returned HTTP 503/,
    );
  });

  it("rejects instead of returning only the first Constellation page", async () => {
    stubNetwork([], (url) => {
      if (
        !url.startsWith(`${CONSTELLATION}/links?`) ||
        !url.includes("collection=dev.skyboard.task")
      ) {
        return undefined;
      }
      return url.includes("cursor=next-page")
        ? new Response("", { status: 503 })
        : jsonResponse({ linking_records: [], cursor: "next-page" });
    });

    await expect(fetchBoardData(OWNER_DID, BOARD_RKEY, "")).rejects.toThrow(
      /Constellation returned HTTP 503.*dev\.skyboard\.task/,
    );
  });

  it("rejects when one of the owner's records can't be read", async () => {
    stubNetwork([task(OWNER_DID, "t1", "Owner task")], (url) =>
      url.includes("collection=dev.skyboard.task") &&
      url.includes("com.atproto.repo.getRecord")
        ? new Response("", { status: 503 })
        : undefined,
    );

    await expect(fetchBoardData(OWNER_DID, BOARD_RKEY, "")).rejects.toThrow(
      /PDS returned HTTP 503.*dev\.skyboard\.task/,
    );
  });

  it("rejects when a trusted participant PDS cannot be resolved", async () => {
    stubNetwork([ownerTrust, task(TRUSTED_DID, "t1", "Trusted task")], (url) =>
      url.startsWith(`https://plc.directory/${TRUSTED_DID}`)
        ? new Response("", { status: 503 })
        : undefined,
    );

    await expect(fetchBoardData(OWNER_DID, BOARD_RKEY, "")).rejects.toThrow(
      `Could not resolve PDS for ${TRUSTED_DID}`,
    );
  });

  it("skips an untrusted participant whose PDS cannot be resolved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubNetwork(
      [
        task(OWNER_DID, "t1", "Owner task"),
        task(UNTRUSTED_DID, "t2", "Untrusted task"),
      ],
      (url) =>
        url.startsWith(`https://plc.directory/${UNTRUSTED_DID}`)
          ? new Response("", { status: 503 })
          : undefined,
    );

    const data = await fetchBoardData(OWNER_DID, BOARD_RKEY, "");
    expect(data?.board.name).toBe("Test Board");
    expect(data?.tasks.map((t) => t.title)).toEqual(["Owner task"]);
    expect(data?.unreadableParticipants).toEqual([UNTRUSTED_DID]);
  });

  it("resolves each participant's PDS once however many records they have", async () => {
    const mockFetch = stubNetwork([
      task(USER_DID, "t1", "One"),
      task(USER_DID, "t2", "Two"),
      task(USER_DID, "t3", "Three"),
    ]);

    await fetchBoardData(OWNER_DID, BOARD_RKEY, "");
    const lookups = mockFetch.mock.calls.filter(([u]) =>
      String(u).startsWith(`https://plc.directory/${USER_DID}`),
    );
    expect(lookups).toHaveLength(1);
  });
});

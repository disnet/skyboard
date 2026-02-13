import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OWNER_DID,
  USER_DID,
} from "./helpers.js";

let resolveHandle: typeof import("../lib/pds.js").resolveHandle;

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();

  const mod = await import("../lib/pds.js");
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

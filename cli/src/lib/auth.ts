import { Agent } from "@atproto/api";
import { NodeOAuthClient } from "@atproto/oauth-client-node";
import type {
  NodeSavedSession,
  NodeSavedState,
} from "@atproto/oauth-client-node";
import { requestLocalLock } from "@atproto/oauth-client";
import { createServer } from "node:http";
import {
  type AuthInfo,
  writeStateFile,
  readStateFile,
  deleteStateFile,
  writeSessionFile,
  readSessionFile,
  deleteSessionFile,
  loadAuthInfo,
  saveAuthInfo,
  clearAuthInfo,
} from "./config.js";

const OAUTH_SCOPE =
  "atproto repo:dev.skyboard.board repo:dev.skyboard.task repo:dev.skyboard.op repo:dev.skyboard.trust repo:dev.skyboard.comment repo:dev.skyboard.approval repo:dev.skyboard.reaction";

// File-based stores implementing the NodeOAuthClient interfaces
const stateStore = {
  async set(key: string, state: NodeSavedState): Promise<void> {
    writeStateFile(key, state);
  },
  async get(key: string): Promise<NodeSavedState | undefined> {
    return readStateFile(key) as NodeSavedState | undefined;
  },
  async del(key: string): Promise<void> {
    deleteStateFile(key);
  },
};

const sessionStore = {
  async set(sub: string, session: NodeSavedSession): Promise<void> {
    writeSessionFile(sub, session);
  },
  async get(sub: string): Promise<NodeSavedSession | undefined> {
    return readSessionFile(sub) as NodeSavedSession | undefined;
  },
  async del(sub: string): Promise<void> {
    deleteSessionFile(sub);
  },
};

function createOAuthClient(port: number): NodeOAuthClient {
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  return new NodeOAuthClient({
    clientMetadata: {
      client_id: `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(OAUTH_SCOPE)}`,
      client_name: "Skyboard CLI",
      redirect_uris: [redirectUri],
      scope: OAUTH_SCOPE,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
      dpop_bound_access_tokens: true,
    },
    stateStore,
    sessionStore,
    requestLock: requestLocalLock,
  });
}

/**
 * Find a free port by binding to port 0.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not determine port")));
      }
    });
    srv.on("error", reject);
  });
}

/**
 * Perform OAuth loopback login. Opens browser for authorization,
 * starts a local HTTP server for the callback.
 * Returns the DID and handle of the authenticated user.
 */
export async function login(
  handle: string,
): Promise<{ did: string; handle: string }> {
  const port = await findFreePort();
  const client = createOAuthClient(port);

  const authUrl = await client.authorize(handle, {
    scope: OAUTH_SCOPE,
  });

  // Start callback server
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Login timed out after 120 seconds"));
    }, 120_000);

    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const { session } = await client.callback(url.searchParams);

        const did = session.did;
        // Resolve handle from DID
        const agent = new Agent(session);
        let resolvedHandle = handle;
        try {
          const profile = await agent.getProfile({ actor: did });
          resolvedHandle = profile.data.handle;
        } catch {
          // Use the provided handle as fallback
        }

        // Find the PDS endpoint for this DID
        let service = "https://bsky.social";
        try {
          const didDoc = await resolveDIDDocument(did);
          if (didDoc) {
            const services = (didDoc as Record<string, unknown>).service as
              | Array<{ id: string; type: string; serviceEndpoint: string }>
              | undefined;
            const pds = services?.find(
              (s) =>
                s.id === "#atproto_pds" ||
                s.type === "AtprotoPersonalDataServer",
            );
            if (pds?.serviceEndpoint) {
              service = pds.serviceEndpoint;
            }
          }
        } catch {
          // fallback to default
        }

        saveAuthInfo({ did, handle: resolvedHandle, service, oauthPort: port });

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html><body style="font-family: system-ui; text-align: center; padding: 40px;">
            <h2>Logged in to Skyboard CLI</h2>
            <p>You can close this tab and return to your terminal.</p>
          </body></html>
        `);

        clearTimeout(timeout);
        server.close();
        resolve({ did, handle: resolvedHandle });
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`
          <html><body style="font-family: system-ui; text-align: center; padding: 40px;">
            <h2>Login failed</h2>
            <p>${err instanceof Error ? err.message : "Unknown error"}</p>
          </body></html>
        `);
        clearTimeout(timeout);
        server.close();
        reject(err);
      }
    });

    server.listen(port, "127.0.0.1", async () => {
      // Open browser
      try {
        const open = (await import("open")).default;
        await open(authUrl.toString());
        console.log(`\nOpened browser for login. Waiting for authorization...`);
        console.log(
          `If the browser didn't open, visit:\n${authUrl.toString()}\n`,
        );
      } catch {
        console.log(
          `\nOpen this URL in your browser to log in:\n${authUrl.toString()}\n`,
        );
      }
    });
  });
}

/**
 * Get an authenticated Agent for the currently logged-in user.
 * Restores the OAuth session and returns an Agent that auto-refreshes tokens.
 */
export async function getAgent(authInfo?: AuthInfo | null): Promise<{
  agent: Agent;
  did: string;
  handle: string;
} | null> {
  const info = authInfo ?? loadAuthInfo();
  if (!info) return null;

  try {
    // Use the same port from the original login so the client_id matches.
    // A mismatched client_id causes token refresh to fail after ~1 hour
    // when the access token expires.
    const port = info.oauthPort ?? 0;
    const client = createOAuthClient(port);
    const session = await client.restore(info.did);
    const agent = new Agent(session);
    return { agent, did: info.did, handle: info.handle };
  } catch {
    return null;
  }
}

/**
 * Require authentication — exit with error if not logged in.
 */
export async function requireAgent(): Promise<{
  agent: Agent;
  did: string;
  handle: string;
}> {
  const authInfo = loadAuthInfo();
  const result = await getAgent(authInfo);
  if (!result) {
    if (authInfo) {
      console.error(
        "Session expired. Run `sb login " +
          authInfo.handle +
          "` to re-authenticate.",
      );
    } else {
      console.error("Not logged in. Run `sb login <handle>` first.");
    }
    process.exit(1);
  }
  return result;
}

export function logout(): void {
  const authInfo = loadAuthInfo();
  if (authInfo) {
    deleteSessionFile(authInfo.did);
  }
  clearAuthInfo();
}

async function resolveDIDDocument(did: string): Promise<unknown | null> {
  try {
    if (did.startsWith("did:plc:")) {
      const res = await fetch(`https://plc.directory/${did}`);
      if (!res.ok) return null;
      return await res.json();
    } else if (did.startsWith("did:web:")) {
      const host = did.slice("did:web:".length).replaceAll(":", "/");
      const res = await fetch(`https://${host}/.well-known/did.json`);
      if (!res.ok) return null;
      return await res.json();
    }
    return null;
  } catch {
    return null;
  }
}

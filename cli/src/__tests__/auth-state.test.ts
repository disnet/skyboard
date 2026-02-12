import { describe, it, expect, vi, beforeEach } from "vitest";
import { OWNER_DID, USER_DID, BOARD_RKEY } from "./helpers.js";

// Mock config module
const mockLoadAuthInfo = vi.fn();
const mockClearDefaultBoard = vi.fn();
const mockGetDefaultBoard = vi.fn();

vi.mock("../lib/config.js", () => ({
  loadAuthInfo: (...args: unknown[]) => mockLoadAuthInfo(...args),
  clearDefaultBoard: (...args: unknown[]) => mockClearDefaultBoard(...args),
  getDefaultBoard: (...args: unknown[]) => mockGetDefaultBoard(...args),
}));

// Mock auth module
const mockLogin = vi.fn();
const mockLogout = vi.fn();

vi.mock("../lib/auth.js", () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
}));

import { logoutCommand } from "../commands/logout.js";
import { loginCommand } from "../commands/login.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("logoutCommand", () => {
  it("clears the default board on logout", () => {
    mockLoadAuthInfo.mockReturnValue({
      did: OWNER_DID,
      handle: "owner.test",
      service: "https://pds.example.com",
    });

    logoutCommand();

    expect(mockLogout).toHaveBeenCalledOnce();
    expect(mockClearDefaultBoard).toHaveBeenCalledOnce();
  });

  it("does not clear board if not logged in", () => {
    mockLoadAuthInfo.mockReturnValue(null);

    logoutCommand();

    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockClearDefaultBoard).not.toHaveBeenCalled();
  });
});

describe("loginCommand", () => {
  it("clears the default board when switching to a different account", async () => {
    mockLoadAuthInfo.mockReturnValue({
      did: OWNER_DID,
      handle: "owner.test",
      service: "https://pds.example.com",
    });
    mockLogin.mockResolvedValue({ did: USER_DID, handle: "user.test" });

    await loginCommand("user.test");

    expect(mockClearDefaultBoard).toHaveBeenCalledOnce();
  });

  it("does not clear the default board when logging in as the same account", async () => {
    mockLoadAuthInfo.mockReturnValue({
      did: OWNER_DID,
      handle: "owner.test",
      service: "https://pds.example.com",
    });
    mockLogin.mockResolvedValue({ did: OWNER_DID, handle: "owner.test" });

    await loginCommand("owner.test");

    expect(mockClearDefaultBoard).not.toHaveBeenCalled();
  });

  it("does not clear the default board on first login (no previous auth)", async () => {
    mockLoadAuthInfo.mockReturnValue(null);
    mockLogin.mockResolvedValue({ did: OWNER_DID, handle: "owner.test" });

    await loginCommand("owner.test");

    expect(mockClearDefaultBoard).not.toHaveBeenCalled();
  });

  it("does not clear the default board if login fails", async () => {
    mockLoadAuthInfo.mockReturnValue({
      did: OWNER_DID,
      handle: "owner.test",
      service: "https://pds.example.com",
    });
    mockLogin.mockRejectedValue(new Error("OAuth failed"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(loginCommand("user.test")).rejects.toThrow("process.exit");

    expect(mockClearDefaultBoard).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });
});

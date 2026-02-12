// Synced from ../src/lib/permissions.ts

export type PermissionStatus = "allowed" | "pending" | "denied";
export type ActionType = "create_task" | "comment" | "edit" | "move";

export function isTrusted(
  userDid: string,
  boardOwnerDid: string,
  trustedDids: Set<string>,
): boolean {
  return userDid === boardOwnerDid || trustedDids.has(userDid);
}

export function getActionStatus(
  userDid: string,
  boardOwnerDid: string,
  trustedDids: Set<string>,
  boardOpen: boolean,
  action: ActionType,
): PermissionStatus {
  if (isTrusted(userDid, boardOwnerDid, trustedDids)) return "allowed";

  if (action === "create_task" || action === "comment") {
    return boardOpen ? "pending" : "denied";
  }

  return "denied";
}

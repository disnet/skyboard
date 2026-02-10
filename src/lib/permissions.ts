export type PermissionStatus = "allowed" | "pending" | "denied";

export type ActionType = "create_task" | "comment" | "edit" | "move";

export function isTrusted(
  userDid: string,
  boardOwnerDid: string,
  trustedDids: Set<string>,
): boolean {
  return userDid === boardOwnerDid || trustedDids.has(userDid);
}

/**
 * Determine permission status for a user performing an action.
 *
 * - owner/trusted → always allowed
 * - create_task / comment on open board → pending (goes to proposals)
 * - edit / move → denied for non-trusted users
 * - anything on closed board for non-trusted → denied
 */
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

  // edit and move are always restricted to trusted users
  return "denied";
}

/**
 * Determine whether content (task or comment) should be visible on the board.
 *
 * - Author is owner or trusted → yes
 * - Author is current user → yes (own content always visible to self)
 * - Board is open AND content has approval → yes
 * - Otherwise → no
 */
export function isContentVisible(
  authorDid: string,
  currentUserDid: string,
  boardOwnerDid: string,
  trustedDids: Set<string>,
  boardOpen: boolean,
  approvedUris: Set<string>,
  contentUri: string,
): boolean {
  if (isTrusted(authorDid, boardOwnerDid, trustedDids)) return true;
  if (authorDid === currentUserDid) return true;
  if (boardOpen && approvedUris.has(contentUri)) return true;
  return false;
}

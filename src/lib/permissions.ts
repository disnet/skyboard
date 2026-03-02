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
 * Check if a user is trusted to edit a task.
 * Returns true if the user is the task author, in the task's trust list,
 * or has been assigned to the task (terminal permission).
 * task.open no longer grants auto-trust — open tasks use approval flow instead.
 */
export function isTaskTrusted(
  userDid: string,
  taskAuthorDid: string,
  taskTrustedDids: Set<string>,
  assignedDids?: Set<string>,
): boolean {
  if (userDid === taskAuthorDid) return true;
  if (taskTrustedDids.has(userDid)) return true;
  if (assignedDids?.has(userDid)) return true;
  return false;
}

export type TaskActionType = "edit" | "assign";

/**
 * Determine permission status for a task-level action.
 * - task-trusted → allowed
 * - edit on open task → pending (goes to approval)
 * - otherwise → denied
 */
export function getTaskActionStatus(
  userDid: string,
  taskAuthorDid: string,
  taskTrustedDids: Set<string>,
  assignedDids: Set<string>,
  taskOpen: boolean,
  action: TaskActionType,
): PermissionStatus {
  if (isTaskTrusted(userDid, taskAuthorDid, taskTrustedDids, assignedDids))
    return "allowed";
  if (action === "edit" && taskOpen) return "pending";
  return "denied";
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

/**
 * Check if a user can create an assignment for a task.
 * Only task author or explicit TaskTrust holders can assign others.
 * Self-assignment is allowed on open tasks.
 * Assignment-based trust does NOT grant the ability to assign others (terminal permission).
 */
export function canCreateAssignment(
  authorDid: string,
  assigneeDid: string,
  taskAuthorDid: string,
  taskTrustedDids: Set<string>,
  taskOpen: boolean,
): boolean {
  // Task author can assign anyone
  if (authorDid === taskAuthorDid) return true;
  // Explicit TaskTrust holders can assign (NOT assignment-based trust)
  if (taskTrustedDids.has(authorDid)) return true;
  // Self-assignment on open tasks
  if (authorDid === assigneeDid && taskOpen) return true;
  return false;
}

/**
 * Check if a user is trusted to edit a project.
 * Returns true if the user is the project author or in the project's trust list.
 */
export function isProjectTrusted(
  userDid: string,
  projectAuthorDid: string,
  projectTrustedDids: Set<string>,
): boolean {
  if (userDid === projectAuthorDid) return true;
  if (projectTrustedDids.has(userDid)) return true;
  return false;
}

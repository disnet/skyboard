import type {
  Board,
  BoardPermissions,
  PermissionScope,
  OperationType,
} from "./types.js";

const DEFAULT_PERMISSIONS: BoardPermissions = {
  rules: [
    { operation: "create_task", scope: "trusted" },
    { operation: "edit_title", scope: "trusted" },
    { operation: "edit_description", scope: "trusted" },
    { operation: "move_task", scope: "trusted" },
    { operation: "reorder", scope: "trusted" },
    { operation: "comment", scope: "trusted" },
  ],
};

export function getBoardPermissions(board: Board): BoardPermissions {
  return board.permissions ?? DEFAULT_PERMISSIONS;
}

const SCOPE_ORDER: PermissionScope[] = ["author_only", "trusted", "anyone"];

/**
 * Get the broadest effective scope for an operation, optionally in a specific column.
 */
export function getEffectiveScope(
  permissions: BoardPermissions,
  operation: OperationType,
  columnId?: string,
): PermissionScope {
  const matchingRules = permissions.rules.filter((r) => {
    if (r.operation !== operation) return false;
    if (r.columnIds && r.columnIds.length > 0 && columnId) {
      return r.columnIds.includes(columnId);
    }
    if (!r.columnIds || r.columnIds.length === 0) return true;
    return false;
  });

  if (matchingRules.length === 0) return "author_only";

  let broadest: PermissionScope = "author_only";
  for (const rule of matchingRules) {
    if (SCOPE_ORDER.indexOf(rule.scope) > SCOPE_ORDER.indexOf(broadest)) {
      broadest = rule.scope;
    }
  }
  return broadest;
}

export type PermissionStatus = "allowed" | "pending" | "denied";

/**
 * Get the permission status for a user performing an operation.
 * - 'allowed': user can perform the operation
 * - 'pending': scope is 'trusted' but user isn't on the trusted list yet
 * - 'denied': scope is 'author_only' and user is not the author
 */
export function getPermissionStatus(
  userDid: string,
  boardOwnerDid: string,
  ownerTrustedDids: Set<string>,
  permissions: BoardPermissions,
  operation: OperationType,
  columnId?: string,
): PermissionStatus {
  if (userDid === boardOwnerDid) return "allowed";

  const scope = getEffectiveScope(permissions, operation, columnId);

  switch (scope) {
    case "author_only":
      return "denied";
    case "trusted":
      return ownerTrustedDids.has(userDid) ? "allowed" : "pending";
    case "anyone":
      return "allowed";
    default:
      return "denied";
  }
}

/**
 * Check if a user has permission for a given operation.
 */
export function hasPermission(
  userDid: string,
  boardOwnerDid: string,
  ownerTrustedDids: Set<string>,
  permissions: BoardPermissions,
  operation: OperationType,
  columnId?: string,
): boolean {
  return (
    getPermissionStatus(
      userDid,
      boardOwnerDid,
      ownerTrustedDids,
      permissions,
      operation,
      columnId,
    ) === "allowed"
  );
}

/**
 * Map an OpFields key to its corresponding OperationType.
 */
export function fieldToOperation(
  fieldName: string,
  hasColumnIdChange: boolean,
): OperationType {
  switch (fieldName) {
    case "title":
      return "edit_title";
    case "description":
      return "edit_description";
    case "columnId":
      return "move_task";
    case "position":
    case "order":
      return hasColumnIdChange ? "move_task" : "reorder";
    default:
      return "edit_title";
  }
}

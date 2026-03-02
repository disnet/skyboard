import { TID } from "@atproto/common-web";

export const BOARD_COLLECTION = "dev.skyboard.board";
export const TASK_COLLECTION = "dev.skyboard.task";
export const OP_COLLECTION = "dev.skyboard.op";
export const TRUST_COLLECTION = "dev.skyboard.trust";
export const COMMENT_COLLECTION = "dev.skyboard.comment";
export const APPROVAL_COLLECTION = "dev.skyboard.approval";
export const REACTION_COLLECTION = "dev.skyboard.reaction";
export const PLACEMENT_COLLECTION = "dev.skyboard.placement";
export const PLACEMENT_OP_COLLECTION = "dev.skyboard.placementOp";
export const TASK_OP_COLLECTION = "dev.skyboard.taskOp";
export const TASK_TRUST_COLLECTION = "dev.skyboard.taskTrust";
export const PROJECT_COLLECTION = "dev.skyboard.project";
export const MEMBERSHIP_COLLECTION = "dev.skyboard.membership";
export const ASSIGNMENT_COLLECTION = "dev.skyboard.assignment";
export const PROJECT_TRUST_COLLECTION = "dev.skyboard.projectTrust";
export const LABEL_COLLECTION = "dev.skyboard.label";
export const PROJECT_OP_COLLECTION = "dev.skyboard.projectOp";
export const COMMENT_OP_COLLECTION = "dev.skyboard.commentOp";
export const BOARD_OP_COLLECTION = "dev.skyboard.boardOp";

export function generateTID(): string {
  return TID.nextStr();
}

export function buildAtUri(
  did: string,
  collection: string,
  rkey: string,
): string {
  return `at://${did}/${collection}/${rkey}`;
}

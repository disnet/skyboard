import type { Agent } from "@atproto/api";
import { db } from "./db.js";
import {
  BOARD_COLLECTION,
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
  PLACEMENT_COLLECTION,
  PLACEMENT_OP_COLLECTION,
  TASK_OP_COLLECTION,
  TASK_TRUST_COLLECTION,
  PROJECT_COLLECTION,
  MEMBERSHIP_COLLECTION,
  ASSIGNMENT_COLLECTION,
  PROJECT_TRUST_COLLECTION,
  LABEL_COLLECTION,
  PROJECT_OP_COLLECTION,
  COMMENT_OP_COLLECTION,
  BOARD_OP_COLLECTION,
  buildAtUri,
} from "./tid.js";
import type {
  Board,
  Task,
  Op,
  Trust,
  Comment,
  Approval,
  Reaction,
  Placement,
  PlacementOp,
  TaskOp,
  TaskTrust,
  Project,
  Membership,
  Assignment,
  ProjectTrust,
  Label,
  ProjectOp,
  CommentOp,
  BoardOp,
  BoardRecord,
  TaskRecord,
  PlacementRecord,
  PlacementOpRecord,
  TaskOpRecord,
  TaskTrustRecord,
  ProjectRecord,
  MembershipRecord,
  AssignmentRecord,
  ProjectTrustRecord,
  LabelRecord,
  ProjectOpRecord,
  CommentOpRecord,
} from "./types.js";
import { opToRecord } from "./ops.js";
import { trustToRecord } from "./trust.js";
import { commentToRecord } from "./comments.js";
import { approvalToRecord } from "./approvals.js";
import { reactionToRecord } from "./reactions.js";
import { labelToRecord } from "./labels.js";
import { projectOpToRecord } from "./project-ops.js";
import { commentOpToRecord } from "./comment-ops.js";
import { boardOpToRecord } from "./board-ops.js";

let syncInterval: ReturnType<typeof setInterval> | null = null;
let syncInProgress = false;
let currentAgent: Agent | null = null;
let currentDid: string | null = null;
let pendingWriteTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHandler: (() => void) | null = null;
let pagehideHandler: (() => void) | null = null;

function boardToRecord(board: Board): BoardRecord {
  return {
    $type: "dev.skyboard.board",
    name: board.name,
    ...(board.description ? { description: board.description } : {}),
    columns: board.columns,
    ...(board.labels && board.labels.length > 0
      ? { labels: board.labels }
      : {}),
    ...(board.open ? { open: board.open } : {}),
    createdAt: board.createdAt,
  };
}

function taskToRecord(task: Task): TaskRecord {
  return {
    $type: "dev.skyboard.task",
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    ...(task.status ? { status: task.status } : {}),
    ...(task.open ? { open: task.open } : {}),
    ...(task.labelIds && task.labelIds.length > 0
      ? { labelIds: task.labelIds }
      : {}),
    ...(task.forkedFrom ? { forkedFrom: task.forkedFrom } : {}),
    ...(task.columnId ? { columnId: task.columnId } : {}),
    ...(task.boardUri ? { boardUri: task.boardUri } : {}),
    ...(task.position ? { position: task.position } : {}),
    order: task.order ?? 0,
    createdAt: task.createdAt,
    ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
  };
}

function placementToRecord(placement: Placement): PlacementRecord {
  return {
    $type: "dev.skyboard.placement",
    taskUri: placement.taskUri,
    boardUri: placement.boardUri,
    columnId: placement.columnId,
    position: placement.position,
    createdAt: placement.createdAt,
  };
}

function placementOpToRecord(op: PlacementOp): PlacementOpRecord {
  return {
    $type: "dev.skyboard.placementOp",
    targetPlacementUri: op.targetPlacementUri,
    fields: op.fields,
    createdAt: op.createdAt,
  };
}

function taskOpToRecord(op: TaskOp): TaskOpRecord {
  return {
    $type: "dev.skyboard.taskOp",
    targetTaskUri: op.targetTaskUri,
    fields: op.fields,
    createdAt: op.createdAt,
  };
}

function taskTrustToRecord(trust: TaskTrust): TaskTrustRecord {
  return {
    $type: "dev.skyboard.taskTrust",
    taskUri: trust.taskUri,
    trustedDid: trust.trustedDid,
    createdAt: trust.createdAt,
  };
}

function projectToRecord(project: Project): ProjectRecord {
  return {
    $type: "dev.skyboard.project",
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    ...(project.labels && project.labels.length > 0
      ? { labels: project.labels }
      : {}),
    ...(project.labelUris && project.labelUris.length > 0
      ? { labelUris: project.labelUris }
      : {}),
    createdAt: project.createdAt,
  };
}

function membershipToRecord(membership: Membership): MembershipRecord {
  return {
    $type: "dev.skyboard.membership",
    taskUri: membership.taskUri,
    projectUri: membership.projectUri,
    createdAt: membership.createdAt,
  };
}

function assignmentToRecord(assignment: Assignment): AssignmentRecord {
  return {
    $type: "dev.skyboard.assignment",
    taskUri: assignment.taskUri,
    assigneeDid: assignment.assigneeDid,
    createdAt: assignment.createdAt,
  };
}

function projectTrustToRecord(trust: ProjectTrust): ProjectTrustRecord {
  return {
    $type: "dev.skyboard.projectTrust",
    projectUri: trust.projectUri,
    trustedDid: trust.trustedDid,
    createdAt: trust.createdAt,
  };
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === "Failed to fetch")
    return true;
  const name = (err as { name?: string })?.name;
  return name === "FetchRequestError" || name === "_FetchRequestError";
}

export async function syncPendingToPDS(
  agent: Agent,
  did: string,
): Promise<void> {
  if (!navigator.onLine) return;
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    await syncPendingToPDSInner(agent, did);
  } finally {
    syncInProgress = false;
  }
}

async function syncPendingToPDSInner(agent: Agent, did: string): Promise<void> {
  const pendingBoards = await db.boards
    .where("syncStatus")
    .equals("pending")
    .filter((b) => b.did === did)
    .toArray();

  for (const board of pendingBoards) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: BOARD_COLLECTION,
        rkey: board.rkey,
        record: boardToRecord(board),
        validate: false,
      });
      if (board.id) {
        await db.boards.update(board.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync board to PDS:", err);
      if (board.id && !isNetworkError(err)) {
        await db.boards.update(board.id, { syncStatus: "error" });
      }
    }
  }

  const pendingTasks = await db.tasks
    .where("syncStatus")
    .equals("pending")
    .filter((t) => t.did === did && t.title !== "")
    .toArray();

  for (const task of pendingTasks) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: TASK_COLLECTION,
        rkey: task.rkey,
        record: taskToRecord(task),
        validate: false,
      });
      if (task.id) {
        await db.tasks.update(task.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync task to PDS:", err);
      if (task.id && !isNetworkError(err)) {
        await db.tasks.update(task.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending ops
  const pendingOps = await db.ops
    .where("syncStatus")
    .equals("pending")
    .filter((o) => o.did === did)
    .toArray();

  for (const op of pendingOps) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: OP_COLLECTION,
        rkey: op.rkey,
        record: opToRecord(op),
        validate: false,
      });
      if (op.id) {
        await db.ops.update(op.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync op to PDS:", err);
      if (op.id && !isNetworkError(err)) {
        await db.ops.update(op.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending trusts
  const pendingTrusts = await db.trusts
    .where("syncStatus")
    .equals("pending")
    .filter((t) => t.did === did)
    .toArray();

  for (const trust of pendingTrusts) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: TRUST_COLLECTION,
        rkey: trust.rkey,
        record: trustToRecord(trust),
        validate: false,
      });
      if (trust.id) {
        await db.trusts.update(trust.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync trust to PDS:", err);
      if (trust.id && !isNetworkError(err)) {
        await db.trusts.update(trust.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending comments
  const pendingComments = await db.comments
    .where("syncStatus")
    .equals("pending")
    .filter((c) => c.did === did)
    .toArray();

  for (const comment of pendingComments) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: COMMENT_COLLECTION,
        rkey: comment.rkey,
        record: commentToRecord(comment),
        validate: false,
      });
      if (comment.id) {
        await db.comments.update(comment.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync comment to PDS:", err);
      if (comment.id && !isNetworkError(err)) {
        await db.comments.update(comment.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending approvals
  const pendingApprovals = await db.approvals
    .where("syncStatus")
    .equals("pending")
    .filter((a) => a.did === did)
    .toArray();

  for (const approval of pendingApprovals) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: APPROVAL_COLLECTION,
        rkey: approval.rkey,
        record: approvalToRecord(approval),
        validate: false,
      });
      if (approval.id) {
        await db.approvals.update(approval.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync approval to PDS:", err);
      if (approval.id && !isNetworkError(err)) {
        await db.approvals.update(approval.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending reactions
  const pendingReactions = await db.reactions
    .where("syncStatus")
    .equals("pending")
    .filter((r) => r.did === did)
    .toArray();

  for (const reaction of pendingReactions) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: REACTION_COLLECTION,
        rkey: reaction.rkey,
        record: reactionToRecord(reaction),
        validate: false,
      });
      if (reaction.id) {
        await db.reactions.update(reaction.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync reaction to PDS:", err);
      if (reaction.id && !isNetworkError(err)) {
        await db.reactions.update(reaction.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending placements
  const pendingPlacements = await db.placements
    .where("syncStatus")
    .equals("pending")
    .filter((p) => p.did === did)
    .toArray();

  for (const placement of pendingPlacements) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: PLACEMENT_COLLECTION,
        rkey: placement.rkey,
        record: placementToRecord(placement),
        validate: false,
      });
      if (placement.id) {
        await db.placements.update(placement.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync placement to PDS:", err);
      if (placement.id && !isNetworkError(err)) {
        await db.placements.update(placement.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending placement ops
  const pendingPlacementOps = await db.placementOps
    .where("syncStatus")
    .equals("pending")
    .filter((o) => o.did === did)
    .toArray();

  for (const op of pendingPlacementOps) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: PLACEMENT_OP_COLLECTION,
        rkey: op.rkey,
        record: placementOpToRecord(op),
        validate: false,
      });
      if (op.id) {
        await db.placementOps.update(op.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync placement op to PDS:", err);
      if (op.id && !isNetworkError(err)) {
        await db.placementOps.update(op.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending task ops
  const pendingTaskOps = await db.taskOps
    .where("syncStatus")
    .equals("pending")
    .filter((o) => o.did === did)
    .toArray();

  for (const op of pendingTaskOps) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: TASK_OP_COLLECTION,
        rkey: op.rkey,
        record: taskOpToRecord(op),
        validate: false,
      });
      if (op.id) {
        await db.taskOps.update(op.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync task op to PDS:", err);
      if (op.id && !isNetworkError(err)) {
        await db.taskOps.update(op.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending task trusts
  const pendingTaskTrusts = await db.taskTrusts
    .where("syncStatus")
    .equals("pending")
    .filter((t) => t.did === did)
    .toArray();

  for (const trust of pendingTaskTrusts) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: TASK_TRUST_COLLECTION,
        rkey: trust.rkey,
        record: taskTrustToRecord(trust),
        validate: false,
      });
      if (trust.id) {
        await db.taskTrusts.update(trust.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync task trust to PDS:", err);
      if (trust.id && !isNetworkError(err)) {
        await db.taskTrusts.update(trust.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending projects
  const pendingProjects = await db.projects
    .where("syncStatus")
    .equals("pending")
    .filter((p) => p.did === did)
    .toArray();

  for (const project of pendingProjects) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: PROJECT_COLLECTION,
        rkey: project.rkey,
        record: projectToRecord(project),
        validate: false,
      });
      if (project.id) {
        await db.projects.update(project.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync project to PDS:", err);
      if (project.id && !isNetworkError(err)) {
        await db.projects.update(project.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending memberships
  const pendingMemberships = await db.memberships
    .where("syncStatus")
    .equals("pending")
    .filter((m) => m.did === did)
    .toArray();

  for (const membership of pendingMemberships) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: MEMBERSHIP_COLLECTION,
        rkey: membership.rkey,
        record: membershipToRecord(membership),
        validate: false,
      });
      if (membership.id) {
        await db.memberships.update(membership.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync membership to PDS:", err);
      if (membership.id && !isNetworkError(err)) {
        await db.memberships.update(membership.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending assignments
  const pendingAssignments = await db.assignments
    .where("syncStatus")
    .equals("pending")
    .filter((a) => a.did === did)
    .toArray();

  for (const assignment of pendingAssignments) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: ASSIGNMENT_COLLECTION,
        rkey: assignment.rkey,
        record: assignmentToRecord(assignment),
        validate: false,
      });
      if (assignment.id) {
        await db.assignments.update(assignment.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync assignment to PDS:", err);
      if (assignment.id && !isNetworkError(err)) {
        await db.assignments.update(assignment.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending project trusts
  const pendingProjectTrusts = await db.projectTrusts
    .where("syncStatus")
    .equals("pending")
    .filter((t) => t.did === did)
    .toArray();

  for (const trust of pendingProjectTrusts) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: PROJECT_TRUST_COLLECTION,
        rkey: trust.rkey,
        record: projectTrustToRecord(trust),
        validate: false,
      });
      if (trust.id) {
        await db.projectTrusts.update(trust.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync project trust to PDS:", err);
      if (trust.id && !isNetworkError(err)) {
        await db.projectTrusts.update(trust.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending labels
  const pendingLabels = await db.labels
    .where("syncStatus")
    .equals("pending")
    .filter((l) => l.did === did)
    .toArray();

  for (const label of pendingLabels) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: LABEL_COLLECTION,
        rkey: label.rkey,
        record: labelToRecord(label),
        validate: false,
      });
      if (label.id) {
        await db.labels.update(label.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync label to PDS:", err);
      if (label.id && !isNetworkError(err)) {
        await db.labels.update(label.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending project ops
  const pendingProjectOps = await db.projectOps
    .where("syncStatus")
    .equals("pending")
    .filter((o) => o.did === did)
    .toArray();

  for (const op of pendingProjectOps) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: PROJECT_OP_COLLECTION,
        rkey: op.rkey,
        record: projectOpToRecord(op),
        validate: false,
      });
      if (op.id) {
        await db.projectOps.update(op.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync project op to PDS:", err);
      if (op.id && !isNetworkError(err)) {
        await db.projectOps.update(op.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending comment ops
  const pendingCommentOps = await db.commentOps
    .where("syncStatus")
    .equals("pending")
    .filter((o) => o.did === did)
    .toArray();

  for (const op of pendingCommentOps) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: COMMENT_OP_COLLECTION,
        rkey: op.rkey,
        record: commentOpToRecord(op),
        validate: false,
      });
      if (op.id) {
        await db.commentOps.update(op.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync comment op to PDS:", err);
      if (op.id && !isNetworkError(err)) {
        await db.commentOps.update(op.id, { syncStatus: "error" });
      }
    }
  }

  // Sync pending board ops
  const pendingBoardOps = await db.boardOps
    .where("syncStatus")
    .equals("pending")
    .filter((o) => o.did === did)
    .toArray();

  for (const op of pendingBoardOps) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: BOARD_OP_COLLECTION,
        rkey: op.rkey,
        record: boardOpToRecord(op),
        validate: false,
      });
      if (op.id) {
        await db.boardOps.update(op.id, { syncStatus: "synced" });
      }
    } catch (err) {
      console.error("Failed to sync board op to PDS:", err);
      if (op.id && !isNetworkError(err)) {
        await db.boardOps.update(op.id, { syncStatus: "error" });
      }
    }
  }
}

export async function deleteBoardFromPDS(
  agent: Agent,
  did: string,
  board: Board,
): Promise<void> {
  // Delete tasks from PDS first
  const boardUri = buildAtUri(did, BOARD_COLLECTION, board.rkey);
  const tasks = await db.tasks.where("boardUri").equals(boardUri).toArray();

  for (const task of tasks) {
    if (task.syncStatus === "synced") {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: TASK_COLLECTION,
          rkey: task.rkey,
        });
      } catch (err) {
        console.error("Failed to delete task from PDS:", err);
      }
    }
  }

  // Delete comments from PDS
  const comments = await db.comments
    .where("boardUri")
    .equals(boardUri)
    .filter((c) => c.did === did)
    .toArray();

  for (const comment of comments) {
    if (comment.syncStatus === "synced") {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: COMMENT_COLLECTION,
          rkey: comment.rkey,
        });
      } catch (err) {
        console.error("Failed to delete comment from PDS:", err);
      }
    }
  }

  // Delete approvals from PDS
  const approvals = await db.approvals
    .where("boardUri")
    .equals(boardUri)
    .filter((a) => a.did === did)
    .toArray();

  for (const approval of approvals) {
    if (approval.syncStatus === "synced") {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: APPROVAL_COLLECTION,
          rkey: approval.rkey,
        });
      } catch (err) {
        console.error("Failed to delete approval from PDS:", err);
      }
    }
  }

  // Delete reactions from PDS
  const reactions = await db.reactions
    .where("boardUri")
    .equals(boardUri)
    .filter((r) => r.did === did)
    .toArray();

  for (const reaction of reactions) {
    if (reaction.syncStatus === "synced") {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: REACTION_COLLECTION,
          rkey: reaction.rkey,
        });
      } catch (err) {
        console.error("Failed to delete reaction from PDS:", err);
      }
    }
  }

  // Delete board from PDS
  if (board.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: BOARD_COLLECTION,
        rkey: board.rkey,
      });
    } catch (err) {
      console.error("Failed to delete board from PDS:", err);
    }
  }
}

export async function deleteCommentFromPDS(
  agent: Agent,
  did: string,
  comment: Comment,
): Promise<void> {
  if (comment.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: COMMENT_COLLECTION,
        rkey: comment.rkey,
      });
    } catch (err) {
      console.error("Failed to delete comment from PDS:", err);
    }
  }
}

export async function deleteTaskFromPDS(
  agent: Agent,
  did: string,
  task: Task,
): Promise<void> {
  if (task.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: TASK_COLLECTION,
        rkey: task.rkey,
      });
    } catch (err) {
      console.error("Failed to delete task from PDS:", err);
    }
  }
}

export async function deleteTrustFromPDS(
  agent: Agent,
  did: string,
  trust: Trust,
): Promise<void> {
  if (trust.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: TRUST_COLLECTION,
        rkey: trust.rkey,
      });
    } catch (err) {
      console.error("Failed to delete trust from PDS:", err);
    }
  }
}

export async function deleteApprovalFromPDS(
  agent: Agent,
  did: string,
  approval: Approval,
): Promise<void> {
  if (approval.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: APPROVAL_COLLECTION,
        rkey: approval.rkey,
      });
    } catch (err) {
      console.error("Failed to delete approval from PDS:", err);
    }
  }
}

export async function deleteReactionFromPDS(
  agent: Agent,
  did: string,
  reaction: Reaction,
): Promise<void> {
  if (reaction.syncStatus === "synced") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: REACTION_COLLECTION,
        rkey: reaction.rkey,
      });
    } catch (err) {
      console.error("Failed to delete reaction from PDS:", err);
    }
  }
}

async function resetErrorsToPending(did: string): Promise<void> {
  const tables = [
    db.boards,
    db.tasks,
    db.ops,
    db.trusts,
    db.comments,
    db.approvals,
    db.reactions,
    db.placements,
    db.placementOps,
    db.taskOps,
    db.taskTrusts,
    db.projects,
    db.memberships,
    db.assignments,
    db.labels,
    db.projectTrusts,
    db.projectOps,
    db.commentOps,
    db.boardOps,
  ];
  for (const table of tables) {
    const errored = await (table as any)
      .where("syncStatus")
      .equals("error")
      .filter((r: { did: string }) => r.did === did)
      .toArray();
    for (const record of errored) {
      const id = (record as { id?: number }).id;
      if (id) {
        await (table as any).update(id, { syncStatus: "pending" });
      }
    }
  }
}

let onlineHandler: (() => void) | null = null;

export function notifyPendingWrite(): void {
  if (pendingWriteTimer) return;
  pendingWriteTimer = setTimeout(() => {
    pendingWriteTimer = null;
    if (currentAgent && currentDid) {
      syncPendingToPDS(currentAgent, currentDid).catch(console.error);
    }
  }, 300);
}

export function startBackgroundSync(agent: Agent, did: string): void {
  stopBackgroundSync();
  currentAgent = agent;
  currentDid = did;

  syncInterval = setInterval(() => {
    resetErrorsToPending(did).then(() => {
      syncPendingToPDS(agent, did).catch(console.error);
    });
  }, 5_000);
  // Also run immediately
  syncPendingToPDS(agent, did).catch(console.error);

  // When coming back online, reset errors and sync after a brief delay
  // to let the network stabilize (online event can fire before routes are ready)
  onlineHandler = () => {
    setTimeout(() => {
      resetErrorsToPending(did).then(() => {
        syncPendingToPDS(agent, did).catch(console.error);
      });
    }, 1000);
  };
  window.addEventListener("online", onlineHandler);

  // Flush pending records when tab visibility changes (critical for mobile Safari)
  visibilityHandler = () => {
    syncPendingToPDS(agent, did).catch(console.error);
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  // Flush on pagehide (more reliable than beforeunload on iOS Safari)
  pagehideHandler = () => {
    syncPendingToPDS(agent, did).catch(console.error);
  };
  window.addEventListener("pagehide", pagehideHandler);
}

export function stopBackgroundSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (onlineHandler) {
    window.removeEventListener("online", onlineHandler);
    onlineHandler = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  if (pagehideHandler) {
    window.removeEventListener("pagehide", pagehideHandler);
    pagehideHandler = null;
  }
  if (pendingWriteTimer) {
    clearTimeout(pendingWriteTimer);
    pendingWriteTimer = null;
  }
  currentAgent = null;
  currentDid = null;
}

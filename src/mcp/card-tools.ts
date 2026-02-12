import { db } from "../lib/db.js";
import { generateTID, buildAtUri, TASK_COLLECTION } from "../lib/tid.js";
import { createOp } from "../lib/ops.js";
import type { Task, MaterializedTask } from "../lib/types.js";
import type {
  ToolDefinition,
  ListCardsParams,
  AddCardParams,
  UpdateCardParams,
  Agent,
} from "./types.js";

function dispatchCardEvent(
  type: string,
  detail: Record<string, unknown>,
): void {
  window.dispatchEvent(
    new CustomEvent("skyboard-card-change", {
      detail: { type, ...detail },
    }),
  );
}

async function getMaterializedTask(
  boardUri: string,
  taskUri: string,
): Promise<MaterializedTask | null> {
  const rkey = taskUri.split("/").pop();
  const did = taskUri.split("/")[2];

  if (!rkey || !did) return null;

  const task = await db.tasks.where("[did+rkey]").equals([did, rkey]).first();
  if (!task) return null;

  const ops = await db.ops.where("targetTaskUri").equals(taskUri).toArray();

  return {
    rkey: task.rkey,
    did: task.did,
    title: task.title,
    description: task.description,
    columnId: task.columnId,
    boardUri: task.boardUri,
    position: task.position,
    order: task.order,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    sourceTask: task,
    appliedOps: ops.filter((op) => op.did === did || op.did === task.did),
    pendingOps: ops.filter((op) => op.did !== did && op.did !== task.did),
    effectiveTitle: task.title,
    effectiveDescription: task.description,
    effectiveColumnId: task.columnId,
    effectivePosition: task.position ?? "",
    ownerDid: task.did,
    lastModifiedBy: task.did,
    lastModifiedAt: task.updatedAt || task.createdAt,
  };
}

export function createListCardsTool(): ToolDefinition {
  return {
    name: "list-cards",
    description:
      "List cards (tasks) from a skyboard. Filter by board URI or column ID.",
    inputSchema: {
      type: "object",
      properties: {
        boardUri: {
          type: "string",
          description:
            "Optional: Filter by specific board URI (e.g., at://did:plc:xxx/dev.skyboard.board/yyy)",
        },
        columnId: {
          type: "string",
          description:
            "Optional: Filter by specific column ID within the board",
        },
        includeDescription: {
          type: "boolean",
          description: "Include task descriptions in results",
          default: false,
        },
      },
    },
    execute: async (params: Record<string, unknown>) => {
      const {
        boardUri,
        columnId,
        includeDescription = false,
      } = params as unknown as ListCardsParams;

      let tasks: Task[];

      if (boardUri) {
        tasks = await db.tasks.where("boardUri").equals(boardUri).toArray();
      } else {
        tasks = await db.tasks.toArray();
      }

      if (columnId) {
        tasks = tasks.filter((t) => t.columnId === columnId);
      }

      return {
        count: tasks.length,
        cards: tasks.map((task) => ({
          uri: buildAtUri(task.did, TASK_COLLECTION, task.rkey),
          title: task.title,
          ...(includeDescription && task.description
            ? { description: task.description }
            : {}),
          columnId: task.columnId,
          boardUri: task.boardUri,
          ownerDid: task.did,
          createdAt: task.createdAt,
        })),
      };
    },
  };
}

export function createAddCardTool(): ToolDefinition {
  return {
    name: "add-card",
    description:
      "Add a new card (task) to a skyboard. Requires board URI and column ID.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The title of the card/task",
        },
        description: {
          type: "string",
          description: "Optional description for the card",
        },
        boardUri: {
          type: "string",
          description:
            "The board URI to add the card to (e.g., at://did:plc:xxx/dev.skyboard.board/yyy)",
        },
        columnId: {
          type: "string",
          description: "The column ID within the board to add the card to",
        },
      },
      required: ["title", "boardUri", "columnId"],
    },
    execute: async (params: Record<string, unknown>, agent: Agent) => {
      const { title, description, boardUri, columnId } =
        params as unknown as AddCardParams;

      const currentUserDid = (
        window as unknown as { skyboardCurrentDid?: string }
      ).skyboardCurrentDid;
      if (!currentUserDid) {
        throw new Error("User not authenticated. Please sign in to add cards.");
      }

      const rkey = generateTID();
      const now = new Date().toISOString();

      const task: Omit<Task, "id"> = {
        rkey,
        did: currentUserDid,
        title,
        description,
        columnId,
        boardUri,
        order: 0,
        createdAt: now,
        syncStatus: "pending",
      };

      await db.tasks.add(task as Task);

      const taskUri = buildAtUri(currentUserDid, TASK_COLLECTION, rkey);
      dispatchCardEvent("added", { taskUri, boardUri, columnId });

      return {
        success: true,
        card: {
          uri: taskUri,
          title,
          description,
          columnId,
          boardUri,
          ownerDid: currentUserDid,
          createdAt: now,
        },
        message: `Card "${title}" added to board`,
      };
    },
  };
}

export function createUpdateCardTool(): ToolDefinition {
  return {
    name: "update-card",
    description:
      "Update an existing card (task) on a skyboard. Use ops to modify title, description, or move to a different column.",
    inputSchema: {
      type: "object",
      properties: {
        taskUri: {
          type: "string",
          description:
            "The URI of the task to update (e.g., at://did:plc:xxx/dev.skyboard.task/yyy)",
        },
        title: {
          type: "string",
          description: "Optional: New title for the card",
        },
        description: {
          type: "string",
          description: "Optional: New description for the card",
        },
        columnId: {
          type: "string",
          description: "Optional: Move card to a different column ID",
        },
      },
      required: ["taskUri"],
    },
    execute: async (params: Record<string, unknown>, agent: Agent) => {
      const { taskUri, title, description, columnId } =
        params as unknown as UpdateCardParams;

      const currentUserDid = (
        window as unknown as { skyboardCurrentDid?: string }
      ).skyboardCurrentDid;
      if (!currentUserDid) {
        throw new Error(
          "User not authenticated. Please sign in to update cards.",
        );
      }

      const task = await getMaterializedTask("", taskUri);
      if (!task) {
        throw new Error(`Task not found: ${taskUri}`);
      }

      const boardUri = task.sourceTask.boardUri;
      const fields: Record<string, unknown> = {};

      if (title !== undefined) fields.title = title;
      if (description !== undefined) fields.description = description;
      if (columnId !== undefined) {
        fields.columnId = columnId;
        fields.position = null;
      }

      if (Object.keys(fields).length === 0) {
        throw new Error(
          "At least one field (title, description, or columnId) must be provided for update",
        );
      }

      await createOp(currentUserDid, task.sourceTask, boardUri, fields);

      dispatchCardEvent("updated", {
        taskUri,
        boardUri,
        columnId: columnId || task.effectiveColumnId,
      });

      return {
        success: true,
        card: {
          uri: taskUri,
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(columnId !== undefined ? { columnId } : {}),
        },
        message: `Card updated`,
      };
    },
  };
}

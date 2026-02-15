import { z } from "zod";

const MAX_STRING = 50_000;
const MAX_EMOJI = 32;
const MAX_COLUMNS = 100;
const MAX_LABELS = 200;
const MAX_LABEL_IDS = 200;
const MAX_ORDER = 10_000;

const ColumnSchema = z.object({
  id: z.string().max(MAX_STRING),
  name: z.string().max(MAX_STRING),
  order: z.number(),
});

const LabelSchema = z.object({
  id: z.string().max(MAX_STRING),
  name: z.string().max(MAX_STRING),
  color: z.string().max(MAX_STRING),
  description: z.string().max(MAX_STRING).optional(),
});

export const BoardRecordSchema = z.object({
  name: z.string().max(MAX_STRING),
  description: z.string().max(MAX_STRING).optional(),
  columns: z.array(ColumnSchema).max(MAX_COLUMNS),
  labels: z.array(LabelSchema).max(MAX_LABELS).optional(),
  open: z.boolean().optional(),
  createdAt: z.string().max(MAX_STRING),
});

export const TaskRecordSchema = z.object({
  title: z.string().max(MAX_STRING),
  description: z.string().max(MAX_STRING).optional(),
  columnId: z.string().max(MAX_STRING),
  boardUri: z.string().max(MAX_STRING),
  position: z.string().max(MAX_STRING).optional(),
  labelIds: z.array(z.string().max(MAX_STRING)).max(MAX_LABEL_IDS).optional(),
  order: z.number().int().min(0).max(MAX_ORDER).optional(),
  createdAt: z.string().max(MAX_STRING),
  updatedAt: z.string().max(MAX_STRING).optional(),
});

const OpFieldsSchema = z.object({
  title: z.string().max(MAX_STRING).optional(),
  description: z.string().max(MAX_STRING).optional(),
  columnId: z.string().max(MAX_STRING).optional(),
  position: z.string().max(MAX_STRING).optional(),
  labelIds: z.array(z.string().max(MAX_STRING)).max(MAX_LABEL_IDS).optional(),
  order: z.number().int().min(0).max(MAX_ORDER).optional(),
});

export const OpRecordSchema = z.object({
  targetTaskUri: z.string().max(MAX_STRING),
  boardUri: z.string().max(MAX_STRING),
  fields: OpFieldsSchema,
  createdAt: z.string().max(MAX_STRING),
});

export const TrustRecordSchema = z.object({
  trustedDid: z.string().max(MAX_STRING),
  boardUri: z.string().max(MAX_STRING),
  createdAt: z.string().max(MAX_STRING),
});

export const CommentRecordSchema = z.object({
  targetTaskUri: z.string().max(MAX_STRING),
  boardUri: z.string().max(MAX_STRING),
  text: z.string().max(MAX_STRING),
  createdAt: z.string().max(MAX_STRING),
});

export const ApprovalRecordSchema = z.object({
  targetUri: z.string().max(MAX_STRING),
  boardUri: z.string().max(MAX_STRING),
  createdAt: z.string().max(MAX_STRING),
});

export const ReactionRecordSchema = z.object({
  targetTaskUri: z.string().max(MAX_STRING),
  boardUri: z.string().max(MAX_STRING),
  emoji: z.string().max(MAX_EMOJI),
  createdAt: z.string().max(MAX_STRING),
});

export function safeParse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label: string,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(`[validation] Invalid ${label}:`, result.error.issues);
    return null;
  }
  return result.data;
}

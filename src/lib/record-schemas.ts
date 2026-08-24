/**
 * Structural validation for `dev.skyboard.*` records read out of other
 * people's repos.
 *
 * Records now arrive straight from arbitrary PDSes instead of passing through
 * the appview, so the client has to do the shape checking the appview used to
 * do. These shapes mirror `appview/src/shared/schemas.ts` field for field,
 * expressed with a tiny validator instead of zod so nothing new lands in the
 * browser bundle.
 */

import {
  BOARD_COLLECTION,
  TASK_COLLECTION,
  OP_COLLECTION,
  TRUST_COLLECTION,
  COMMENT_COLLECTION,
  APPROVAL_COLLECTION,
  REACTION_COLLECTION,
} from "./tid.js";

const MAX_STRING = 50_000;
const MAX_EMOJI = 32;
const MAX_COLUMNS = 100;
const MAX_LABELS = 200;
const MAX_LABEL_IDS = 200;
const MAX_ORDER = 10_000;

type Shape = Record<string, FieldSpec>;

type FieldSpec =
  | { kind: "string"; optional?: boolean; max: number }
  | { kind: "boolean"; optional?: boolean }
  | { kind: "int"; optional?: boolean; min: number; max: number }
  | { kind: "number"; optional?: boolean }
  | { kind: "stringArray"; optional?: boolean; maxItems: number; max: number }
  | { kind: "objectArray"; optional?: boolean; maxItems: number; shape: Shape }
  | { kind: "object"; optional?: boolean; shape: Shape };

const str = (optional = false, max = MAX_STRING): FieldSpec => ({
  kind: "string",
  optional,
  max,
});

function checkField(spec: FieldSpec, value: unknown): boolean {
  if (value === undefined) return spec.optional === true;

  switch (spec.kind) {
    case "string":
      return typeof value === "string" && value.length <= spec.max;
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "int":
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= spec.min &&
        value <= spec.max
      );
    case "stringArray":
      return (
        Array.isArray(value) &&
        value.length <= spec.maxItems &&
        value.every((v) => typeof v === "string" && v.length <= spec.max)
      );
    case "objectArray":
      return (
        Array.isArray(value) &&
        value.length <= spec.maxItems &&
        value.every((v) => matchesShape(spec.shape, v))
      );
    case "object":
      return matchesShape(spec.shape, value);
  }
}

function matchesShape(shape: Shape, value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const [key, spec] of Object.entries(shape)) {
    if (!checkField(spec, record[key])) return false;
  }
  return true;
}

const ColumnShape: Shape = {
  id: str(),
  name: str(),
  order: { kind: "number" },
};

const LabelShape: Shape = {
  id: str(),
  name: str(),
  color: str(),
  description: str(true),
};

const OpFieldsShape: Shape = {
  title: str(true),
  description: str(true),
  columnId: str(true),
  parentTaskUri: str(true),
  position: str(true),
  labelIds: {
    kind: "stringArray",
    optional: true,
    maxItems: MAX_LABEL_IDS,
    max: MAX_STRING,
  },
  order: { kind: "int", optional: true, min: 0, max: MAX_ORDER },
};

const SHAPES: Record<string, Shape> = {
  [BOARD_COLLECTION]: {
    name: str(),
    description: str(true),
    columns: { kind: "objectArray", maxItems: MAX_COLUMNS, shape: ColumnShape },
    labels: {
      kind: "objectArray",
      optional: true,
      maxItems: MAX_LABELS,
      shape: LabelShape,
    },
    open: { kind: "boolean", optional: true },
    createdAt: str(),
  },
  [TASK_COLLECTION]: {
    title: str(),
    description: str(true),
    columnId: str(),
    boardUri: str(),
    parentTaskUri: str(true),
    position: str(true),
    labelIds: {
      kind: "stringArray",
      optional: true,
      maxItems: MAX_LABEL_IDS,
      max: MAX_STRING,
    },
    order: { kind: "int", optional: true, min: 0, max: MAX_ORDER },
    createdAt: str(),
    updatedAt: str(true),
  },
  [OP_COLLECTION]: {
    targetTaskUri: str(),
    boardUri: str(),
    fields: { kind: "object", shape: OpFieldsShape },
    createdAt: str(),
  },
  [TRUST_COLLECTION]: {
    trustedDid: str(),
    boardUri: str(),
    createdAt: str(),
  },
  [COMMENT_COLLECTION]: {
    targetTaskUri: str(),
    boardUri: str(),
    text: str(),
    createdAt: str(),
    updatedAt: str(true),
  },
  [APPROVAL_COLLECTION]: {
    targetUri: str(),
    boardUri: str(),
    createdAt: str(),
  },
  [REACTION_COLLECTION]: {
    targetTaskUri: str(),
    boardUri: str(),
    emoji: str(false, MAX_EMOJI),
    createdAt: str(),
  },
};

/**
 * Returns the record value if it structurally matches the lexicon for
 * `collection`, otherwise null. Unknown collections are rejected.
 */
export function validateRecord(
  collection: string,
  value: unknown,
): Record<string, unknown> | null {
  const shape = SHAPES[collection];
  if (!shape) return null;
  if (!matchesShape(shape, value)) return null;
  return value as Record<string, unknown>;
}

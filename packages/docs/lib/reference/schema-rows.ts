import { z } from "zod";

/** The subset of JSON Schema that zod emits for the contract's schemas. */
export interface JsonSchema {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

export interface FieldRow {
  /** Unique within a table: the path, with the branch of each union it is
   *  in (`destination<place>.placeId`). */
  key: string;
  /** The field as written in a request or response (`destination.placeId`). */
  path: string;
  depth: number;
  type: string;
  badge?: "required" | "optional";
  description: string;
  meta: string[];
  /** A union's branch: `type` names its discriminator value, and the
   *  branch's fields follow one level deeper. */
  variant?: boolean;
}

type Io = "input" | "output";

export function toJsonSchema(schema: z.ZodType, io: Io = "input"): JsonSchema {
  return z.toJSONSchema(schema, { io, unrepresentable: "any" }) as JsonSchema;
}

/** A schema's alternatives, nested unions flattened, `null` taken out. */
function alternatives(schema: JsonSchema): {
  nullable: boolean;
  options: JsonSchema[];
} {
  const list = schema.anyOf ?? schema.oneOf;
  if (!list) {
    return schema.type === "null"
      ? { nullable: true, options: [] }
      : { nullable: false, options: [schema] };
  }
  let nullable = false;
  const options: JsonSchema[] = [];
  for (const each of list) {
    const inner = alternatives(each);
    nullable ||= inner.nullable;
    options.push(...inner.options);
  }
  return { nullable, options };
}

const isPlainString = (s: JsonSchema) =>
  s.type === "string" &&
  s.enum === undefined &&
  s.const === undefined &&
  s.pattern === undefined;

/** An output enum is open: its values, plus any other string (§6). */
function openEnum(options: JsonSchema[]): unknown[] | null {
  const values = options.flatMap((option) => option.enum ?? []);
  if (values.length === 0) return null;
  const rest = options.filter((option) => !option.enum);
  return rest.length > 0 && rest.every(isPlainString) ? values : null;
}

interface Union {
  key: string;
  branches: Array<{ value: unknown; schema: JsonSchema }>;
  /** A branch for values not known yet (§6 open unions). */
  open: boolean;
}

/** Objects told apart by one constant field (`kind`, `type`, `field`). */
function discriminated(options: JsonSchema[]): Union | null {
  if (options.length < 2 || !options.every((o) => o.type === "object")) {
    return null;
  }
  const keys = Object.keys(options[0]?.properties ?? {}).filter((key) =>
    options.every((option) => option.properties?.[key]),
  );
  for (const key of keys) {
    const known = options.filter(
      (option) => option.properties?.[key]?.const !== undefined,
    );
    if (known.length === 0) continue;
    return {
      key,
      branches: known.map((schema) => ({
        value: schema.properties?.[key]?.const,
        schema,
      })),
      open: known.length < options.length,
    };
  }
  return null;
}

function label(schema: JsonSchema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (schema.anyOf || schema.oneOf) return typeLabel(schema);
  if (schema.type === "array") {
    const item = schema.items ? typeLabel(schema.items) : "unknown";
    return `${item.includes(" | ") ? `(${item})` : item}[]`;
  }
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  return schema.type ?? "any";
}

function typeLabel(schema: JsonSchema): string {
  const { nullable, options } = alternatives(schema);
  const values = openEnum(options);
  const labels = values
    ? [values.map((v) => JSON.stringify(v)).join(" | ")]
    : discriminated(options)
      ? ["object"]
      : [...new Set(options.map(label))];
  return [...labels, ...(nullable ? ["null"] : [])].join(" | ");
}

const SAFE = Number.MAX_SAFE_INTEGER;

function range(min: string | undefined, max: string | undefined): string {
  if (min && max) return `${min}–${max}`;
  if (min) return min.startsWith(">") ? min : `≥ ${min}`;
  return max ? `≤ ${max}` : "";
}

/** What an input field accepts beyond its type. */
function constraints(schema: JsonSchema): string[] {
  const out: string[] = [];
  const max =
    schema.maximum !== undefined && schema.maximum < SAFE
      ? String(schema.maximum)
      : undefined;
  const min =
    schema.minimum !== undefined && schema.minimum > -SAFE
      ? String(schema.minimum)
      : schema.exclusiveMinimum !== undefined
        ? `> ${schema.exclusiveMinimum}`
        : undefined;
  if (min?.startsWith(">") && max) out.push(`${min}, ≤ ${max}`);
  else if (min || max) out.push(range(min, max));

  const len = range(schema.minLength?.toString(), schema.maxLength?.toString());
  if (len) out.push(`${len} chars`);
  const items = range(schema.minItems?.toString(), schema.maxItems?.toString());
  if (items) out.push(`${items} items`);
  if (schema.pattern) out.push(`matches ${schema.pattern}`);
  if (schema.format) out.push(schema.format);
  if (schema.type === "array" && schema.items?.type !== "object") {
    for (const each of constraints(schema.items ?? {}))
      out.push(`each ${each}`);
  }
  if (schema.default !== undefined) {
    out.push(`default ${JSON.stringify(schema.default)}`);
  }
  return out;
}

const OPEN_ENUM = "or any other string: values can be added";
const OPEN_UNION = "other branches can be added";

/** Rows for every field of an object, nested objects, object arrays and
 *  union branches included, in document order. */
function objectRows(
  object: JsonSchema,
  io: Io,
  prefix: { key: string; path: string },
  depth: number,
  skip?: string,
): FieldRow[] {
  return Object.entries(object.properties ?? {}).flatMap(([name, prop]) => {
    if (name === skip) return [];
    const key = `${prefix.key}${name}`;
    const path = `${prefix.path}${name}`;
    const required = object.required?.includes(name) ?? false;
    const { options } = alternatives(prop);
    const meta = io === "input" ? constraints(prop) : [];
    if (io === "output" && openEnum(options)) meta.push(OPEN_ENUM);
    const row: FieldRow = {
      key,
      path,
      depth,
      type: typeLabel(prop),
      badge:
        io === "input"
          ? required
            ? "required"
            : undefined
          : required
            ? undefined
            : "optional",
      description: prop.description ?? "",
      meta,
    };
    return [row, ...childRows(options, io, { key, path }, depth + 1, meta)];
  });
}

/** The rows below a field: an object's fields, an object array's item
 *  fields (`path[].x`), or each branch of a union. */
function childRows(
  options: JsonSchema[],
  io: Io,
  at: { key: string; path: string },
  depth: number,
  meta: string[],
): FieldRow[] {
  if (options.length === 1) {
    const [only] = options;
    if (only?.type === "object") {
      return objectRows(
        only,
        io,
        { key: `${at.key}.`, path: `${at.path}.` },
        depth,
      );
    }
    if (only?.type === "array" && only.items) {
      const items = alternatives(only.items).options;
      const item = { key: `${at.key}[]`, path: `${at.path}[]` };
      const [first] = items;
      if (items.length === 1 && first?.type === "object") {
        return objectRows(
          first,
          io,
          { key: `${item.key}.`, path: `${item.path}.` },
          depth,
        );
      }
      return unionRows(items, io, item, depth, meta);
    }
    return [];
  }
  return unionRows(options, io, at, depth, meta);
}

function unionRows(
  options: JsonSchema[],
  io: Io,
  at: { key: string; path: string },
  depth: number,
  meta: string[],
): FieldRow[] {
  const union = discriminated(options);
  if (!union) return [];
  if (union.open) meta.push(OPEN_UNION);
  return union.branches.flatMap(({ value, schema }) => {
    const key = `${at.key}<${String(value)}>`;
    return [
      {
        key,
        path: at.path,
        depth,
        type: `${union.key}: ${JSON.stringify(value)}`,
        description: schema.properties?.[union.key]?.description ?? "",
        meta: [],
        variant: true,
      },
      ...objectRows(
        schema,
        io,
        { key: `${key}.`, path: `${at.path}.` },
        depth + 1,
        union.key,
      ),
    ];
  });
}

/** Rows for a tool input, straight from its zod schema and the `.describe()`
 *  text of each field. */
export function inputRows(schema: z.ZodType): FieldRow[] {
  return objectRows(
    toJsonSchema(schema, "input"),
    "input",
    { key: "", path: "" },
    0,
  );
}

/** Rows for a response, straight from the contract's output schema. */
export function outputRows(schema: z.ZodType): FieldRow[] {
  return objectRows(
    toJsonSchema(schema, "output"),
    "output",
    { key: "", path: "" },
    0,
  );
}

/** A compact, TypeScript-like shape (`{ orderId: string; reference:
 *  string }`), nested objects named rather than spelled out below `depth`. */
export function shapeOf(schema: JsonSchema, depth = 0): string {
  const { nullable, options } = alternatives(schema);
  const values = openEnum(options);
  const union = discriminated(options);
  const known = union ? union.branches.map((b) => b.schema) : options;
  const shapes = values
    ? [values.map((v) => JSON.stringify(v)).join(" | ")]
    : [...new Set(known.map((option) => shapeOfOne(option, depth)))];
  const joined = shapes.join(depth === 0 && union ? " or " : " | ");
  return nullable ? `${joined} | null` : joined;
}

function shapeOfOne(schema: JsonSchema, depth: number): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (schema.type === "integer") return "number";
  if (schema.type === "array") {
    if (!schema.items) return "unknown[]";
    const item = shapeOf(schema.items, depth + 1);
    const bare = item.startsWith("{")
      ? item.endsWith("}")
      : !item.includes(" ");
    return `${bare ? item : `(${item})`}[]`;
  }
  if (schema.type === "object") {
    if (depth > 0) return flatShape(schema) ?? fieldNames(schema);
    const fields = Object.entries(schema.properties ?? {}).map(
      ([name, prop]) =>
        `${name}${schema.required?.includes(name) ? "" : "?"}: ${shapeOf(prop, depth + 1)}`,
    );
    return fields.length > 0 ? `{ ${fields.join("; ")} }` : "object";
  }
  return Array.isArray(schema.type)
    ? schema.type.join(" | ")
    : (schema.type ?? "unknown");
}

const SCALARS = new Set(["string", "number", "integer", "boolean"]);

/** A nested object of scalars only, by its fields' base types (`{ pointer:
 *  string; message: string }`); `null` for anything deeper. */
function flatShape(schema: JsonSchema): string | null {
  const fields: string[] = [];
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const { nullable, options } = alternatives(prop);
    const types = [
      ...new Set(
        options.map((o) => (o.type === "integer" ? "number" : o.type)),
      ),
    ];
    if (!types.every((t) => typeof t === "string" && SCALARS.has(t))) {
      return null;
    }
    const optional = schema.required?.includes(name) ? "" : "?";
    fields.push(
      `${name}${optional}: ${[...types, ...(nullable ? ["null"] : [])].join(" | ")}`,
    );
  }
  return fields.length > 0 ? `{ ${fields.join("; ")} }` : null;
}

/** An object's field names only: `{ placeId; name; names }`. */
function fieldNames(schema: JsonSchema): string {
  const names = Object.keys(schema.properties ?? {});
  return names.length > 0 ? `{ ${names.join("; ")} }` : "object";
}

/** A nested field's shape on one line: its values or type; an object's
 *  fields, typed when all are scalars, else named; a union of objects as one
 *  object, its discriminator's values and the fields of every branch, typed
 *  when every branch types them alike. */
export function fieldShape(schema: JsonSchema): string {
  const { nullable, options } = alternatives(schema);
  const union = openEnum(options) ? null : discriminated(options);
  let shape: string;
  if (union) {
    const names = [...new Set(union.branches.flatMap((b) => Object.keys(b.schema.properties ?? {})))];
    shape = `{ ${names
      .map((name) => {
        if (name === union.key) return `${name}: ${union.branches.map((b) => JSON.stringify(b.value)).join(" | ")}`;
        const props = union.branches.map((b) => b.schema.properties?.[name]);
        const alike = props.every((p) => p && JSON.stringify(p) === JSON.stringify(props[0]));
        return alike && props[0] ? `${name}: ${shapeOf(props[0], 1)}` : name;
      })
      .join("; ")} }`;
  } else {
    const [only] = options;
    shape =
      options.length === 1 && only?.type === "object"
        ? (flatShape(only) ?? fieldNames(only))
        : shapeOf({ anyOf: options }, 1);
  }
  return nullable ? `${shape} | null` : shape;
}

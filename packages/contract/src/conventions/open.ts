import { z } from "zod";

/*
 * Open output schemas (spec §6, Evolution). Published output schemas allow
 * extra fields, emit enums as "one of these, or any string", and give every
 * union a fallback branch, so a server can add to them within v1. Strict
 * versions exist only for server tests (`strictOutput`).
 */

type Registered =
  | { kind: "enum"; values: readonly string[] }
  | { kind: "union"; branches: readonly z.ZodType[] };

/** What `strictOutput` needs to undo the openness of an enum or union. */
const registry = new WeakMap<object, Registered>();

/** An object that keeps fields it does not know. */
export function openObject<T extends z.ZodRawShape>(shape: T): z.ZodObject<T> {
  return z.looseObject(shape) as unknown as z.ZodObject<T>;
}

/** One of `values`, or any string. JSON Schema: `anyOf [enum, string]`. */
export function openEnum<const V extends readonly string[]>(
  values: V,
): z.ZodType<V[number] | (string & {})> {
  const schema = z.union([
    z.enum(values as unknown as [string, ...string[]]),
    z.string(),
  ]) as unknown as z.ZodType<V[number] | (string & {})>;
  registry.set(schema, { kind: "enum", values });
  return schema;
}

/**
 * A union picked by `discriminator`. A known value parses its own branch
 * (and fails if that branch is malformed); only an unknown value falls back
 * to an object with a string discriminator and any other fields.
 */
export function openUnion(
  discriminator: string,
  branches: readonly z.ZodObject[],
): z.ZodType {
  const known = new Set<unknown>();
  for (const branch of branches) {
    const field = branch.shape[discriminator] as z.ZodType | undefined;
    const values = field?._zod.values;
    if (!values) {
      throw new Error(`openUnion: branch has no literal "${discriminator}"`);
    }
    for (const v of values) known.add(v);
  }
  const fallback = z.looseObject({
    [discriminator]: z
      .string()
      .refine((v) => !known.has(v), { error: "malformed value for a known type" }),
  });
  const schema = z.union([...branches, fallback]);
  registry.set(schema, { kind: "union", branches });
  return schema;
}

/** Parses `value`, keeping the unknown fields and values an open schema allows. */
export function parseOpen<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

/**
 * A deep-strict copy of an output schema for server tests: no unknown fields,
 * no unknown enum values, no fallback union branch. Refinements on objects
 * and arrays themselves are not carried over.
 */
export function strictOutput<T extends z.ZodType>(schema: T): T {
  return strictify(schema) as T;
}

function strictify(schema: z.ZodType): z.ZodType {
  const registered = registry.get(schema);
  if (registered?.kind === "enum") {
    return z.enum(registered.values as unknown as [string, ...string[]]);
  }
  if (registered?.kind === "union") {
    return z.union(
      registered.branches.map(strictify) as unknown as [z.ZodType, z.ZodType],
    );
  }
  const def = schema._zod.def as unknown as Record<string, unknown> & {
    type: string;
  };
  switch (def.type) {
    case "object": {
      const shape = def.shape as Record<string, z.ZodType>;
      return z.strictObject(
        Object.fromEntries(
          Object.entries(shape).map(([k, v]) => [k, strictify(v)]),
        ),
      );
    }
    case "array": {
      let out = z.array(strictify(def.element as z.ZodType));
      for (const check of (def.checks as z.core.$ZodCheck[] | undefined) ?? []) {
        out = out.check(check as z.core.$ZodCheck<unknown[]>);
      }
      return out;
    }
    case "optional":
      return strictify(def.innerType as z.ZodType).optional();
    case "nullable":
      return strictify(def.innerType as z.ZodType).nullable();
    case "union":
      return z.union(
        (def.options as z.ZodType[]).map(strictify) as unknown as [
          z.ZodType,
          z.ZodType,
        ],
      );
    default:
      return schema;
  }
}

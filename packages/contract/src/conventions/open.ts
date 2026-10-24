import { z } from "zod";

/*
 * Open output schemas (spec §6, Evolution). Published output schemas allow
 * extra fields, emit enums as "one of these, or any string", and give every
 * union a fallback branch, so a server can add to them within v1. Strict
 * versions exist only for server tests (`strictOutput`).
 */

/**
 * Marks the def of an open enum or open union. The marker is an own symbol
 * property of the def, so it survives `.describe()`/`.meta()` (which clone the
 * schema around the same def) and any `{ ...def }` copy, unlike a registry
 * keyed by schema identity.
 */
const OPEN = Symbol("fortrip.open");
type OpenMark = "enum" | "union";

function mark(schema: z.ZodType, kind: OpenMark): void {
  (schema._zod.def as unknown as Record<symbol, OpenMark>)[OPEN] = kind;
}

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
  mark(schema, "enum");
  return schema;
}

/**
 * A union picked by `discriminator`. A known value parses its own branch
 * (and fails if that branch is malformed); only an unknown value falls back
 * to an object with a string discriminator and any other fields.
 */
export function openUnion<
  D extends string,
  const B extends readonly z.ZodObject[],
>(discriminator: D, branches: B): z.ZodType<OpenUnionOutput<D, B>> {
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
  mark(schema, "union");
  return schema as unknown as z.ZodType<OpenUnionOutput<D, B>>;
}

/** The value of an open union's fallback branch: an unknown discriminator. */
export type OpenFallback<D extends string> = { [K in D]: string } & Record<
  string,
  unknown
>;

/** What an open union parses to: one of its known branches, or the fallback. */
export type OpenUnionOutput<
  D extends string,
  B extends readonly z.ZodObject[],
> = z.output<B[number]> | OpenFallback<D>;

/**
 * The known branches of an open union's value, which narrow by `D`. A value
 * of this type is one the code has checked (or built) to be known.
 */
export type KnownBranch<T, D extends string> = T extends { [K in D]: infer V }
  ? string extends V
    ? never
    : T
  : never;

/** Parses `value`, keeping the unknown fields and values an open schema allows. */
export function parseOpen<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

/**
 * A deep-strict copy of an output schema for server tests: no unknown fields,
 * no unknown enum values, no fallback union branch. Wrappers (optional,
 * nullable, default, readonly, pipe, lazy) and containers (object, array,
 * tuple, record) are rebuilt around their closed contents, keeping their
 * checks and metadata. A schema type it cannot close (any, unknown,
 * intersection, custom, ...) throws instead of silently staying open.
 */
export function strictOutput<T extends z.ZodType>(schema: T): T {
  return strictify(schema) as T;
}

type Def = Record<string, unknown> & { type: string };

/** The closed schema types that hold no nested schema. */
const LEAVES = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "null",
  "undefined",
  "literal",
  "enum",
  "date",
  "nan",
  "never",
  "template_literal",
  "transform",
]);

/** Wrapper types and the def key holding the one schema inside. */
const WRAPPERS: Record<string, string> = {
  optional: "innerType",
  nullable: "innerType",
  default: "innerType",
  prefault: "innerType",
  nonoptional: "innerType",
  readonly: "innerType",
  array: "element",
};

function strictify(schema: z.ZodType): z.ZodType {
  const def = schema._zod.def as unknown as Def;
  const kind = (def as unknown as Record<symbol, OpenMark | undefined>)[OPEN];
  const rebuild = (changes: Record<string, unknown>) => {
    const next: Record<string | symbol, unknown> = { ...def, ...changes };
    delete next[OPEN]; // the closed copy is not open: a second pass must not cut a branch
    return (schema as unknown as { clone(d: unknown): z.ZodType }).clone(next);
  };

  if (kind === "enum") return strictify((def.options as z.ZodType[])[0]!);
  if (kind === "union") {
    return rebuild({ options: (def.options as z.ZodType[]).slice(0, -1).map(strictify) });
  }

  const inner = WRAPPERS[def.type];
  if (inner) return rebuild({ [inner]: strictify(def[inner] as z.ZodType) });

  switch (def.type) {
    case "object": {
      const shape = def.shape as Record<string, z.ZodType>;
      return rebuild({
        shape: Object.fromEntries(
          Object.entries(shape).map(([k, v]) => [k, strictify(v)]),
        ),
        catchall: z.never(),
      });
    }
    case "union":
      return rebuild({ options: (def.options as z.ZodType[]).map(strictify) });
    case "tuple":
      return rebuild({
        items: (def.items as z.ZodType[]).map(strictify),
        rest: def.rest ? strictify(def.rest as z.ZodType) : def.rest,
      });
    case "record":
      return rebuild({ valueType: strictify(def.valueType as z.ZodType) });
    case "pipe":
      return rebuild({
        in: strictify(def.in as z.ZodType),
        out: strictify(def.out as z.ZodType),
      });
    case "lazy": {
      const getter = def.getter as () => z.ZodType;
      return rebuild({ getter: () => strictify(getter()) });
    }
    default:
      if (LEAVES.has(def.type)) return schema;
      throw new Error(`strictOutput: cannot close a "${def.type}" schema`);
  }
}

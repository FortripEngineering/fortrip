import { z } from "zod";

/*
 * Where a key sent at the wrong depth belongs. A strict input names a key it
 * doesn't know; when the same input has that key higher or lower on the same
 * line (`offerId` beside `items` instead of inside its item), the answer can
 * also say where. Read from the input's own JSON Schema, so it follows the
 * schema.
 */

/** A path into an input, as a zod issue has it: keys, and indexes into lists. */
type Path = (string | number)[];

/** An unknown key and where the input has it. */
export interface MisplacedKey {
  /** Where it was sent: the issue's path, then the key. */
  path: Path;
  /** Each place it belongs at, in the schema's order. A list on the way is
   *  entered at the index the key was sent under, else at its first item. */
  belongsAt: Path[];
}

type JsonSchema = {
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
};

/** A step into any item of a list. */
const ITEM = Symbol("item");

/** The object a key is in: keys, and `ITEM` for the items of a list. */
type Place = (string | typeof ITEM)[];

/** Every key of `node` and of what it holds, with the object it is in. */
function knownKeys(node: JsonSchema, place: Place): { key: string; place: Place }[] {
  return [
    ...Object.entries(node.properties ?? {}).flatMap(([key, child]) => [
      { key, place },
      ...knownKeys(child, [...place, key]),
    ]),
    ...(node.items ? knownKeys(node.items, [...place, ITEM]) : []),
    ...[...(node.oneOf ?? []), ...(node.anyOf ?? [])].flatMap((variant) => knownKeys(variant, place)),
  ];
}

/**
 * For each key a failed parse of `schema` did not know: where `schema` has
 * that key, when it has it above or below the object the key was sent in.
 * `issues` are the parse's issues; only the unknown-key ones are read.
 *
 * Says nothing for a key the schema has nowhere, has only in another branch
 * (a guest's `firstName` sent in `contact` is not a depth), or has at that
 * very place in another variant of a union.
 */
export function misplacedKeys(
  schema: z.ZodType,
  issues: readonly z.core.$ZodIssue[],
): MisplacedKey[] {
  const unknown = issues.filter(
    (issue): issue is z.core.$ZodIssueUnrecognizedKeys => issue.code === "unrecognized_keys",
  );
  if (unknown.length === 0) return [];
  const known = knownKeys(z.toJSONSchema(schema, { io: "input" }) as JsonSchema, []);
  return unknown.flatMap((issue) => {
    const sentIn = issue.path as Path;
    return issue.keys.flatMap((key) => {
      const belongsAt = new Map<string, Path>();
      for (const { place } of known.filter((candidate) => candidate.key === key)) {
        const shared = Math.min(place.length, sentIn.length);
        const onOneLine = place
          .slice(0, shared)
          .every((step, at) => (step === ITEM ? typeof sentIn[at] === "number" : step === sentIn[at]));
        if (!onOneLine || place.length === sentIn.length) continue;
        const path = [...place.map((step, at) => (step === ITEM ? (sentIn[at] ?? 0) : step)), key];
        belongsAt.set(JSON.stringify(path), path);
      }
      return belongsAt.size ? [{ path: [...sentIn, key], belongsAt: [...belongsAt.values()] }] : [];
    });
  });
}

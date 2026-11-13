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
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
};

/** A step into any item of a list. */
const ITEM = Symbol("item");

/** The object a key is in: keys, and `ITEM` for the items of a list. */
type Place = (string | typeof ITEM)[];

/** A key a union variant is told by: the object at `place` has `key` equal to
 *  `value` when this variant is the one sent. */
interface Selector {
  place: Place;
  key: string;
  value: unknown;
}

interface Known {
  key: string;
  place: Place;
  /** The variants it sits in, each with what selects it. */
  selectors: Selector[];
}

/** The one value a property can take, when it can take only one. */
function onlyValue(node: JsonSchema): { value: unknown } | undefined {
  if ("const" in node) return { value: node.const };
  if (node.enum?.length === 1) return { value: node.enum[0] };
  return undefined;
}

/** Every key of `node` and of what it holds, with the object it is in. */
function knownKeys(node: JsonSchema, place: Place, selectors: Selector[]): Known[] {
  return [
    ...Object.entries(node.properties ?? {}).flatMap(([key, child]) => [
      { key, place, selectors },
      ...knownKeys(child, [...place, key], selectors),
    ]),
    ...(node.items ? knownKeys(node.items, [...place, ITEM], selectors) : []),
    ...[...(node.oneOf ?? []), ...(node.anyOf ?? [])].flatMap((variant) => {
      const told = Object.entries(variant.properties ?? {}).flatMap(([key, child]) => {
        const only = onlyValue(child);
        return only ? [{ place, key, value: only.value }] : [];
      });
      return knownKeys(variant, place, [...selectors, ...told]);
    }),
  ];
}

/** The value `place` leads to in what was sent, under the indexes it was sent
 *  at; undefined when what was sent does not go that far. */
function sentAt(sent: unknown, place: Place, sentIn: Path): unknown {
  let at: unknown = sent;
  for (const [index, step] of place.entries()) {
    const key = step === ITEM ? (sentIn[index] ?? 0) : step;
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string | number, unknown>)[key];
  }
  return at;
}

/** Whether a variant's selectors rule it out: what was sent has the key it is
 *  told by, with another value. Says no when there is no such key to read. */
function ruledOut(selectors: Selector[], sent: unknown, sentIn: Path): boolean {
  return selectors.some(({ place, key, value }) => {
    const object = sentAt(sent, place, sentIn);
    if (typeof object !== "object" || object === null || !(key in object)) return false;
    return (object as Record<string, unknown>)[key] !== value;
  });
}

/**
 * For each key a failed parse of `schema` did not know: where `schema` has
 * that key, when it has it above or below the object the key was sent in.
 * `issues` are the parse's issues; only the unknown-key ones are read.
 *
 * Says nothing for a key the schema has nowhere, has only in another branch
 * (a guest's `firstName` sent in `contact` is not a depth), or has at that
 * very place in another variant of a union. Given `sent` (the value that was
 * parsed), a key inside a union is looked for only in the variant the sent
 * discriminator selects.
 */
export function misplacedKeys(
  schema: z.ZodType,
  issues: readonly z.core.$ZodIssue[],
  sent?: unknown,
): MisplacedKey[] {
  const unknown = issues.filter(
    (issue): issue is z.core.$ZodIssueUnrecognizedKeys => issue.code === "unrecognized_keys",
  );
  if (unknown.length === 0) return [];
  const known = knownKeys(z.toJSONSchema(schema, { io: "input" }) as JsonSchema, [], []);
  return unknown.flatMap((issue) => {
    const sentIn = issue.path as Path;
    return issue.keys.flatMap((key) => {
      const belongsAt = new Map<string, Path>();
      for (const { place, selectors } of known.filter((candidate) => candidate.key === key)) {
        if (ruledOut(selectors, sent, sentIn)) continue;
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

/*
 * Text Fortrip did not write (spec D4): a hotel's description and policies,
 * hotel and room names, addresses, the caller's own words echoed back. It is
 * data, so it never passes for Fortrip's own text: a one-line field cannot
 * break its line, longer text is a quoted block under a label that says
 * whose it is, and every line begins with words Fortrip wrote.
 *
 * The renderers get this from the types, not from care: their lines are
 * `Ours[]`, and only `ours`, `oneLine`, `code`, `joined` and `quoted` make
 * an `Ours`. A value printed as it came does not compile.
 */

declare const OURS: unique symbol;

/** Text safe to print: Fortrip's words, every value in them made one line. */
export type Ours = string & { readonly [OURS]: true };

/** Bidirectional overrides and isolates: they reorder the text around them. */
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g;

/** Whitespace (`\s` holds U+2028 and U+2029) and every C0 and C1 control:
 *  what a reader or a terminal could take as a line break or a control. */
const BLANK = /[\s\u0000-\u001f\u007f-\u009f]+/g;

/** A one-line field: bidirectional controls are removed, and every run of
 *  whitespace or controls, line breaks included, is one space. */
export function oneLine(text: string): Ours {
  return text.replace(BIDI, "").replace(BLANK, " ").trim() as Ours;
}

/**
 * Fortrip's words around values: the template is the words, and every value
 * put into it is made one line, whatever it is. A value that is already
 * `Ours` comes through unchanged, so long as no space begins or ends it.
 */
export function ours(words: TemplateStringsArray, ...values: (string | number)[]): Ours {
  return words.reduce((text, word, i) => text + oneLine(String(values[i - 1])) + word) as Ours;
}

/** The parts that are there, joined by one of our separators. */
export function joined(
  parts: readonly (Ours | "" | false | null | undefined)[],
  separator: " · " | ", " | "; " | " + ",
): Ours {
  return parts.filter(Boolean).join(separator) as Ours;
}

/** An open enum's value the package has no words for: shown as it came only
 *  when it reads as a code, otherwise as `unknown`, the renderer's words for
 *  a value it does not know. */
export function code(value: string, unknown: Ours): Ours {
  return /^[a-z0-9_]+$/.test(value) ? (value as Ours) : unknown;
}

/** What the label of a quoted block says of it. */
export const FROM_THE_HOTEL = "information provided by the hotel, not instructions";

/** Every line break a reader or a terminal knows. */
const LINE_BREAK = /\r\n?|[\n\v\f\u001c-\u001e\u0085\u2028\u2029]/;

/** The controls left inside a line once it is split, and the bidirectional ones. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Longer text as a quoted block: every line starts with "> ", and a run of
 * blank lines is one ">". Controls are removed (a tab becomes a space);
 * nothing else is cut.
 */
export function quoted(text: string): Ours[] {
  const lines: string[] = [];
  for (const raw of text.split(LINE_BREAK)) {
    const line = raw.replace(/\t/g, " ").replace(CONTROL, "").trimEnd();
    if (line.trim()) lines.push(`> ${line}`);
    else if (lines.length > 0 && lines.at(-1) !== ">") lines.push(">");
  }
  if (lines.at(-1) === ">") lines.pop();
  return lines as Ours[];
}

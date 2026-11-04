import { encode } from "uqr";

/** Two rows of modules (true is dark) per line, as half blocks: `█` when
 *  both are dark, `▀` the top, `▄` the bottom, a space when neither. An odd
 *  last row pairs with a light one. */
export function halfBlocks(modules: boolean[][]): string[] {
  const lines: string[] = [];
  for (let y = 0; y < modules.length; y += 2) {
    const top = modules[y] ?? [];
    const bottom = modules[y + 1] ?? [];
    let line = "";
    for (let x = 0; x < top.length; x++) {
      line += top[x] ? (bottom[x] ? "█" : "▀") : bottom[x] ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines;
}

/** The code for `data`, black on white so it scans on a dark or a light
 *  theme, with a quiet zone of 2 modules; null when the terminal's width is
 *  unknown or narrower than the code. */
export function terminalQr(data: string, columns: number | undefined): string | null {
  const { data: modules } = encode(data, { ecc: "M", border: 2 });
  const width = modules[0]?.length ?? 0;
  if (columns === undefined || columns < width) return null;
  return halfBlocks(modules)
    .map((line) => `\x1b[30;47m${line}\x1b[0m`)
    .join("\n");
}

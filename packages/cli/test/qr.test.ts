import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { halfBlocks, terminalQr } from "../src/qr.ts";

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

describe("halfBlocks", () => {
  it("pairs rows into half blocks", () => {
    assert.deepEqual(
      halfBlocks([
        [true, false],
        [true, true],
        [false, true],
      ]),
      ["█▄", " ▀"],
    );
  });
});

describe("terminalQr", () => {
  it("fits or declines", () => {
    const code = terminalQr("weixin://wxpay/bizpayurl?pr=abc", 200);
    assert.equal(typeof code, "string");
    const lines = (code as string).split("\n").map(stripAnsi);
    const width = lines[0]?.length ?? 0;
    assert.ok(width > 0);
    for (const line of lines) assert.equal(line.length, width);
    assert.equal(terminalQr("weixin://wxpay/bizpayurl?pr=abc", width - 1), null);
    assert.ok(terminalQr("weixin://wxpay/bizpayurl?pr=abc", width) !== null);
    assert.equal(terminalQr("weixin://wxpay/bizpayurl?pr=abc", undefined), null);
  });
});

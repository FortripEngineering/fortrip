// Saves `count` tokens for distinct API URLs named after `prefix`, one by
// one, as a separate process would: `node --import tsx save-tokens.ts p 3`.
import { saveToken } from "../../src/credentials.ts";

const [prefix = "p", count = "1"] = process.argv.slice(2);
for (let n = 0; n < Number(count); n++) {
  await saveToken(`https://${prefix}-${n}.example`, `fth_${prefix}_${n}`);
}

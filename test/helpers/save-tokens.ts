// Saves `count` tokens for distinct API URLs named after `prefix`, one by
// one, as a separate process would: `node --import tsx save-tokens.ts p 3`.
// A token kept in a recovery file isn't lost: the next write merges it.
import { saveToken } from "../../src/credentials.ts";
import { CliError } from "../../src/errors.ts";

const [prefix = "p", count = "1"] = process.argv.slice(2);
for (let n = 0; n < Number(count); n++) {
  try {
    await saveToken(`https://${prefix}-${n}.example`, `fth_${prefix}_${n}`);
  } catch (error) {
    if (!(error instanceof CliError && error.details.recoveryFile)) throw error;
  }
}

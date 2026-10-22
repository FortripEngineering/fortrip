// Saves `count` sessions for distinct API URLs named after `prefix`, one by
// one, as a separate process would: `node --import tsx save-sessions.ts p 3`.
// A session kept in a recovery file isn't lost: the next write merges it.
import { saveSession } from "../../src/credentials.ts";
import { CliError } from "../../src/errors.ts";

const [prefix = "p", count = "1"] = process.argv.slice(2);
for (let n = 0; n < Number(count); n++) {
  try {
    await saveSession(`https://${prefix}-${n}.example`, {
      accessToken: `access_${prefix}_${n}`,
      refreshToken: `refresh_${prefix}_${n}`,
      expiresAt: Date.now() + 3_600_000,
      clientId: "client_cli",
    });
  } catch (error) {
    if (!(error instanceof CliError && error.details.recoveryFile)) throw error;
  }
}

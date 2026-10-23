{{#if cli}}
## Setup

Run every command as `npx -y fortrip@latest <command>` (Node.js 22 or newer). The examples below shorten that to `fortrip`; `fortrip <command> --help` lists a command's flags. `{{tool:hotels search}}`, `{{tool:hotels offers}}` and `{{tool:hotels book}}` also take `--body '<json>'` (or `--body @file.json`), the raw request body; flags override its fields. Add `--json` to any command to get its answer as one line of JSON instead of text.

When the user first asks about hotels, run `{{tool:whoami}}` before asking follow-up questions, so the sign-in can happen while they answer.

{{/if}}
{{#if claude-skill cli}}
## Sign-in

{{/if}}
Sign-in happens only in the browser. Never ask the user to paste a token.
{{#if claude-skill}}

If none of these tools are available, Fortrip isn't connected: tell the user to add the Fortrip connector or plugin and sign in.
{{/if}}
{{#if mcp claude-skill}}
If a tool says the user isn't signed in, ask them to reconnect Fortrip.
{{/if}}
{{#if cli}}

If a command exits with code **3** and stderr has `loginUrl`, show it to the user as a link together with `userCode`, e.g. "Sign in to Fortrip: <loginUrl> (code <userCode>), then tell me when you're done." When they confirm, rerun the same command; it finishes the sign-in itself. Don't run `{{tool:login}}`: it waits for up to 10 minutes. Commands that exit 3 together share one `loginUrl`; show it once. If the rerun gives a different `loginUrl`, show that one.

When Fortrip no longer accepts the saved sign-in (it was revoked, or it expired and couldn't be renewed), the command also exits 3 with a `loginUrl`; handle it the same way. The saved sign-in is kept until the user approves the new link.

In CI or a sandbox without a browser, the user can set `FORTRIP_TOKEN` instead. Exit 3 with `tokenSource: "FORTRIP_TOKEN"` means Fortrip didn't accept that token: tell the user to replace or unset it.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success; the answer on stdout | Continue |
| 1 | Any other error: an error from Fortrip (see Errors), a network error or a timeout | Read the error on stderr. If `retryable` is true, wait `retryAfterSeconds` (or a few seconds) and retry once |
| 2 | Invalid arguments, or `invalid_request` from Fortrip | Fix the flags; the error lists each bad field with a message |
| 3 | Not signed in | Show `loginUrl` to the user, then rerun (above) |
| 4 | Rate limited | Wait `retryAfterSeconds`, then retry once |

Output on stdout or stderr can carry `warning` (with `recoveryFile` when a sign-in couldn't be saved): pass it on to the user.
{{/if}}

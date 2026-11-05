/** A request as the API reference holds its example: method, full URL with
 *  path and query filled in, and the JSON body, if any. */
export interface CurlRequest {
  method: string;
  url: string;
  body?: unknown;
}

/** Single-quoted for a POSIX shell. */
const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** The request as a curl command, as the examples write one: the token from
 *  `FORTRIP_TOKEN` (double-quoted, so the shell expands it) when the call
 *  needs sign-in, and the body as JSON. */
export function curlCommand(request: CurlRequest, signedIn: boolean): string {
  const lines = [`curl -X ${request.method.toUpperCase()} "${request.url}"`];
  if (signedIn) lines.push(`-H "Authorization: Bearer $FORTRIP_TOKEN"`);
  if (request.body !== undefined) {
    lines.push(`-H "Content-Type: application/json"`, `-d ${quoted(JSON.stringify(request.body, null, 2))}`);
  }
  return lines.join(" \\\n  ");
}

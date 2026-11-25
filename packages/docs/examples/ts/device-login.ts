// Sign in with the OAuth device flow and print the tokens.
// Prints access_token and refresh_token as JSON: export the access token as
// FORTRIP_TOKEN, and keep the refresh token to get a new one.
import process from "node:process";

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function post(url: string, form: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(60_000),
  });
  return { response, json: await response.json().catch(() => null) };
}

const configResponse = await fetch("https://api.fortrip.ai/v1/auth/config", { signal: AbortSignal.timeout(60_000) });
if (!configResponse.ok) {
  console.error(configResponse.status, await configResponse.text());
  process.exit(1);
}
const config = await configResponse.json();

const { response: deviceResponse, json: device } = await post(config.deviceAuthorizationEndpoint, {
  client_id: config.clientId,
  scope: config.scopes,
});
if (!deviceResponse.ok || !device?.device_code) {
  console.error(deviceResponse.status, device);
  process.exit(1);
}
console.error(`Open ${device.verification_uri_complete ?? device.verification_uri} and approve the sign-in.`);

let interval: number = device.interval ?? 5;
const deadline = Date.now() + (device.expires_in ?? 600) * 1000;
while (Date.now() < deadline) {
  await sleep(interval);
  const { json: token } = await post(config.tokenEndpoint, {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: device.device_code,
    client_id: config.clientId,
  });
  if (token && !token.error) {
    console.log(JSON.stringify({ access_token: token.access_token, refresh_token: token.refresh_token }));
    process.exit(0);
  }
  if (token?.error === "slow_down") interval += 5;
  else if (token?.error !== "authorization_pending") {
    console.error(token);
    process.exit(1);
  }
}
console.error("The sign-in expired before it was approved. Run this again.");
process.exit(1);

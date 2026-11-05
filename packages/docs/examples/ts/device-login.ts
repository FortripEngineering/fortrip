// Sign in with the OAuth device flow and print an access token.
// Prints the access token; export it as FORTRIP_TOKEN.
import process from "node:process";

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const configResponse = await fetch("https://api.fortrip.ai/v1/auth/config");
const config = await configResponse.json();

const deviceResponse = await fetch(config.deviceAuthorizationEndpoint, {
  method: "POST",
  body: new URLSearchParams({ client_id: config.clientId, scope: config.scopes }),
});
const device = await deviceResponse.json();
console.error(`Open ${device.verification_uri_complete ?? device.verification_uri} and approve the sign-in.`);

let interval: number = device.interval ?? 5;
while (true) {
  await sleep(interval);
  const tokenResponse = await fetch(config.tokenEndpoint, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.device_code,
      client_id: config.clientId,
    }),
  });
  const token = await tokenResponse.json();
  if (!token.error) {
    console.log(token.access_token);
    break;
  }
  if (token.error === "slow_down") interval += 5;
  else if (token.error !== "authorization_pending") {
    console.error(token);
    process.exit(1);
  }
}

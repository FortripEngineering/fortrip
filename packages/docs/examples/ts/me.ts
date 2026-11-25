// Check an API key: print the account it acts as.
// Needs FORTRIP_TOKEN, a Fortrip API key (ak_…) or access token.
import process from "node:process";

const token = process.env.FORTRIP_TOKEN;
if (!token) throw new Error("Set FORTRIP_TOKEN to a Fortrip API key or access token");

const response = await fetch("https://api.fortrip.ai/v1/me", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${token}`,
  },
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) {
  console.error(response.status, await response.text());
  process.exit(1);
}
const me = await response.json();
console.log(me.userId, me.email);

// Read a price match: its state, and the new offer once it is matched.
// Needs FORTRIP_TOKEN, a Fortrip API key or access token (see step 1 above).
import process from "node:process";

const token = process.env.FORTRIP_TOKEN;
if (!token) throw new Error("Set FORTRIP_TOKEN to a Fortrip API key or access token");

const response = await fetch("https://api.fortrip.ai/v1/price-matches/clm_Hk5vN8cR2xTq6Wm9Lp3Z", {
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
const result = await response.json();
console.log(JSON.stringify(result, null, 2));

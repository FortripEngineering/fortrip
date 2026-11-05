// List your orders, newest first.
// Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
import process from "node:process";

const token = process.env.FORTRIP_TOKEN;
if (!token) throw new Error("Set FORTRIP_TOKEN to a Fortrip access token");

const response = await fetch("https://api.fortrip.ai/v1/orders?limit=10", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
const result = await response.json();
if (!response.ok) {
  console.error(result);
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));

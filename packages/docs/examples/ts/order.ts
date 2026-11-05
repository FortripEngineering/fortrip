// Create an order from an offer. Nothing is charged until it is paid.
// Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
import process from "node:process";

const token = process.env.FORTRIP_TOKEN;
if (!token) throw new Error("Set FORTRIP_TOKEN to a Fortrip access token");

const body = {
  "contact": {
    "firstName": "Ada",
    "lastName": "Lovelace",
    "email": "ada@example.com",
    "phone": "+14155550132"
  },
  "items": [
    {
      "offerId": "off_Bz6yN1cD5fGh8JkM2pQs",
      "hotel": {
        "rooms": [
          {
            "guests": [
              {
                "firstName": "Ada",
                "lastName": "Lovelace"
              },
              {
                "firstName": "Charles",
                "lastName": "Babbage"
              }
            ]
          }
        ]
      }
    }
  ]
};

const response = await fetch("https://api.fortrip.ai/v1/orders", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
const result = await response.json();
if (!response.ok) {
  console.error(result);
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));

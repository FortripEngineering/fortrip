// Get live offers for a hotel.
// Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
import process from "node:process";

const token = process.env.FORTRIP_TOKEN;
if (!token) throw new Error("Set FORTRIP_TOKEN to a Fortrip access token");

const body = {
  "hotelIds": [
    "htl_Qm3xK9vT2pLw7Hn4Rb8Z"
  ],
  "stay": {
    "checkIn": "2027-03-10",
    "checkOut": "2027-03-12",
    "rooms": [
      {
        "adults": 2,
        "childrenAges": []
      }
    ]
  },
  "filters": {
    "requireFreeCancellation": true
  }
};

const response = await fetch("https://api.fortrip.ai/v1/hotels/offers", {
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

# Fortrip for Claude

Search hotels worldwide, compare live offers and cancellation terms, and
get a link to pay for an order on [Fortrip](https://fortrip.ai), all from a
conversation with Claude.

## What's in the plugin

- **The Fortrip connector**, Fortrip's hosted MCP server at
  `https://mcp.fortrip.ai/`. Its tools search hotels, read a hotel's
  details, get live offers for up to 15 hotels at a time, create an order
  with a payment link, and check an order's status or list your orders.
- **The `fortrip` skill**, which tells Claude the order to use the tools in,
  how to read prices, meal plans and cancellation terms, how to plan trips
  with flexible dates, budgets or several stops, and to show you the price
  and terms and wait for your confirmation before giving you a payment link.

## Sign in

You need a Fortrip account. On claude.ai and in Cowork, connect Fortrip from
the plugin's **Connectors** tab (on Team and Enterprise plans, an Owner may
need to add the connector first). In Claude Code, run `/mcp` and sign in to
the Fortrip server the plugin adds. If you also have the Fortrip connector
from claude.ai enabled in Claude Code, Claude Code shows only that connector
and the tools appear under its name; sign in there instead. Either way you
sign in to Fortrip in your browser (OAuth). You never paste a password or
token into the chat.

## How booking works

1. Claude searches hotels. Search prices are indicative minimums; live prices
   come from checking offers.
2. Offers are priced in USD, which is what you're charged. Claude can add an
   approximate amount in CNY, which is an estimate, not the charge.
3. When you pick an offer and give the guest names and a contact name, email
   and phone, Claude creates an unpaid order and shows you the stay, the
   amount and currency you'll be charged (USD), the meals, cancellation
   rules, confirmation time and any fees payable at the hotel.
4. After you confirm, Claude gives you a payment link. It opens a Fortrip page
   that recaps the order and continues to Stripe Checkout, which may also
   show the amount in your local currency. Nothing is charged until you pay
   there. The link is for you only and expires after about 3 hours 45
   minutes.

Stays are 1 to 15 nights, with 1 to 8 rooms per order and the same number of
adults and children in each room. After you pay, Claude can check the order's
status, including whether the hotel has confirmed it. Flights, activities, and
changes to or cancellations of existing orders aren't supported.

## Example prompts

- "Find 4-star hotels in central Tokyo for 2 adults, 3 nights starting two
  weeks from today, with prices in USD."
- "Compare live offers with free cancellation at three hotels near the Bund in
  Shanghai for 2 adults, 2 nights starting a month from today."
- "I need 2 rooms for 4 adults in Bangkok for 2 nights starting 30 days from
  today, breakfast included, under 150 USD per room per night. Find the
  best options."
- "Book the cheapest free-cancellation room at Anantara Riverside Bangkok
  Resort for 1 adult, 2 nights starting 60 days from today. Guest: John
  Smith, phone +1 415 555 0100."

## Your data

- **Searches and offer checks** go to Fortrip: the destination or hotel,
  dates, number of rooms, adults and children's ages per room, and filters
  such as star rating, price limit, amenities, breakfast and free
  cancellation.
- **Orders** go to Fortrip, which passes them to its hotel supplier and the
  hotel to make the reservation: the stay you chose, guest names, the contact
  name, phone and email, and any special requests.
- **Payment** happens on Stripe's checkout page. Claude never sees your card
  details; don't paste them into the chat.

The plugin connects only to Fortrip and stores nothing itself. Fortrip
handles your data as described in its [privacy policy](https://fortrip.ai/privacy);
bookings are subject to its [terms](https://fortrip.ai/terms).

## Troubleshooting

- **Fortrip tools missing or sign-in errors:** reconnect Fortrip from the
  plugin's Connectors tab (in Claude Code, from `/mcp`, under the plugin's
  server or your Fortrip connector) and sign in again. If Fortrip briefly
  can't check your sign-in, try again in a few seconds.
- **Price or terms changed:** the offer changed after Claude checked it.
  Claude shows you every change and asks you to confirm the new price and
  terms.
- **Offer expired or unavailable:** offers last about 30 minutes, and a room
  can sell out. Claude gets offers again so you can pick another.
- **Supplier unavailable:** the hotel supplier didn't respond. Claude retries
  once; if it still fails, try again in a few minutes.
- **Too many requests:** Claude waits the time Fortrip asks for, then retries.
- **Changing or cancelling an order:** email info@fortrip.ai with the order's
  reference.

## Support

Email [info@fortrip.ai](mailto:info@fortrip.ai) or see the
[FAQ](https://fortrip.ai/faq).

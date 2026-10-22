# Fortrip for Claude

Search hotels worldwide, compare live room rates and cancellation terms, and
get a link to book and pay for a room on [Fortrip](https://fortrip.ai), all
from a conversation with Claude.

## What's in the plugin

- **The Fortrip connector**, Fortrip's hosted MCP server at
  `https://fortrip.ai/api/mcp`. Its tools search hotels, read a hotel's
  details, get live rates for up to 15 hotels at a time, and create a booking
  with a payment link.
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
   come from a rate check.
2. Prices are shown in CNY or USD. Converted prices use Stripe's exchange
   rate (or a fixed fallback rate), so they're a reference, not the charge.
3. When you pick a room and give the guest names and a contact phone, Claude
   creates an unpaid booking and shows you the stay, the amount and currency
   you'll be charged (currently USD), the meal plan, cancellation rules,
   confirmation time and any fees payable at the hotel.
4. After you confirm, Claude gives you a payment link. It opens a Fortrip page
   that recaps the booking and continues to Stripe Checkout, which may also
   show the amount in your local currency. Nothing is charged until you pay
   there. The link is for you only and expires after about 3 hours 45
   minutes.

Stays are 1 to 15 nights, with up to 8 rooms per booking and the same number
of adults and children in each room. Flights, activities, and changes to or
cancellations of existing bookings aren't supported.

## Example prompts

- "Find 4-star hotels in central Tokyo for 2 adults, 3 nights starting two
  weeks from today, with prices in USD."
- "Compare live rates with free cancellation at three hotels near the Bund in
  Shanghai for 2 adults, 2 nights starting a month from today."
- "I need 2 rooms for 4 adults in Bangkok for 2 nights starting 30 days from
  today, breakfast included, under 1,000 CNY per room per night. Find the
  best options."
- "Book the cheapest free-cancellation room at Anantara Riverside Bangkok
  Resort for 1 adult, 2 nights starting 60 days from today. Guest: John
  Smith, phone +1 415 555 0100."

## Your data

- **Searches and rate checks** go to fortrip.ai: the destination or hotel,
  dates, number of rooms, adults and children's ages per room, your
  nationality if you give it (used only for rates), and filters such as star
  rating, price range, facilities, meal plan and free cancellation.
- **Bookings** go to fortrip.ai, which passes them to its hotel supplier and
  the hotel to make the reservation: the stay you chose, guest names, the
  contact name, phone and email, and any special requests.
- **Payment** happens on Stripe's checkout page. Claude never sees your card
  details; don't paste them into the chat.

The plugin connects only to fortrip.ai and stores nothing itself. Fortrip
handles your data as described in its [privacy policy](https://fortrip.ai/privacy);
bookings are subject to its [terms](https://fortrip.ai/terms).

## Troubleshooting

- **Fortrip tools missing or sign-in errors:** reconnect Fortrip from the
  plugin's Connectors tab (in Claude Code, from `/mcp`, under the plugin's
  server or your Fortrip connector) and sign in again. If Fortrip briefly
  can't check your sign-in, try again in a few seconds.
- **Price or terms changed:** the rate changed after Claude checked it. Claude
  checks rates again and asks you to confirm the new price and terms.
- **Rate unavailable:** the room is no longer bookable. Claude checks rates
  again so you can pick another.
- **Supplier unavailable:** the hotel supplier didn't respond. Claude retries
  once; if it still fails, try again in a few minutes.
- **Too many requests:** Claude waits the time Fortrip asks for, then retries.
- **Changing or cancelling a booking:** email info@fortrip.ai with your order
  link.

## Support

Email [info@fortrip.ai](mailto:info@fortrip.ai) or see the
[FAQ](https://fortrip.ai/faq).

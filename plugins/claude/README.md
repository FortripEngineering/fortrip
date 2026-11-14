# Fortrip for Claude

Search hotels worldwide, compare live rates and cancellation terms, book
and pay securely, and cancel bookings on [Fortrip](https://fortrip.ai), all
from a conversation with Claude.

## What's in the plugin

- **The Fortrip connector**, Fortrip's hosted MCP server at
  `https://mcp.fortrip.ai/`. Its tools search hotels, read a hotel's
  details, get live offers for up to 15 hotels at a time, create an order
  with a payment link, pay an order, check an order's status or list your
  orders, cancel an order under its cancellation terms, and close an unpaid
  order you no longer want. Each tool answers Claude in text.
- **The `fortrip` skill**, which tells Claude the order to use the tools in,
  how to read prices, meal plans and cancellation terms, how to plan trips
  with flexible dates, budgets or several stops, and to show you the price,
  terms, guests and contact details and wait for your confirmation before
  giving you a payment link or cancelling an order.

## Install

In Claude Code, run:

```
/plugin marketplace add FortripEngineering/fortrip
/plugin install fortrip@fortrip
```

Then start a new session and sign in as described below.

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

1. Claude searches hotels. Search prices are indicative estimates; live prices
   come from checking offers.
2. Offers are priced in the currency you ask for, USD or CNY where
   available, and that is the currency you're charged.
3. When you pick an offer and give the guest names and a contact name, email
   and phone, Claude creates an unpaid order and shows you the stay, the
   guest names, contact details and any special requests as the order holds
   them, the amount and currency you'll be charged, the meals, cancellation
   rules, confirmation time and any fees payable at the hotel.
4. After you confirm, Claude gives you a payment link. It opens a Fortrip page
   that recaps the order and shows the ways to pay: for a USD order a card,
   Alipay or WeChat Pay, and Stripe Checkout may also show the amount in your
   local currency. Nothing is charged until you pay there. The link is for
   you only and expires after a few hours; the order shows when.

Stays are 1 to 15 nights, with 1 to 8 rooms per order and the same number of
adults and children in each room. After you pay, Claude can check the order's
status, including whether the hotel has confirmed it. If a booking fails,
no stay is booked, your payment is released or refunded in full, and Claude
tells you why.

## Cancelling an order

Claude can cancel a confirmed order under its cancellation terms. It first
shows you the stay, the penalty those terms charge now and the refund (what
you paid less the penalty), and waits for you to confirm. You're charged no
more than the penalty you agreed to: if it has gone up since, nothing is
cancelled and Claude asks you again. The order shows as cancelling until the
hotel has cancelled it and the refund is issued. Once the stay has started,
or when the terms don't allow a cancellation here, email info@fortrip.ai with
the order's reference. A cancelled order shows what the cancellation kept
and what it refunded.

An order you haven't paid needs no cancelling: it expires unpaid, with nothing
charged. If you tell Claude you no longer want it, Claude can close it right
away.

Flights, activities and changes to existing orders aren't supported.

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
  Smith, email john.smith@example.com, phone +1 415 555 0100."

## Your data

- **Searches and offer checks** go to Fortrip: the destination or hotel,
  dates, number of rooms, adults and children's ages per room, and filters
  such as star rating, price limit, amenities, breakfast and free
  cancellation.
- **Orders** go to Fortrip, which passes them to its hotel supplier and the
  hotel to make the reservation: the stay you chose, guest names, the contact
  name, phone and email, and any special requests.
- **Payment** goes to a payment provider: Stripe for a USD price, a provider
  in mainland China for a CNY price; the payment page shows the ways to pay.
  You pay on the page the payment link opens; Claude never opens or chooses a
  payment for you. Paying without the link needs a one-time token you approve
  in your Link wallet, which only works for US and Canadian Link accounts and
  a USD order of up to $500, and only where Claude has a tool that can
  request one.
  Claude never sees your card details; don't paste them into the chat.

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
- **Booking failed after payment:** no stay was booked and the payment is
  released or refunded in full. Claude tells you whether the rate was no
  longer available or the hotel's booking system refused the order. A hotel's
  system can refuse some guest names: if the names are as on the passports,
  don't change them, and email info@fortrip.ai with the order's reference.
- **Supplier unavailable:** the hotel supplier didn't respond. Claude retries
  once; if it still fails, try again in a few minutes.
- **Too many requests:** Claude waits the time Fortrip asks for, then retries.
- **Changing an order, or a cancellation Claude can't make:** email
  info@fortrip.ai with the order's reference.

## Support

Email [info@fortrip.ai](mailto:info@fortrip.ai) or see the
[FAQ](https://fortrip.ai/faq).

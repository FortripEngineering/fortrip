---
name: fortrip-cli
description: Searches hotels, compares live room rates and creates a hotel booking with a payment link through the Fortrip command-line tool (npx fortrip). Use when the user wants to find, compare, price or book a hotel stay through Fortrip, you can run shell commands, and Fortrip's MCP tools (search_hotels, get_rates, create_booking) aren't available. Not for flights, activities or changing an existing booking.
---

# Fortrip CLI

Before anything else, run:

```bash
npx -y fortrip@latest skill
```

It prints the current instructions for the Fortrip CLI: commands, call order,
sign-in, and what to show the user before giving a payment link. Follow them.
They ship with each CLI release, so this file stays short and doesn't go out
of date.

The guide names the CLI version that printed it. For the rest of the
conversation, run every command with that version (`npx -y fortrip@<version>
<command>`) instead of `@latest`, so the commands always match the guide.

Needs Node.js 22 or newer. If a command fails, tell the user why instead of
guessing the CLI's flags.

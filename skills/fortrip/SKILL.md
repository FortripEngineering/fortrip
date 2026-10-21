---
name: fortrip
description: Search hotels, compare live room rates and create a hotel booking with a payment link through Fortrip. Use when the user wants to find, compare, price or book a hotel stay, including flexible dates, budgets, split stays or several destinations, or asks for a hotel payment link.
---

# Fortrip

Before anything else, run:

```bash
npx -y fortrip@latest skill
```

It prints the current instructions for the Fortrip CLI: commands, call order,
login, and what to show the user before giving a payment link. Follow them.
They ship with each CLI release, so this file stays short and doesn't go out
of date.

Needs Node.js 22 or newer. If the command fails, tell the user why instead of
guessing the CLI's flags.

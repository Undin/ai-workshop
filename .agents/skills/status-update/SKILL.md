---
name: status-update
description: "Post a status update of the repository to Slack: what happened since a date and time the user gives — the issues closed since (each with the pull requests that closed it), the issues in progress (open, with an open pull request linked), and every other pull request created or merged since, not tied to an issue in the list — as one message to the channel SLACK_CHANNEL (its ID) as the bot of SLACK_BOT_TOKEN. `--dry-run` shows the message without posting it. Use when the user asks for a status update, a summary or report of the work since a date, or to tell Slack what happened in the repository."
---

Takes `<since>`, **required**: when the update starts, a date and time in any words (`2026-10-14`,
`yesterday 9:00`, `last Monday`, `since the release`); optionally `--repo <owner/name>` (the
repository of the checkout otherwise) and `--dry-run`. It posts unattended: no confirmation.

## Process

### 1. The start

Turn `<since>` into what the script takes: `YYYY-MM-DD` (its midnight, local time) or
`YYYY-MM-DDTHH:MM[:SS]` with its offset (`Z`, `+02:00`; local time without one). Today is the date
of the session; a relative day (`yesterday`, `last Monday`) counts from it. With no `<since>`, or
one that names no time (`since the release` with no release found), ask the user; don't guess a
window. A date in the future is an error.

### 2. Run it

```bash
set -a; . ./.env; set +a     # if there is a .env: SLACK_BOT_TOKEN, SLACK_CHANNEL
node .agents/skills/status-update/scripts/status-update.ts --since <date> [--repo <owner/name>] [--dry-run]
```

[scripts/status-update.ts](scripts/status-update.ts) asks GitHub through `gh` (logged in, or
`GH_TOKEN`), prints the message, posts it to `SLACK_CHANNEL` (the channel's ID, `C…`, not its name),
and prints `Posted: <its link>`. An update longer than one Slack message goes on in its thread. Exit
1 with the reason on stderr: a wrong argument, `gh` failing, Slack refusing (`not_in_channel`: the
bot must be invited to the channel). Without `--dry-run`, it checks `SLACK_BOT_TOKEN` and
`SLACK_CHANNEL` before asking GitHub.

What the message says, in Slack's markdown, each item a link with its number and title:

- **Closed issues**: closed since the start, `(not planned)` or `(duplicate)` when so, each with the
  pull requests that closed it (`by @<author>, merged`), or `no pull request`.
- **In progress**: open issues with an open pull request linked, now, whenever the work started;
  the open pull requests only.
- **Other pull requests**: created or merged since the start (`open`, `draft`, `merged`, `closed`),
  not already under an issue above: each pull request of the window is in the update once.

A section with nothing says `_None_`. The message is the script's alone: don't rewrite it or post
another one.

### 3. Report

The link to the posted message (`Posted:`), and the count in each section; with `--dry-run`, the
message itself. On an error, what failed and what would fix it (a token, the bot's invitation, the
channel's ID); nothing is posted again by hand.

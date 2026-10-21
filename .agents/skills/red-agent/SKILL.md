---
name: red-agent
description: "Hunt for bugs in the web view as a user would: write N user scenarios (5 by default) with the result each one should have by spec/web.md, play each on the real `./skill-atlas serve` in a browser (Playwright, real repositories on GitHub), check what it shows against the expected result, and file a GitHub issue labelled `bug` for each scenario that doesn't work, with the scenario as the steps to reproduce. Pass a number for the count of scenarios, and optionally a focus (e.g. `red-agent 8 organization page`); `--dry-run` reports the bugs without filing them. Use when the user asks to test the app like a user, look for bugs, run the red agent, or do exploratory testing of the web view."
---

Plays the web view the way a user would, judges it **by the spec**, not by what the code does,
and files what doesn't work. Arguments, all optional:

- `<n>`: the count of scenarios, 5 by default
- a focus: a part of the web view to hunt in (`filter`, `organization page`, `copies`); none → all
  of [spec/web.md](../../../spec/web.md)
- `--dry-run`: everything but filing; the bugs are reported, no issue is created

It runs unattended: the issues are filed without asking. It never changes the app's code, the spec
or the tests: it only reports.

## Process

### 1. Learn what the web view should do

- Read [spec/web.md](../../../spec/web.md), and what it refers to in
  [spec/analysis.md](../../../spec/analysis.md) and [spec/cli.md](../../../spec/cli.md): this is
  the **only** source of expected results.
- `gh issue list --state all --label bug --limit 100`: the bugs already known; a scenario that only
  finds one of them again is wasted.
- Don't read `src/web/` to write scenarios: expectations taken from the code find no bugs.

### 2. Write the scenarios

`<n>` scenarios, each one **before** anything is run, into `.red-agent/scenarios.md` (gitignored):

```markdown
## 1. <title: what the user does>
Spec: <the section and the case of spec/web.md it checks>
Repository: <the GitHub URL or directory it uses>
Steps:
1. Open the page
2. Type `https://github.com/<owner>/<repo>` into the field, press Enter
3. …
Expected:
- <what the page shows, as spec/web.md says it, word for word where the spec gives the text>
```

What makes a scenario worth playing:

- **A user's goal**, several steps long, not one assertion: scan, filter, choose a skill, go back,
  reload, share the link. Bugs live between features.
- **Different parts** of the spec across the scenarios, unless a focus is given; at least one
  edge: an empty or odd input, a repository with copies, no skills, an unreachable repository,
  an organization, a Stop, Back and Forward, a reload, a filter with spaces or capitals, Markdown
  that tries to run a script.
- **A real repository** that has what the scenario needs: look at it first with the CLI,
  `./skill-atlas scan <url> 2>/dev/null | grep -v '^  '` (`set -a; . ./.env; set +a` if there is a
  `.env`, for `GITHUB_TOKEN`). A local directory is fine too, made for the scenario under
  `/tmp/red-agent/repos/<name>/`, for what no real repository has (a script in a SKILL.md): outside
  the checkout, whose own scan (tests/scan.test.ts) would count its skills.
- **Expected results that can be checked**: the texts the spec gives (`Showing 2 of 10 skills`,
  `No skills match <text>`), counts read from the page rather than fixed lists of a real
  repository, which changes.
- A case the spec doesn't say: no expected result to invent; leave it out, or note it as a
  question for the report (step 5), never a bug.

### 3. Play them

One Playwright script per scenario, `.red-agent/<nn>-<slug>.red.ts`, from `@playwright/test`: its
steps, as a user does them (click, type, press keys; `page.goBack()`, `page.reload()`), then its
expected results as `expect.soft` assertions, so one run tells every difference, and a screenshot
of each result, `.red-agent/out/<nn>-<slug>/<mm>-<what>.png`. Run them all:

```bash
set -a; . ./.env; set +a     # if there is a .env: GITHUB_TOKEN, in the same shell as the run
npx playwright test -c .agents/skills/red-agent/scripts/playwright.config.ts
# one: … -c .agents/skills/red-agent/scripts/playwright.config.ts 03-
```

The config starts the real `./skill-atlas serve` on port 3102; it scans GitHub with the
`GITHUB_TOKEN` of the shell that runs it, so each run needs the token there: without it, GitHub's
low rate limit stops the scans.

### 4. Judge each result

For each scenario, a verdict:

- **Pass**: every expected result is shown.
- **Bug**: the page differs from what the spec says, or is broken whatever the spec says (an
  error in the console, a blank page, a hang, a crash of the server).
- **Not a bug**: the difference comes from the scenario, not the app. A failing assertion is a
  claim to check, not a verdict yet: look at the screenshot and the trace
  (`npx playwright show-trace .red-agent/test-results/<…>/trace.zip`), and rule out
  - a wrong selector or a wait too short in the script: fix the script, run it again;
  - an expectation the spec doesn't make: read the spec again;
  - the network or GitHub (a rate limit, a timeout): run it again;
  - a repository that changed, or doesn't have what was assumed.

A bug must happen **again** on a second run before it is filed. The smallest steps that still show
it are the steps of its issue: cut the ones it doesn't need.

### 5. File the bugs

For each bug, unless `--dry-run`:

- **Already filed?** `gh issue list --state all --search "<the key words of what is wrong>"`:
  an open issue on the same bug → a comment on it with the new scenario if it adds something,
  nothing else; a closed one → a new issue that refers to it (`Seems to be back: #<n>`).
- Otherwise, a new one:

```bash
gh issue create --label bug --title "<what is wrong, where: Web view: …>" --body-file .red-agent/issue-<nn>.md
```

with the body:

```markdown
<one sentence: what doesn't work>

## Steps to reproduce
1. `./skill-atlas serve`, open http://127.0.0.1:3000/
2. …

## Expected
<what spec/web.md says, quoted, and its section: [spec/web.md, Page](https://github.com/<owner>/<repo>/blob/main/spec/web.md#page), the repository from `gh repo view --json url`>

## Actual
<what the page shows: the texts, the console errors>

## Environment
The commit (`git rev-parse --short HEAD`), Chromium (Playwright), the repository it used.

Found by the red agent.
```

No screenshot in the issue (`gh` can't attach one): the actual texts say it.

### 6. Report

A table, one row per scenario: its title, its spec section, its verdict, its issue (a link) or
why it is not a bug. Then the questions the spec left open (step 2), if any. The scenarios and
their scripts stay in `.red-agent/`, never committed.

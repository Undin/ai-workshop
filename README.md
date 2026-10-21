# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

A GitHub organization (or a user): each of its public repositories, one by one, with its number
of skills.

```console
$ ./skill-atlas scan https://github.com/Undin
Undin · 69 repositories
Undin/2021.3-tests-plugin · 0 skills
Undin/ai-workshop · 2 skills
…
```

Or in a local web view: a field for a repository link, its skills (with a filter) and their SKILL.md,
with when each was last updated;
for an organization, its repositories as they are scanned, each a link to its page from that scan,
which goes on meanwhile (or stops, with Stop).
Once a scan is over, *Group skills* puts its skills (a repository's, or an organization's) in
groups of what they help with: Testing, Releases & changelogs, Build & CI/CD… (a fixed list,
by keywords of their names and descriptions, [spec/analysis.md](spec/analysis.md)).

```console
$ ./skill-atlas serve
Skill Atlas: http://127.0.0.1:3000/
```

Set `GITHUB_TOKEN` for a higher GitHub rate limit: without it, GitHub answers for about 30
repositories of an organization an hour, fewer in the web view, which asks for each skill's last
update too. GitHub's answers are kept in `.skill-atlas-cache/` in the current directory, an hour
(30 days for what is pinned to a commit), so a scan again is faster; `--no-cache` (for `scan` and
`serve`) asks GitHub for everything, and deleting the directory clears it. `npm test` runs the
tests; the web view's run in Chromium, after `npx playwright install chromium`.

`npm run e2e` scans the repositories in [e2e/repos.json](e2e/repos.json), each pinned to a commit,
and compares the output with [e2e/expected/](e2e/expected/); `UPDATE_EXPECTED=1 npm run e2e`
rewrites it after adding a repository or moving a pin.

`npm run demo [-- <name>]` records a feature of the web view, [demos/](demos/)`<name>/<name>.demo.ts`,
with a visible pointer, into `demos/out/<name>.webm`, and the screenshots of its key points into
`demos/out/<name>/`, to look at. GitHub answers from the demo's recording,
`demos/<name>/cache/`: no network, no token, the same every time; a request not recorded fails the
demo. `npm run demo:record [-- <name>]` records those answers anew from real repositories, with
`GITHUB_TOKEN`; `demos/<name>/recording.json` can cut an organization to a few of its repositories
and replay each answer later, a scan that takes time (`demos/recording.ts`). The Demos workflow runs
them all on every pull request; its screenshots are the ones committed, `demos/<name>/screenshots/`,
shown in [demos/README.md](demos/README.md): `npm run demo:screenshots` takes them from its green
run on the last commit pushed. Waits where nothing happens play faster, `×8` in the corner
meanwhile (`faster()` in [demos/demo.ts](demos/demo.ts), with `ffmpeg`).

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.

# Web view
`./skill-atlas serve [--port <port>] [--no-cache]`: a local web view on `http://127.0.0.1:3000`, the same
scan as the [command line](cli.md). Only on this machine (`127.0.0.1`): it reads local directories.
Only for `localhost` and `127.0.0.1` at its port in the `Host` header (no port: 80), else 403:
another site's page cannot reach it through a name of its own resolved to `127.0.0.1` (DNS rebinding).
`<port>`: digits, 0 to 65535, 0 for any free one; else a clear message, exit code 1.
`--port <port>` and `--no-cache` in any order, each once; other arguments: the usage, exit code 1.
Each scan is a fresh one, but for the repositories of an organization being scanned (Organization
page) and between a repository's skills and their groups (Groups); going back to no repository stops waiting for a running one, and its result is not shown.
GitHub's answers come from the same [cache](cli.md#cache) as for `scan`, in the directory `serve`
was started in, `--no-cache` the same way; *nothing else is stored*. `GITHUB_TOKEN` works as for `scan`.
## Page
- A **field** for a repository link (a GitHub URL, or a directory) and a *Scan* button; Enter scans too
- The address keeps it, `?source=<link>`: a reload or a shared link scans it again
- The repository, `JetBrains/kotlin · 6 skills`, and its **skills**, sorted by **name**: the name,
  the description's *first sentence* in at most *two lines* (cut with `…`, whole on hover);
  a thin **divider** between two skills
- A skill's copies ([analysis.md](analysis.md), Skill): a muted **badge** after its name, `+1 copy`,
  `+2 copies`; their paths on hover, `also in <paths>`; no copies, no badge
- A **filter** field above the skills, when there are any: it keeps the skills whose *name* or
  *first sentence* contains its text, in any case, spaces around it aside; at once as it is typed,
  no new scan; each match of it is **marked** there, in the name and the first sentence
- Under it, the count: `Showing 2 of 10 skills`; nothing kept → `No skills match <text>`
- The filter does not change the chosen skill; a new scan empties it; the address does not keep it
- A chosen skill's **SKILL.md**: the front matter as a table, the body as *Markdown*, and its link
  on GitHub at the *scanned commit*; in a directory, the file's path as text (a web page cannot
  open a `file://` link); `also in <paths>` for its copies; the first skill is chosen at first
- In its **top right corner**, when it was last updated ([analysis.md](analysis.md), Last update),
  from the scan: `Updated 2026-10-14`, the date in UTC, the time on hover, `2026-10-14 12:53 UTC`;
  it cannot be known → `Last update unknown`, why on hover
- The SKILL.md is *untrusted*: rendered HTML is sanitized, scripts never run, remote images
  are not loaded (they would tell their server who opened it)
- No warnings: they can be many and hide the skills; the CLI prints them
- No skills → `No skills found`; an empty field → `Enter a GitHub repository URL or a directory`;
  an unreachable repository or not a GitHub URL → the same clear message as the CLI
## Organization page
- An organization URL (`https://github.com/<owner>`, [analysis.md](analysis.md), Organization) → its
  own page instead: `JetBrains · 4 repositories`, then each **repository** as the CLI lists it,
  in its order, all at once: its skill count once it is scanned, `…` until then, or `not scanned: <why>`
- While it runs: `Scanning JetBrains: 1 of 4 repositories…` and a **Stop** button; when done, nothing;
  no repositories → `No repositories found`
- Stop: the scan stops, the repositories left `not scanned`, `Stopped after 1 of 4 repositories`
- A scanned repository is a **link** to its page, `?source=https://github.com/<owner>/<repo>`: the
  page of one repository above, from the organization's scan, *no new scan*; not scanned (yet): no link
- The organization's scan **goes on** there, and its page shows it: `Scanning JetBrains: 1 of 4
  repositories…`, `JetBrains` a link back to the organization's page, and Stop
- Back to the organization's page, or to another of its scanned repositories: what the scan has, as
  it goes on; no new scan
- The scan is kept *in the page* only, while it is open: a reload, a shared link, a new tab or the
  Scan button scan afresh; scanning anything else, or going back to no repository, stops it
- No warnings: they can be many and hide the skills; the CLI prints them
- GitHub answers no more → its message, red, above the repositories; the ones left: `not scanned`
## Groups
- A **Group skills** button above the skills, once the scan is over and found skills: a repository's
  page (one from an organization's scan that still runs too: that repository is scanned); the
  organization's page, done, stopped or GitHub answering no more: the skills of the repositories
  scanned so far; while it runs, none; no skills, none
- It opens their **groups** ([analysis.md](analysis.md), Group), *no new scan*:
  `?source=<link>&view=groups`; `JetBrains/kotlin · 6 skills in 4 groups`, and `Back to skills`
  (`Back to repositories` for an organization) to where the button was; the browser's Back too
- Each group: `Testing · 3 skills`, in the order of the list of groups, Other last; no empty group
- Its skills by **name**, as in the list: the name, the badge of its copies, the first sentence; for
  an organization, by name then repository, each with its **repository** (`JetBrains/kotlin`),
  muted: the same name in two repositories, two skills
- A chosen skill: its SKILL.md as on the repository's page, its last update too; the first is
  chosen at first; no filter
- The organization's message stays above: `Stopped after 1 of 4 repositories`
- A reload or a shared link scans again, and shows the groups once the scan is over; an
  organization's page and progress meanwhile
## API
- `GET /`: the page
- `GET /api/scan?source=<link>`; not `HEAD`, which would scan for nothing → `{ repository, skills, warnings }`; each skill has its `link`,
  its first sentence as `summary`, its SKILL.md `text`, and that text's parts: the other front
  matter keys as `properties`, the Markdown `body`, its last update as `updated`, `{ date }` or
  `{ error }`, its group as `group`, `{ id, name, order }`, `order` its place in the list of groups
- For an organization: `application/x-ndjson`, one JSON line at a time, each as soon as it is known:
  `{ organization, repositories }` (each `{ id, url }`), then for each repository as it is scanned
  `{ id, url, repository, skills, warnings }`, as for a repository, or
  `{ id, url, error }`; the scan cannot go on → `{ error }`, last
- The page closes or scans something else → the server stops scanning the organization
- A clear message → status 400, `{ error }`

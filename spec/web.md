# Web view
`./skill-atlas serve [--port <port>]`: a local web view on `http://localhost:3000`, the same
scan as the [command line](cli.md). Only on this machine (`127.0.0.1`): it reads local directories.
*Nothing is stored*: each scan is a fresh one. `GITHUB_TOKEN` works as for `scan`.
## Page
- A **field** for a repository link (a GitHub URL, or a directory) and a *Scan* button; Enter scans too
- The address keeps it, `?source=<link>`: a reload or a shared link scans it again
- The repository, `JetBrains/kotlin · 6 skills`, and its **skills**, sorted by **name**: the name,
  the description's *first sentence*, `also in <paths>` for copies ([analysis.md](analysis.md), Skill)
- A chosen skill's **SKILL.md**: the front matter as a table, the body as *Markdown*, and its link
  (on GitHub at the *scanned commit*); the first skill is chosen at first
- The SKILL.md is *untrusted*: rendered HTML is sanitized, scripts never run
- The warnings, as the CLI prints them
- No skills → `No skills found`; an empty field, an unreachable repository or not a GitHub URL
  → the same clear message as the CLI
## API
- `GET /`: the page
- `GET /api/scan?source=<link>` → `{ repository, skills, warnings }`; each skill has its `link`,
  its first sentence as `summary` and its SKILL.md `text`
- A clear message → status 400, `{ error }`

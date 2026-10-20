# Web view
`./skill-atlas serve [--port <port>]`: a local web view on `http://127.0.0.1:3000`, the same
scan as the [command line](cli.md). Only on this machine (`127.0.0.1`): it reads local directories.
Only for `localhost` and `127.0.0.1` at its port in the `Host` header (no port: 80), else 403:
another site's page cannot reach it through a name of its own resolved to `127.0.0.1` (DNS rebinding).
`<port>`: digits, 0 to 65535, 0 for any free one; else a clear message, exit code 1.
*Nothing is stored*: each scan is a fresh one; going back to no repository stops waiting for a
running one, and its result is not shown. `GITHUB_TOKEN` works as for `scan`.
## Page
- A **field** for a repository link (a GitHub URL, or a directory) and a *Scan* button; Enter scans too
- The address keeps it, `?source=<link>`: a reload or a shared link scans it again
- The repository, `JetBrains/kotlin · 6 skills`, and its **skills**, sorted by **name**: the name,
  the description's *first sentence* in at most *two lines* (cut with `…`, whole on hover),
  `also in <paths>` for copies ([analysis.md](analysis.md), Skill)
- A chosen skill's **SKILL.md**: the front matter as a table, the body as *Markdown*, and its link
  on GitHub at the *scanned commit*; in a directory, the file's path as text (a web page cannot
  open a `file://` link); the first skill is chosen at first
- The SKILL.md is *untrusted*: rendered HTML is sanitized, scripts never run, remote images
  are not loaded (they would tell their server who opened it)
- The warnings, as the CLI prints them
- No skills → `No skills found`; an empty field → `Enter a GitHub repository URL or a directory`;
  an unreachable repository or not a GitHub URL → the same clear message as the CLI
## API
- `GET /`: the page
- `GET /api/scan?source=<link>`; not `HEAD`, which would scan for nothing → `{ repository, skills, warnings }`; each skill has its `link`,
  its first sentence as `summary`, its SKILL.md `text`, and that text's parts: the other front
  matter keys as `properties`, the Markdown `body`
- A clear message → status 400, `{ error }`

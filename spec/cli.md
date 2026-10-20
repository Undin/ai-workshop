# Command line
`./skill-atlas scan <GitHub URL | directory>`
Prints the result **at once**; *nothing is stored*.
`https://github.com/<owner>/<repo>/tree/<commit | branch | tag>`: that ref, not the default branch.
`https://github.com/<owner>`: each public repository of the organization, one by one
([analysis.md](analysis.md), Organization).
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.

`./skill-atlas serve [--port <port>]`: the [web view](web.md), until stopped.
`./skill-atlas help`: the commands; `serve` only where there is a server (not in the browser
terminal, `src/browser.ts`).
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies ([analysis.md](analysis.md), Skill)
- Warnings go to *stderr*: malformed front matter, copies with different content, links not followed, skipped test data
### An organization
```
JetBrains · 4 repositories
JetBrains/empty · not scanned: GitHub answered 409 for …: Git Repository is empty.
JetBrains/example · 1 skill
JetBrains/kotlin · 6 skills
JetBrains/none · 0 skills
```
- The number of repositories first, then each repository's line **as it is scanned**: its own
  scan's first line, or `not scanned: <why>`
- Its warnings go to *stderr*, right after it: `warning: JetBrains/kotlin: <warning>`
- GitHub answers no more: the lines so far, then the message on stderr, exit code 1

# Command line
`./skill-atlas scan [--no-cache] <GitHub URL | directory>`
Prints the result **at once**; GitHub's answers are kept in the [cache](#cache), *nothing else is stored*.
`https://github.com/<owner>/<repo>/tree/<commit | branch | tag>`: that ref, not the default branch.
`https://github.com/<owner>`: each public repository of the organization, one by one
([analysis.md](analysis.md), Organization).
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.

`./skill-atlas serve [--port <port>] [--no-cache]`: the [web view](web.md), until stopped.
`./skill-atlas help`: the commands; `serve` only where there is a server, `--no-cache` only where
there is a cache (neither in the browser terminal, `src/browser.ts`).
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies ([analysis.md](analysis.md), Skill)
- Not the skills' last update: a GitHub request each ([analysis.md](analysis.md), Last update); the
  [web view](web.md) shows it
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
## Cache
GitHub's answers, kept on disk in `.skill-atlas-cache/` in the *current directory*: a scan asks
GitHub only for what is not there or expired.
- Pinned to a commit (a tree, a blob, a file at a commit, a commit by its sha): kept *30 days*;
  the rest (a repository, a branch or tag → its commit, an owner's repositories, code search): *1 hour*
- Only **successful** answers (200); an error (404, rate limit, a rejected token, 409) never: a fixed
  problem is seen at once
- **Per token**: a file's name is a hash of the token and the URL; the token is never written;
  without a token, what was answered to one is not read
- Expired → asked again, replaced; no command to clear it: delete the directory
- A file that cannot be read or written → GitHub is asked, the scan goes on, no warning
- `--no-cache`, before or after the link: nothing read from the cache, nothing written to it
- The output is the same; nothing printed about the cache. A local directory: nothing stored
- Only the Node CLI and [web view](web.md): the browser terminal has no disk, no cache; there
  `--no-cache` is not an argument (the usage)

# Command line
`./skill-atlas scan <GitHub URL | directory>`
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.

`./skill-atlas serve [--port <port>]`: the [web view](web.md), until stopped.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies ([analysis.md](analysis.md), Skill)
- Warnings go to *stderr*: malformed front matter, copies with different content, links not followed, skipped test data

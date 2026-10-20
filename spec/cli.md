# Command line
`./skill-atlas scan <GitHub URL | directory>`
Prints the result **at once**; *nothing is stored*.
`https://github.com/<owner>/<repo>/tree/<commit | branch | tag>`: that ref, not the default branch.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies ([analysis.md](analysis.md), Skill)
- Warnings go to *stderr*: malformed front matter, copies with different content, links not followed, skipped test data

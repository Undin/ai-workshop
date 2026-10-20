# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every **skill** (see below): **name**, **description**, **link**
## Skill
A directory with a `SKILL.md`: YAML front matter (`name`, `description`), then a Markdown body.
The other files in it (`scripts/`, `assets/`, `references/`) *belong to the skill*; they are not skills.
### Where
`SKILL.md`, the *exact name*, directly in `<name>/` whose parent is named `skills`, at **any depth**.

| Path | Skill? |
| --- | --- |
| `.claude/skills/commits/SKILL.md` | yes |
| `.github/skills/x/SKILL.md`, `.agents/skills/x/SKILL.md`, `agent/skills/x/SKILL.md` | yes, other agents |
| `packages/app/.claude/skills/x/SKILL.md` | yes, a monorepo package |
| `plugins/p/skills/x/SKILL.md`, `skills/x/SKILL.md` | yes, a plugin or a skill collection |
| `SKILL.md` at the root | yes, the repository is one skill |
| `docs/SKILL.md`, `skills/SKILL.md`, `skills/group/x/SKILL.md` | no, not `skills/<name>/` |
| `skill.md`, `SKILL.md.bak` | no, not the exact name |
### Name
The front matter, else the directory; a root `SKILL.md`: the repository
### Copies
- Same name, *same content* (line endings aside) → **one skill**: the first path in path order,
  the others `also in <paths>`
- Same name, *different content* → two skills and a warning: `<path>: same name as <path>, different content`
- A **symbolic link** counts: a linked `SKILL.md`, skill directory or `skills/` directory
  (`.github/skills → ../.claude/skills`) is followed, and each skill it reaches is a *copy* of its target; the target is the skill, whatever the path order
- A link that is broken or points outside the repository → a warning: `<path>: link to <target>, not followed`
### Not a skill: test data
- A directory **above** `skills/` named:
  - `__tests__`, `testdata`, `fixture`, `fixtures` or `examples`, in any case
  - with the *word* `test` or `tests`: `test`, `integration-tests`, `e2e_test`, `test-data`
  - a *source set*: `jvmTest`, `commonTest`, `androidUnitTest`, `testFixtures`
    (as in JetBrains/koog: `integration-tests/src/jvmTest/resources/skills/…`)
- Not a word that contains it: `latest`, `contest`, `pytest`
- Not the skill's own directory: `.claude/skills/run-tests` is a skill
- Counted from the scanned root: `scan ./fixture` still finds the fixture's skills
- Skipped, with one warning: `skipped N SKILL.md in test data`
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- A tree too large for one answer: only `.agents/skills`, `.claude/skills`, `.github/skills`,
  `agent/skills` are listed, with a warning
- With `GITHUB_TOKEN`, through *code search*: it finds files only, so symbolic links are not seen
- A pinned ref (`/tree/<ref>`): resolved to its commit and listed through the *tree*, even with
  `GITHUB_TOKEN` (code search only sees the default branch)
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1

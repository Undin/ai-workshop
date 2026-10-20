# fixture

A small repository for the tests: one case per rule in [spec/analysis.md](../spec/analysis.md), Skill.

| Path | Case |
| --- | --- |
| `.claude/skills/commits` | a skill |
| `.github/skills/code-style` | a skill in another agent's folder |
| `.agents/skills/release-checklist` | malformed front matter |
| `packages/app/.claude/skills/deploy` | a skill in a monorepo package |
| `packages/api/.claude/skills/deploy` | same name, different content: two skills and a warning |
| `plugins/review/skills/review-pr` | a skill in a plugin |
| `skills/changelog` | a skill in a skill collection |
| `SKILL.md` | the repository as one skill, no name: named `fixture` |
| `.agents/skills/code-style` | a copy, same content with CRLF line endings: the skill, `.github/…` is `also in` |
| `.github/skills/commits/SKILL.md` | a link to a `SKILL.md`: a copy of `.claude/skills/commits` |
| `agent/skills/review-pr` | a link to a skill directory: a copy of `plugins/review/skills/review-pr` |
| `.cursor/skills` | a link to a `skills/` directory: `changelog` is also in `.cursor/skills/changelog` |
| `.claude/skills/missing` | a broken link: a warning |
| `.claude/skills/outside/SKILL.md` | a link outside the repository: a warning |
| `docs/SKILL.md`, `skills/SKILL.md`, `skills/group/nested` | not in `skills/<name>/`: not skills |
| `.claude/skills/lowercase/skill.md`, `.claude/skills/backup/SKILL.md.bak` | not the exact name: not skills |
| `tests/skills/sample`, `src/test/resources/.claude/skills/sample`, `examples/skills/demo` | test data: skipped, one warning for 3 |

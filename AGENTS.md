# AGENTS.md
## Specs
Read [./spec](spec/) first. Update it with the code.
## Tests
Integration tests for every case in the spec.
## Workflow
1. **Discuss** the solution first: the approach, open questions; agree before changing code
2. **Branch** off an up-to-date `main` if not on a branch for this work yet: a short descriptive name
3. **Change** the code, the spec and the tests together; **commit** in a few logical steps,
   each one coherent (e.g. the feature with its tests, then CI, then docs), not one big commit
   and not one per file
4. **Test** locally: `npm run typecheck`, `npm test`, and `npm run e2e` when the change touches
   scanning; fix until green
5. **Pull request**: push, `gh pr create` against `main` with what and why, then wait for CI
   (`gh pr checks --watch`); a red check is fixed with a new commit on the branch, until green
## Definition of done
- All tests pass locally
- The pull request's CI is green

## Commands
- `npm ci`, then `npx playwright install chromium`: first, in a fresh checkout
- `npm test`: the tests; `npm run test:unit` without a browser, `npm run test:web` the web view in Chromium
- `npm run e2e`: the real CLI on real repositories ([e2e/](e2e/)); needs the network and `GITHUB_TOKEN`

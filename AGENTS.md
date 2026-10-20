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
5. **Demo**, when the change adds a feature of the web view or changes one: `demos/<name>.demo.ts`
   showing exactly it (looked at locally, `npm run demo -- <name>`, its screenshots in `demos/out/<name>/`)
6. **Pull request**: push, `gh pr create` against `main` with what and why, a draft while a demo of
   step 5 is still to be shown in it; then wait for CI
   (`gh pr checks --watch`), the Demos workflow included: it records every demo on each push to a
   pull request; a red check is fixed with a new commit on the branch, until green. For each demo of
   step 5: commit the screenshots of its Demos run (its `<name>-screenshots` artifact) into
   `demos/<name>/`, a commit of their own, and put them in the pull request's description with a
   link to its video (its `<name>.webm` artifact); then mark it ready (`gh pr ready`). A later change
   that can alter what a demo shows: the same again, from its new Demos run
## Definition of done
- All tests pass locally
- The pull request's CI is green
- A new or changed feature of the web view: its demo green, its screenshots and video in the
  pull request's description

## Commands
- `npm ci`, then `npx playwright install chromium`: first, in a fresh checkout
- `npm test`: the tests; `npm run test:unit` without a browser, `npm run test:web` the web view in Chromium
- `npm run demo [-- <name>]`: a demo of a feature ([demos/](demos/)), its video and screenshots;
  needs the network and `GITHUB_TOKEN`; the Demos workflow runs them all on GitHub,
  on every pull request
- `npm run e2e`: the real CLI on real repositories ([e2e/](e2e/)); needs the network and `GITHUB_TOKEN`

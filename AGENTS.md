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
5. **Demo**, when the change adds a feature of the web view or changes one: `demos/<name>/<name>.demo.ts`
   showing exactly it, its recording `demos/<name>/cache/` (`npm run demo:record -- <name>`),
   green and looked at locally (`npm run demo -- <name>`, its video and screenshots in
   `demos/out/`, never committed); again after a later change that can alter what it shows
6. **Pull request**: push, `gh pr create` against `main` with what and why; then wait for CI
   (`gh pr checks --watch`); a red check is fixed with a new commit on the branch, until green.
   With a demo: a draft until its screenshots, `demos/<name>/screenshots/`, are the Demos
   workflow's (`npm run demo:screenshots` after its green run, a commit of them, pushed, green
   again), then ready
## Definition of done
- All tests pass locally
- The pull request's CI is green
- A new or changed feature of the web view: its demo green locally

## Commands
- `npm ci`, then `npx playwright install chromium`: first, in a fresh checkout
- `npm test`: the tests; `npm run test:unit` without a browser, `npm run test:web` the web view in Chromium
- `npm run demo [-- <name>]`: a demo of a feature ([demos/](demos/)), its video and screenshots,
  GitHub answering from its recording: no network, no token; the Demos workflow runs them all on
  every pull request
- `npm run demo:screenshots`: the demos' screenshots to commit, `demos/<name>/screenshots/`, from the
  Demos workflow's green run on the last commit pushed
- `npm run demo:record [-- <name>]`: a demo's recording, `demos/<name>/cache/`, anew from GitHub;
  needs the network and `GITHUB_TOKEN`
- `npm run e2e`: the real CLI on real repositories ([e2e/](e2e/)); needs the network and `GITHUB_TOKEN`

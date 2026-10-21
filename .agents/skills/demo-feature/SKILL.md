---
name: demo-feature
description: "Record a demo of a new or changed feature of the web view, to check it on a real repository: a Playwright script, demos/<name>/<name>.demo.ts, that plays exactly that feature on a real repository with a visible pointer, GitHub answering from its recording (demos/<name>/cache/, recorded once, then replayed with no network), asserts what it shows, plays the waits where nothing happens faster, and saves a video (demos/out/<name>.webm) and screenshots of its key points (demos/out/<name>/<nn>-<point>.png), looked at locally, never committed; the screenshots committed, demos/<name>/screenshots/, are the Demos workflow's, taken on the pull request, a draft until then. Use when a change is visible in the web view (src/web/, spec/web.md), from implement-issue or when the user asks for a demo, a video or screenshots of a feature; skip when nothing a user sees in the browser changed."
---

Takes the feature (an issue, a pull request, or the spec cases of the change) and makes a demo of
it, with the helpers in [demos/demo.ts](../../../demos/demo.ts) and the config in
[demos/playwright.config.ts](../../../demos/playwright.config.ts). The existing demos are the
examples to follow: [filter.demo.ts](../../../demos/filter/filter.demo.ts),
[organization.demo.ts](../../../demos/organization/organization.demo.ts).

A demo is a directory, `demos/<name>/`:

- `<name>.demo.ts`: the script
- `cache/`: GitHub's answers it gets, recorded (`npm run demo:record -- <name>`) and committed; a
  demo replays them, with no network and no token, the same every time
- `recording.json`, if needed ([demos/recording.ts](../../../demos/recording.ts)):
  `repositories`, an organization cut to the ones named (a few small ones; the whole one would
  be megabytes), and `latency`, each replayed answer that many milliseconds late, for a scan that
  must still be running when the demo acts on it (Stop)
- `screenshots/`: its key points as the Demos workflow took them on the pull request, committed
  (step 5); never a local run's

**Is there anything to demo?** Only what a user sees in the browser: a change of `src/web/` or of
`spec/web.md`. A CLI-only change, a refactoring, tests, CI, docs: no demo; say so and stop.
A changed feature that already has a demo: update that demo instead of adding one.

## Process

### 1. What to show

- The feature's spec cases (spec/web.md; from implement-issue, the ones of its step 2): the demo
  shows **exactly** them, in the order a user would meet them, and nothing else.
- Pick the moments a reviewer must see: each becomes a **key point** (a screenshot), e.g. the
  result of each action, an empty or error state the feature adds.

### 2. Pick a real repository

The demo runs the real web view ([demos/serve.ts](../../../demos/serve.ts)) on a real repository, as a
user would: recorded once from GitHub, with the network and `GITHUB_TOKEN`
(`set -a; . ./.env; set +a` if there is a `.env`), then replayed.

- Choose a repository (or an organization) where the feature shows well: enough skills, the
  inputs that exercise each case. Look at it first with the CLI:
  `./skill-atlas scan <url> 2>/dev/null | grep -v '^  '`, and choose the inputs (filter texts,
  links to click) from what it prints.
- Keep the recording small: a few MB at most (`du -sh demos/<name>/cache`); a huge tree or commit
  in it is a repository to leave out.
- A recording made anew has what the repository has by then. **Assert what the feature does, not
  which data the repository has**:
  counts read from the page (`Showing ${kept} of ${all}`), regular expressions for numbers and
  names, "every kept row has a marked match", not a fixed list of skills.

### 3. Write demos/<name>/<name>.demo.ts

`<name>`: the feature, short, kebab-case. A comment at the top: the feature, its spec section and
the issue (`#<n>`), the repository it runs on. Import from `../demo.ts`, not `@playwright/test`:

- `test`: the demo's web view, GitHub answering from its recording, and the page recorded into
  `demos/out/<name>.webm` with an animated pointer, a click marker and a highlight of the element
  acted on; no callout with the action's name. A request not recorded fails the demo.
- `type(field, text, delay?)`: clicks the field (so the pointer goes there), clears it, types it
  key by key. Never `fill()`: the viewer must see the typing.
- `pause(page, ms?)`: after each result, time to read it (1 to 3 s).
- `keyPoint(page, name)`: a screenshot, `demos/out/<name>/<nn>-<point>.png`, numbered in order. Take it
  **right after the assertions** of that moment, so it shows a checked state; `<point>` says
  what it shows (`filtered-by-editor`, `stopped`).
- `faster(page, factor, wait)`: a wait where nothing happens (a scan, a list loading) plays
  `factor` times faster in the video, `⏩ ×<factor>` in its bottom right corner meanwhile (ffmpeg,
  after the recording). Anything longer than ~3 s of nothing: ×4 to ×8. Never around an action
  or a result the viewer must see.

What makes a demo readable, learned the hard way:

- **The pointer moves on pointer actions only** (click, hover): reach every field and button by
  a click or a hover before typing or pressing keys.
- **Show it before acting on it**: an element below the fold is scrolled into view
  (`el.scrollIntoView({ block: 'center', behavior: 'smooth' })`), hovered, paused on, then
  clicked; a click alone jumps there with no time to see it.
- **A long wait: follow it**, e.g. scroll the row being scanned into view each second, inside
  `faster()`, rather than a still screen.
- **After a navigation the scroll position stays**: scroll back to the top
  (`window.scrollTo({ top: 0, behavior: 'smooth' })`) when the new page should be seen from it.
- **Don't wait for the end of what is long** (an organization's whole scan): show a few steps of
  it and the way out the feature offers (Stop).
- A page script can't use DOM globals (no DOM lib in tsconfig): reach them through an element,
  `body.ownerDocument.defaultView!`.
- The page's Content-Security-Policy forbids inline styles: the demo browser bypasses it
  (`bypassCSP` in the config), the app's policy stays; don't change it for a demo.

### 4. Run it and look at the result

```bash
npm run typecheck
npm run demo:record -- <name> # GitHub's answers, once, and after a change that asks GitHub for others
npm run demo -- <name>        # replayed; all demos: npm run demo
```

A failing assertion is either a demo bug or a feature bug: fix the demo, or stop and report the
feature bug (implement-issue: back to its step 4); never loosen an assertion to get a video.

Then **look at it**; a passing demo can still be a bad video. You can't play a video: look at
its frames and at every screenshot, `demos/out/<name>/` (Read the PNGs):

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 demos/out/<name>.webm
ffmpeg -loglevel error -y -i demos/out/<name>.webm -vf "fps=1,scale=640:-1,tile=4x8" -frames:v 1 /tmp/<name>-frames.png
ffmpeg -loglevel error -y -ss <second> -i demos/out/<name>.webm -frames:v 1 /tmp/<name>-<second>.png   # one frame, full size
```

Check: the pointer goes to each element before it is used; the typing is visible; each result is
on screen long enough; nothing important is cut off or below the fold; no stretch of nothing
(longer than ~3 s) outside `faster()`, and the `⏩ ×N` badge in the bottom right during each
`faster()`; each screenshot shows its key point. Fix and run again until it does.

### 5. Commit

The demo, `demos/<name>/`, its script and recording, and its section in
[demos/README.md](../../../demos/README.md) for its screenshots (a changed demo: its section
updated), in one commit (`Demo: <the feature> (#<n>)`); `demos/out/` is never committed.

The Demos workflow ([demos.yml](../../../.github/workflows/demos.yml)) runs every demo on each pull
request, from its recording, its video and screenshots artifacts: a check like CI. Its screenshots
are the ones committed, never a local run's: the pull request is a **draft** until then
(`gh pr create --draft`). Once its Demos run on the last commit is green:

```bash
npm run demo:screenshots      # into demos/<name>/screenshots/, from that run
git add demos/*/screenshots && git commit -m "Demos: screenshots from the Demos workflow"
git push                      # green again, then: gh pr ready
```

### 6. Report

The demo's file, its length (seconds; sped-up parts with their factors), the key points with their
screenshots, `demos/out/<name>/`, the size of its recording, and anything it could not show.

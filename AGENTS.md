# AGENTS.md
## Specs
Read [./spec](spec/) first. Update it with the code.
## Tests
Integration tests for every case in the spec.
## Definition of done
- All tests pass locally

## Commands
- `npm ci`, then `npx playwright install chromium`: first, in a fresh checkout
- `npm test`: the tests; `npm run test:unit` without a browser, `npm run test:web` the web view in Chromium

// `node --import ./tests/github-preload.ts src/cli.ts …`: the real CLI, with GitHub answering from
// the EXAMPLE recording, and each request's Authorization header appended to $SKILL_ATLAS_SEEN.
import { appendFileSync } from 'node:fs';
import { github } from './helpers.ts';

// The CLI only fetches GitHub: the test asks the server from its own process.
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const headers = new Headers(init?.headers);
  appendFileSync(process.env.SKILL_ATLAS_SEEN!, `${headers.get('authorization') ?? 'none'}\n`);
  return github(url, { headers: Object.fromEntries(headers) });
}) as typeof fetch;

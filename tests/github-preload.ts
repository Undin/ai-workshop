// `node --import ./tests/github-preload.ts src/cli.ts …`: the real CLI, with GitHub answering from
// the EXAMPLE recording, and each request's Authorization header appended to $SKILL_ATLAS_SEEN.
import { appendFileSync } from 'node:fs';
import { github } from './helpers.ts';

const local = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) return local(input, init);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  appendFileSync(process.env.SKILL_ATLAS_SEEN!, `${headers.Authorization ?? 'none'}\n`);
  return github(url, { headers });
}) as typeof fetch;

// The web view of a demo: `skill-atlas serve`, with GitHub answering from the demo's recording,
// demos/<name>/cache/, never from the network; with DEMO_RECORD=1, from GitHub, each answer
// recorded there anew. Started by demos/demo.ts for each demo:
//   DEMO=demos/<name> [DEMO_RECORD=1] [PORT=<port>] node demos/serve.ts
// It prints its address; each request not recorded, on stderr: `not recorded: <url>`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSource } from '../src/open.ts';
import { createAtlasServer, listen } from '../src/server.ts';
import { recording, replayed, type RecordingOptions } from './recording.ts';

const demo = process.env.DEMO!;
const file = join(demo, 'recording.json');
const options: RecordingOptions = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const directory = join(demo, 'cache');
// A token as GitHub's answers were recorded with: code search for a repository, as a user with
// GITHUB_TOKEN gets; never sent in a replay.
const record = process.env.DEMO_RECORD === '1';
const token = record ? process.env.GITHUB_TOKEN : 'replayed';
if (!token) throw new Error('Recording a demo needs GITHUB_TOKEN');
const fetch = record
  ? recording(directory, globalThis.fetch, options)
  : replayed(directory, options, (url) => console.error(`not recorded: ${url}`));

const server = createAtlasServer({ open: (input) => openSource(input, { fetch, token }) });
console.log(`Skill Atlas: ${(await listen(server, Number(process.env.PORT ?? 0))).href}`);

#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr, or the web view. Nothing is stored.
import { run } from './commands.ts';
import { lastUpdate, openSource } from './open.ts';
import { createAtlasServer, listen } from './server.ts';

const token = process.env.GITHUB_TOKEN || undefined;
const open = (input: string) => openSource(input, { fetch, token });
const updated = (link: string) => lastUpdate(link, { fetch, token });

process.exitCode = await run(process.argv.slice(2), {
  open,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  // The server keeps the process running.
  serve: (port) => listen(createAtlasServer({ open, updated }), port),
});

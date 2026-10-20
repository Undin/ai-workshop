#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr. Nothing is stored.
import { run } from './commands.ts';
import { openSource } from './open.ts';

const token = process.env.GITHUB_TOKEN || undefined;

process.exitCode = await run(process.argv.slice(2), {
  open: (input) => openSource(input, { fetch, token }),
  print: (text) => console.log(text),
  error: (text) => console.error(text),
});

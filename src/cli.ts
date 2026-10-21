#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr, or the web view. GitHub's answers are kept in the cache, in the current directory;
// nothing else is stored.
import { CACHE_DIRECTORY, cached } from './cache.ts';
import { run, type CacheChoice } from './commands.ts';
import { openSource } from './open.ts';
import { createAtlasServer, listen } from './server.ts';

const token = process.env.GITHUB_TOKEN || undefined;
const fromCache = cached(fetch, { directory: CACHE_DIRECTORY, token });
const open = (input: string, { cache }: CacheChoice) => openSource(input, { fetch: cache ? fromCache : fetch, token });

process.exitCode = await run(process.argv.slice(2), {
  open,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  // The server keeps the process running.
  serve: (port, options) => listen(createAtlasServer({ open: (input) => open(input, options) }), port),
  cacheDirectory: CACHE_DIRECTORY,
});

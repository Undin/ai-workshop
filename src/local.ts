import { execFile } from 'node:child_process';
import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { AtlasError } from './core/errors.ts';
import type { Source } from './core/scan.ts';

/** Never part of a repository's own files. */
const SKIPPED = new Set(['.git', 'node_modules']);

/** A local checkout as a repository: named after its directory, linked with file:// URLs. */
export async function openDirectory(input: string): Promise<Source> {
  const root = resolve(input);
  const name = basename(root);
  const paths: string[] = [];
  const links: string[] = [];
  try {
    await walk(root, '', paths, links);
  } catch {
    throw new AtlasError(`Not a GitHub URL or a readable directory: ${input}`);
  }
  return {
    repository: { id: name, organization: 'local', name, url: pathToFileURL(root).href, commit: '' },
    paths,
    links,
    warnings: [],
    read: (path) => readFile(join(root, path)).then((bytes) => new Uint8Array(bytes), () => undefined),
    readLink: (path) => readlink(join(root, path)).then((target) => target.split(sep).join('/'), () => undefined),
    lastUpdate: (directory) => lastUpdate(join(root, directory)),
  };
}

/**
 * In a git checkout, the date of the last commit that changed the directory; not committed, or
 * changed since (no git, or not a checkout: nothing committed), the latest modification of its
 * files, in a checkout the ones git does not ignore.
 */
async function lastUpdate(directory: string): Promise<string> {
  const git = (...args: string[]) =>
    promisify(execFile)('git', ['-C', directory, ...args, '--', '.'], { maxBuffer: 1 << 30 }).then(({ stdout }) => stdout.trim(), () => '');
  const [committed, changed] = await Promise.all([git('log', '-1', '--format=%cI'), git('status', '--porcelain')]);
  if (committed && !changed) return new Date(committed).toISOString();
  // Tracked and untracked, not ignored: build output is not the skill's change.
  const paths = (await git('ls-files', '-z', '--cached', '--others', '--exclude-standard')).split('\0').filter(Boolean);
  if (!paths.length) await walk(directory, '', paths, []);
  // A deleted file has no time; a reduce, not a spread: a whole checkout has more files than one can pass.
  const times = await Promise.all(paths.map((path) => stat(join(directory, path)).then((entry) => entry.mtimeMs, () => 0)));
  const latest = times.reduce((latest, time) => Math.max(latest, time), 0);
  if (!latest) throw new AtlasError(`No files in ${directory}`);
  return new Date(latest).toISOString();
}

/** Every regular file and symbolic link under the directory, as paths relative to the root. */
async function walk(root: string, directory: string, paths: string[], links: string[]): Promise<void> {
  // One list for the whole walk: a large repository has more files than a spread can pass.
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIPPED.has(entry.name)) await walk(root, path, paths, links);
    else if (entry.isFile()) paths.push(path);
    // Not followed here: the core decides what a link reaches, the same way for GitHub.
    else if (entry.isSymbolicLink()) links.push(path);
  }
}

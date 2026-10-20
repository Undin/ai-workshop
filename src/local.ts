import { execFile } from 'node:child_process';
import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  };
}

/**
 * When the skill at the file:// link was last updated: in a git checkout, the date of the last
 * commit that changed its directory; not committed, or changed since, the latest modification of
 * its files.
 */
export async function lastUpdateInDirectory(link: string): Promise<string> {
  const file = link.startsWith('file:') ? fileURLToPath(link) : '';
  if (basename(file) !== 'SKILL.md' || !(await stat(file).then((entry) => entry.isFile(), () => false))) {
    throw new AtlasError(`Not a skill link: ${link}`);
  }
  const directory = dirname(file);
  const git = (...args: string[]) =>
    promisify(execFile)('git', ['-C', directory, ...args, '--', '.']).then(({ stdout }) => stdout.trim(), () => '');
  const [committed, changed] = await Promise.all([git('log', '-1', '--format=%cI'), git('status', '--porcelain')]);
  if (committed && !changed) return new Date(committed).toISOString();
  const paths: string[] = [];
  await walk(directory, '', paths, []);
  const times = await Promise.all(paths.map((path) => stat(join(directory, path)).then((entry) => entry.mtimeMs)));
  return new Date(Math.max(...times)).toISOString();
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

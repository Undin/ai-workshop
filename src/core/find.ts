/**
 * A skill found in a repository: where it is listed, and the regular file to read for it, which
 * differs when the path goes through a symbolic link.
 */
export type SkillFile = { path: string; file: string; name: string; linked: boolean };

export type Found = { files: SkillFile[]; warnings: string[] };

/** Where agents keep a repository's own skills. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/** Directories that hold a project's test data: a SKILL.md in them is not the project's skill. */
const TEST_DATA = new Set(['test', 'tests', '__tests__', 'testdata', 'test-data', 'fixture', 'fixtures', 'examples']);

/** More links in a row than this is a loop. */
const MAX_HOPS = 40;

/** A SKILL.md at the root, or directly in `skills/<name>/` at any depth. */
export function isSkillPath(path: string): boolean {
  const segments = path.split('/');
  return path === 'SKILL.md' || (segments.at(-1) === 'SKILL.md' && segments.at(-3) === 'skills');
}

/** Under a test data directory, counted from the scanned root. */
export function isTestData(path: string): boolean {
  return path.split('/').slice(0, -1).some((segment) => TEST_DATA.has(segment));
}

/**
 * Every skill: each SKILL.md in its place, named after its directory (a SKILL.md at the root after
 * the repository), including the ones reached through symbolic links. `links` maps each link's path
 * to its target, as written in the link.
 */
export function findSkills(paths: string[], links: Map<string, string>, repositoryName: string): Found {
  const regular = new Set(paths);
  const warnings: string[] = [];
  const candidates = paths.map((path) => ({ path, file: path, linked: false }));

  for (const [link, target] of links) {
    if (isTestData(`${link}/`)) continue;
    const resolved = resolveLink(link, links);
    const reached = resolved === undefined ? [] : reach(resolved, link, paths, regular);
    if (reached.length === 0) {
      if (mayHoldSkills(link)) warnings.push(`${link}: link to ${target}, not followed`);
      continue;
    }
    candidates.push(...reached.map(({ path, file }) => ({ path, file, linked: true })));
  }

  let skipped = 0;
  const files: SkillFile[] = [];
  for (const candidate of candidates) {
    if (!isSkillPath(candidate.path)) continue;
    if (isTestData(candidate.path)) {
      if (!candidate.linked) skipped++;
      continue;
    }
    files.push({ ...candidate, name: candidate.path.split('/').at(-2) ?? repositoryName });
  }
  if (skipped > 0) warnings.push(`skipped ${skipped} SKILL.md in test data`);
  return { files: files.sort((a, b) => compare(a.path, b.path)), warnings };
}

/** What a link points to, through other links, relative to the root; undefined if outside or a loop. */
function resolveLink(link: string, links: Map<string, string>): string | undefined {
  let path = link;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const prefix = linkPrefix(path, links);
    if (prefix === undefined) return path;
    const target = links.get(prefix)!;
    if (target.startsWith('/')) return undefined;
    const joined = normalize([...prefix.split('/').slice(0, -1), ...target.split('/'), ...path.slice(prefix.length).split('/')]);
    if (joined === undefined) return undefined;
    path = joined;
  }
  return undefined;
}

/** The longest link that is the path or one of its parents. */
function linkPrefix(path: string, links: Map<string, string>): string | undefined {
  const segments = path.split('/');
  for (let length = segments.length; length > 0; length--) {
    const prefix = segments.slice(0, length).join('/');
    if (links.has(prefix)) return prefix;
  }
  return undefined;
}

/** Without `.`, `..` and empty segments; undefined if it leaves the root. */
function normalize(segments: string[]): string | undefined {
  const result: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') result.push(segment);
    else if (result.pop() === undefined) return undefined;
  }
  return result.join('/');
}

/** The files a link reaches: its target file, or every regular file in its target directory. */
function reach(target: string, link: string, paths: string[], regular: Set<string>): { path: string; file: string }[] {
  if (regular.has(target)) return [{ path: link, file: target }];
  const directory = target === '' ? '' : `${target}/`;
  return paths
    .filter((path) => path.startsWith(directory))
    .map((path) => ({ path: `${link}/${path.slice(directory.length)}`, file: path }));
}

/** A link where a skill, a skill directory or a `skills/` directory would be. */
function mayHoldSkills(link: string): boolean {
  const segments = link.split('/');
  return isSkillPath(link) || segments.at(-1) === 'skills' || segments.at(-2) === 'skills';
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

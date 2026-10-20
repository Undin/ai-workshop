import { AtlasError, GitHubUnavailable } from './errors.ts';
import { findSkills, isTestData, type SkillFile } from './find.ts';
import { sortSkills, type Organization, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every regular file path, relative to the repository root. */
  paths: string[];
  /** Every symbolic link's path, relative to the repository root. */
  links: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** The link's target, as written in the link, or undefined if it is not there. */
  readLink(path: string): Promise<string | undefined>;
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** An organization to scan: its repositories, each opened when its turn comes. */
export type OrganizationSource = {
  organization: Organization;
  repositories: { id: string; url: string; open(): Promise<Source> }[];
};

/** One repository of an organization, scanned: its scan, or why not. */
export type RepositoryScan = { id: string; url: string; result: ScanResult } | { id: string; url: string; error: string };

type Read = { file: SkillFile; text?: string };

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  // The links and the files are read at the same time: on GitHub, each one is a request.
  const links = await readLinks(source);
  const found = findSkills(source.paths, links, source.repository.name);
  const texts = new Map<string, Promise<string | undefined>>();
  const readText = (path: string) => {
    if (!texts.has(path)) texts.set(path, source.read(path).then((bytes) => bytes && new TextDecoder().decode(bytes)));
    return texts.get(path)!;
  };
  const read: Read[] = await Promise.all(found.files.map(async (file) => ({ file, text: await readText(file.file) })));

  const warnings = [...source.warnings, ...found.warnings];
  const skills: Skill[] = [];
  for (const { file } of read.filter((entry) => entry.text === undefined)) {
    warnings.push(`${file.path}: listed, but not found at the scanned commit; skipped`);
  }
  const parsed = read.flatMap(({ file, text }) => (text === undefined ? [] : [{ file, text, ...parseSkill(text) }]));

  // A link is a copy of its target, when the target is listed; otherwise it is listed itself.
  const listed = new Set(parsed.map((entry) => entry.file.path));
  const own = parsed.filter((entry) => !entry.file.linked || !listed.has(entry.file.file));
  for (const entry of own) if (entry.warning) warnings.push(`${entry.file.path}: ${entry.warning}`);
  const byName = Map.groupBy(own, (entry) => entry.name ?? entry.file.name);
  for (const [name, entries] of byName) {
    // Same name, same content (line endings aside): one skill, the first path; the others are copies.
    const byContent = [...Map.groupBy(entries, (entry) => entry.text.replace(/\r\n?/g, '\n')).values()];
    const first = byContent[0][0];
    for (const [index, group] of byContent.entries()) {
      const [primary, ...copies] = group;
      if (index > 0) warnings.push(`${primary.file.path}: same name as ${first.file.path}, different content`);
      const files = new Set(group.map((entry) => entry.file.file));
      const linked = parsed.filter((entry) => entry.file.linked && files.has(entry.file.file));
      skills.push({
        id: `${source.repository.id}:${primary.file.path}`,
        repository: source.repository.id,
        path: primary.file.path,
        name,
        description: primary.description,
        commit: source.repository.commit,
        copies: [...copies, ...linked].map((entry) => entry.file.path).sort(),
        text: primary.text,
        properties: primary.properties,
        body: primary.body,
      });
    }
  }
  return { repository: source.repository, skills: sortSkills(skills), warnings };
}

/**
 * The organization's repositories one by one, each as soon as it is scanned. One that cannot be
 * scanned is said so and the scan goes on; when GitHub answers no more, it stops: that is thrown.
 */
export async function* scanOrganization(source: OrganizationSource): AsyncGenerator<RepositoryScan> {
  for (const { id, url, open } of source.repositories) {
    let result: ScanResult;
    try {
      result = await scan(await open());
    } catch (error) {
      if (!(error instanceof AtlasError) || error instanceof GitHubUnavailable) throw error;
      yield { id, url, error: error.message };
      continue;
    }
    yield { id, url, result };
  }
}

/** Each link's target; links in test data are not read. */
async function readLinks(source: Source): Promise<Map<string, string>> {
  const links = source.links.filter((link) => !isTestData(link));
  const targets = await Promise.all(links.map((link) => source.readLink(link)));
  return new Map(links.flatMap((link, index) => (targets[index] === undefined ? [] : [[link, targets[index]]])));
}

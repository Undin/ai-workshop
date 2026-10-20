// What the Node clients scan: a GitHub repository through the GitHub API, or a local directory.
import { openGitHub, parseGitHubUrl, type Fetch } from './core/github.ts';
import type { Source } from './core/scan.ts';
import { openDirectory } from './local.ts';

export type OpenOptions = { fetch: Fetch; token?: string };

/** A GitHub URL is opened on GitHub; anything else is a directory. */
export function openSource(input: string, options: OpenOptions): Promise<Source> {
  return parseGitHubUrl(input) ? openGitHub(input, options) : openDirectory(input);
}

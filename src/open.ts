// What the Node clients scan: a GitHub repository through the GitHub API, or a local directory.
import { lastUpdateOnGitHub, openGitHub, openGitHubOwner, parseGitHubOwnerUrl, parseGitHubUrl, type Fetch } from './core/github.ts';
import type { OrganizationSource, Source } from './core/scan.ts';
import { lastUpdateInDirectory, openDirectory } from './local.ts';

export type OpenOptions = { fetch: Fetch; token?: string };

/** A GitHub URL is opened on GitHub, a repository or an organization; anything else is a directory. */
export function openSource(input: string, options: OpenOptions): Promise<Source | OrganizationSource> {
  if (parseGitHubUrl(input)) return openGitHub(input, options);
  if (parseGitHubOwnerUrl(input)) return openGitHubOwner(input, options);
  return openDirectory(input);
}

/** When a skill was last updated, from its link: on GitHub, or in a local directory. */
export function lastUpdate(link: string, options: OpenOptions): Promise<string> {
  return link.startsWith('file:') ? lastUpdateInDirectory(link) : lastUpdateOnGitHub(link, options);
}

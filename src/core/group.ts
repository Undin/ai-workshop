// What a skill helps with: one group of a fixed list, from its name and first sentence
// (spec/analysis.md, Group). Pure and deterministic: no network, the same skill always in the same group.
import { firstSentence } from './model.ts';

/** The id of a group, the last one Other. */
export type GroupId = 'other' | 'language-engineering' | 'ml' | 'data' | 'performance' | 'debugging' | 'testing' | 'releases' | 'issues' | 'docs' | 'review' | 'git' | 'search' | 'migration' | 'build-ci' | 'ide-plugins' | 'languages' | 'workflow' | 'other';

/** A skill's group: its id, the name shown, its place in the list, where the groups are shown. */
export type Group = { id: GroupId; name: string; order: number };

/** For a skill none of the keywords is in. */
export const OTHER = { id: 'other', name: 'Other' } as const;

/** In the order the groups are shown; a tie goes to the one listed first, so the specific ones come first. */
export const GROUPS: { id: Exclude<GroupId, 'other'>; name: string; keywords: string[] }[] = [
  {
    id: 'language-engineering',
    name: 'Language engineering & DSLs',
    keywords: ['mps', 'dsl', 'dsls', 'language', 'languages', 'lang', 'concept', 'concepts', 'generator', 'generators', 'typesystem', 'textgen', 'baselanguage', 'quotations', 'blueprint', 'blueprints', 'parser', 'aspect', 'aspects', 'smodel', 'devkits'],
  },
  {
    id: 'ml',
    name: 'AI/ML & evaluation',
    keywords: ['ml', 'mlx', 'vlm', 'llm', 'model', 'models', 'quantize', 'hugging face', 'hf', 'harbor', 'dataset', 'datasets', 'rewardkit', 'adapter', 'parity', 'eval', 'evals', 'evaluating', 'evaluation', 'training'],
  },
  {
    id: 'data',
    name: 'Data & analytics',
    keywords: ['data', 'sql', 'database', 'databases', 'redis', 'clickhouse', 'dashboard', 'dashboards', 'query', 'queries', 'schema', 'schemas', 'notebook', 'notebooks', 'datalore', 'analytics'],
  },
  {
    id: 'performance',
    name: 'Performance & benchmarking',
    keywords: ['performance', 'perf', 'benchmark', 'benchmarks', 'benchmarking', 'jmh', 'profile', 'profiling', 'profiler', 'bottleneck', 'bottlenecks', 'counters', 'optimization', 'measurement', 'latency'],
  },
  {
    id: 'debugging',
    name: 'Debugging & diagnostics',
    keywords: ['debug', 'debugging', 'debugger', 'diagnose', 'diagnostics', 'trace', 'tracing', 'crash', 'crashes', 'freezes', 'inspect', 'inspecting', 'inspector', 'leak', 'leaks', 'troubleshoot'],
  },
  { id: 'testing', name: 'Testing', keywords: ['test', 'tests', 'testing', 'junit', 'coverage', 'fourslash', 'conformance', 'e2e', 'qa'] },
  {
    id: 'releases',
    name: 'Releases & changelogs',
    keywords: ['release', 'releases', 'release notes', 'changelog', 'version', 'versions', 'versioning', 'publish', 'tag', 'tagging'],
  },
  {
    id: 'issues',
    name: 'Issues & bug fixing',
    keywords: ['issue', 'issues', 'bug', 'bugs', 'bugfix', 'youtrack', 'triage', 'deduplication', 'duplicate', 'duplicates', 'repro', 'reproduction', 'reproducible'],
  },
  {
    id: 'docs',
    name: 'Documentation & writing',
    keywords: ['doc', 'docs', 'documentation', 'document', 'writerside', 'readme', 'mkdocs', 'snippets', 'presentation', 'pptx', 'slides', 'readability', 'draft', 'rewrite', 'prose', 'reference', 'tutorial'],
  },
  { id: 'review', name: 'Code review & quality', keywords: ['review', 'reviews', 'reviewing', 'lint', 'linting', 'style', 'quality', 'accessibility', 'breaking', 'audit'] },
  {
    id: 'git',
    name: 'Git & pull requests',
    keywords: ['git', 'commit', 'commits', 'push', 'branch', 'branches', 'pull request', 'pull requests', 'pr', 'prs', 'checkout', 'patches', 'rebase', 'merge'],
  },
  {
    id: 'search',
    name: 'Code search & navigation',
    keywords: ['search', 'ssr', 'structural', 'navigate', 'navigating', 'navigation', 'jbcontext', 'research', 'blast', 'impact', 'usages'],
  },
  {
    id: 'migration',
    name: 'Refactoring & migrations',
    keywords: ['migrate', 'migrates', 'migration', 'migrations', 'migrating', 'upgrade', 'upgrading', 'refactor', 'refactoring', 'convert', 'converting', 'deprecations', 'split', 'splits', 'extract', 'drop', 'drops'],
  },
  {
    id: 'build-ci',
    name: 'Build & CI/CD',
    keywords: ['build', 'builds', 'building', 'ci', 'cd', 'github actions', 'gradle', 'bazel', 'maven', 'teamcity', 'pipeline', 'pipelines', 'gn', 'ninja', 'compile', 'compiling', 'module', 'modules', 'dependencies', 'sdk', 'eap', 'nuget', 'packaging', 'distribution', 'ant', 'jps', 'deploy', 'deployment', 'staging'],
  },
  {
    id: 'ide-plugins',
    name: 'IDE & plugin development',
    keywords: ['intellij', 'ide', 'plugin', 'plugins', 'action', 'actions', 'anaction', 'registry', 'icon', 'icons', 'symbol', 'symbols', 'ui', 'dialog', 'dialogs', 'swing', 'panel', 'panels', 'extension', 'extensions', 'eel', 'psi', 'poly', 'jewel', 'completion', 'quickfix'],
  },
  {
    id: 'languages',
    name: 'Languages & frameworks',
    keywords: ['java', 'kotlin', 'php', 'laravel', 'spring', 'android', 'go', 'golang', 'rust', 'python', 'typescript', 'javascript', 'react', 'c', 'swift', 'scala', 'unreal', 'coroutines', 'concurrency', 'multiplatform', 'kmp', 'framework', 'frameworks', 'library', 'libraries', 'engineer'],
  },
  {
    id: 'workflow',
    name: 'Planning & agent workflows',
    keywords: ['plan', 'plans', 'planning', 'brainstorming', 'spec', 'specs', 'todo', 'todos', 'tracks', 'workflow', 'workflows', 'agent', 'agents', 'mcp', 'session', 'handoff', 'workspace', 'onboard', 'onboarding', 'setup', 'delegate', 'junie', 'questions', 'design'],
  },
];

/** The few skills the keywords put in the wrong group, by their exact name. */
export const OVERRIDES: Record<string, GroupId> = {
  nopressure: OTHER.id,
  'ue-code-authoring': 'languages',
  'analysis-api-mark-internal-apis': 'migration',
  'plugin-model-analyzer': 'search',
  'markdown-library-update': 'build-ci',
  'driver-ui-tests': 'testing',
};

/** In the name counts this much; in the first sentence, 1. */
const NAME_WEIGHT = 3;

/** The skill's group: an override, else the one whose keywords it has most; none of them, Other. */
export function groupOf(skill: { name: string; description: string }): GroupId {
  const override = OVERRIDES[skill.name];
  if (override) return override;
  const name = words(skill.name);
  const sentence = words(firstSentence(skill.description));
  let best: { id: GroupId; score: number } = { id: OTHER.id, score: 0 };
  for (const { id, keywords } of GROUPS) {
    const score = keywords.reduce((sum, keyword) => sum + (has(name, keyword) ? NAME_WEIGHT : 0) + (has(sentence, keyword) ? 1 : 0), 0);
    // Strictly higher: a tie stays with the group listed first.
    if (score > best.score) best = { id, score };
  }
  return best.id;
}

/** A group by its id, with its place in the list; Other last. */
export function groupById(id: GroupId): Group {
  const order = GROUPS.findIndex((group) => group.id === id);
  return order < 0 ? { ...OTHER, order: GROUPS.length } : { id, name: GROUPS[order].name, order };
}

/** Lowercase, split at what is not a letter or a digit: `MLX-VLM` → `mlx`, `vlm`. */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The keyword as whole words: `test` is not in `latest`; a keyword of two words, both in a row. */
function has(words: string[], keyword: string): boolean {
  const wanted = keyword.split(' ');
  return words.some((_, at) => wanted.every((word, index) => words[at + index] === word));
}

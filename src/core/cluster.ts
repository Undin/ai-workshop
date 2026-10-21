// What a skill helps with: one group of a fixed list, from its name and first sentence
// (spec/analysis.md, Group). Pure and deterministic: no network, the same skill always in the same group.
import { firstSentence } from './model.ts';

/** A group of skills: its id, the name shown, and the words that put a skill in it. */
export type Cluster = { id: string; name: string; keywords: string[] };

/** For a skill none of the keywords is in. */
export const OTHER = { id: 'other', name: 'Other' };

/** In the order the groups are shown; a tie goes to the one listed first, so the specific ones come first. */
export const CLUSTERS: Cluster[] = [
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
export const OVERRIDES: Record<string, string> = {
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
export function clusterOf(skill: { name: string; description: string }): string {
  const override = OVERRIDES[skill.name];
  if (override) return override;
  const name = words(skill.name);
  const sentence = words(firstSentence(skill.description));
  let best = { id: OTHER.id, score: 0 };
  for (const { id, keywords } of CLUSTERS) {
    const score = keywords.reduce((sum, keyword) => sum + (has(name, keyword) ? NAME_WEIGHT : 0) + (has(sentence, keyword) ? 1 : 0), 0);
    // Strictly higher: a tie stays with the group listed first.
    if (score > best.score) best = { id, score };
  }
  return best.id;
}

/** A group by its id; Other for one not in the list. */
export function cluster(id: string): { id: string; name: string } {
  const found = CLUSTERS.find((cluster) => cluster.id === id);
  return found ? { id: found.id, name: found.name } : OTHER;
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

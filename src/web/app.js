// The web view's page: the repository field, its skills, and the chosen skill's SKILL.md, from
// GET /api/scan; for an organization, its repositories as they are scanned, each linked to its
// own page. A SKILL.md is untrusted: its Markdown is sanitized before it is shown.
import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#scan');
const input = $('#source');
const status = $('#status');
const main = $('main');
const organization = $('#organization');
const filter = $('#filter');

// Links in a SKILL.md open outside the page.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** The scan in progress, so a newer one replaces it. */
let current;
/** The scanned skills, each with its list item, for the filter. */
let listed = [];

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const source = input.value.trim();
  const url = new URL(location.href);
  url.search = source ? `?source=${encodeURIComponent(source)}` : '';
  history.pushState(null, '', url);
  scan(source);
});

filter.addEventListener('input', applyFilter);

addEventListener('popstate', start);
start();

/** The address keeps the repository: a reload or a shared link scans it again. */
function start() {
  const source = new URLSearchParams(location.search).get('source') ?? '';
  input.value = source;
  if (source) return scan(source);
  // Back to no repository: a scan still running must not show its result here.
  current?.abort();
  show('');
}

async function scan(source) {
  current?.abort();
  const controller = (current = new AbortController());
  show(`Scanning ${source || 'nothing'}…`);
  try {
    const response = await fetch(`/api/scan?source=${encodeURIComponent(source)}`, { signal: controller.signal });
    // An organization: a line for each repository as it is scanned.
    if (response.headers.get('content-type')?.startsWith('application/x-ndjson')) {
      return await renderOrganization(lines(response.body), controller.signal);
    }
    const answer = await response.json();
    if (controller.signal.aborted) return;
    if (!response.ok) return show(answer.error ?? `The server answered ${response.status}`, { error: true });
    render(answer);
  } catch (error) {
    if (!controller.signal.aborted) show(`Cannot reach the Skill Atlas server: ${error.message}`, { error: true });
  }
}

/** A message instead of a result, or above `view`: the repository's (`main`) or the organization's; red with `error`. */
function show(message, { view, error = false } = {}) {
  status.hidden = !message;
  status.textContent = message;
  status.classList.toggle('error', error);
  main.hidden = view !== main;
  organization.hidden = view !== organization;
}

function render({ repository, skills, warnings }) {
  show(skills.length ? '' : 'No skills found', { view: main });
  $('#repository').textContent = `${repository.id} · ${count(skills.length, 'skill', 'skills')}`;
  $('#warnings').replaceChildren(...warnings.map((warning) => element('li', `warning: ${warning}`)));

  const items = skills.map((skill) => {
    const button = element('button', '');
    button.type = 'button';
    const name = element('span', skill.name, 'name');
    button.append(name);
    const summary = skill.summary ? element('span', skill.summary, 'summary') : undefined;
    if (summary) {
      summary.title = skill.summary;
      button.append(summary);
    }
    if (skill.copies.length) button.append(element('span', alsoIn(skill), 'copies'));
    button.addEventListener('click', () => choose(skill, button));
    const item = element('li', '');
    item.append(button);
    return { skill, item, button, name, summary };
  });
  $('#skills').replaceChildren(...items.map(({ item }) => item));
  listed = items;
  // A new scan, a new list: the filter starts empty.
  filter.value = '';
  $('#filtering').hidden = !skills.length;
  applyFilter();
  if (skills.length) choose(skills[0], items[0].button);
  else $('#skill').hidden = true;
}

/**
 * The organization's repositories at once, each a link to its own page, then each one's skill
 * count as it is scanned; the warnings as the CLI prints them.
 */
async function renderOrganization(answer, signal) {
  const items = new Map();
  const warnings = $('#organization-warnings');
  let scanned = 0;
  const progress = () => (scanned < items.size ? `Scanned ${scanned} of ${count(items.size, 'repository', 'repositories')}…` : '');
  for await (const line of answer) {
    if (signal.aborted) return;
    if (line.organization) {
      $('#organization-name').textContent = `${line.organization.id} · ${count(line.repositories.length, 'repository', 'repositories')}`;
      warnings.replaceChildren();
      $('#repositories').replaceChildren(
        ...line.repositories.map(({ id, url }) => {
          const link = element('a', '');
          link.href = `/?source=${encodeURIComponent(url)}`;
          const state = element('span', '…', 'count');
          link.append(element('span', id, 'name'), state);
          items.set(id, state);
          const item = element('li', '');
          item.append(link);
          return item;
        }),
      );
      show(line.repositories.length ? progress() : 'No repositories found', { view: organization });
    } else if (line.id) {
      const state = items.get(line.id);
      state.textContent = line.error ? `not scanned: ${line.error}` : count(line.skills, 'skill', 'skills');
      state.classList.toggle('error', !!line.error);
      warnings.append(...(line.warnings ?? []).map((warning) => element('li', `warning: ${line.id}: ${warning}`)));
      scanned++;
      show(progress(), { view: organization });
    } else {
      // GitHub answers no more: the repositories left are not scanned.
      for (const state of items.values()) if (state.textContent === '…') state.textContent = 'not scanned';
      return show(line.error, { view: organization, error: true });
    }
  }
}

/** Each line of an NDJSON body, parsed, as it arrives. */
async function* lines(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parts = (rest + value).split('\n');
    rest = parts.pop();
    for (const part of parts) if (part) yield JSON.parse(part);
  }
  if (rest) yield JSON.parse(rest);
}

/** Keeps the skills whose name or first sentence contains the filter's text, in any case; marks it there. */
function applyFilter() {
  const text = filter.value.trim();
  // The text as it is typed, not a pattern: `.` is a dot.
  const wanted = text && new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  let shown = 0;
  for (const { skill, item, name, summary } of listed) {
    const kept = !wanted || [skill.name, skill.summary].some((field) => field.search(wanted) >= 0);
    item.hidden = !kept;
    if (!kept) continue;
    shown++;
    name.replaceChildren(...highlighted(skill.name, wanted));
    summary?.replaceChildren(...highlighted(skill.summary, wanted));
  }
  $('#shown').textContent = shown ? `Showing ${shown} of ${count(listed.length, 'skill', 'skills')}` : `No skills match ${text}`;
}

/** The skill's SKILL.md: the front matter as a table, the body as Markdown. */
function choose(skill, button) {
  for (const other of document.querySelectorAll('#skills button')) other.removeAttribute('aria-current');
  button.setAttribute('aria-current', 'true');

  $('#skill').hidden = false;
  $('#skill-name').textContent = skill.name;
  // A web page cannot open a file:// link: a local skill shows its path.
  if (skill.link.startsWith('file:')) {
    $('#skill-location').replaceChildren(element('code', decodeURIComponent(new URL(skill.link).pathname)));
  } else {
    const link = element('a', skill.path);
    link.href = skill.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    $('#skill-location').replaceChildren(link);
  }
  $('#skill-copies').textContent = skill.copies.length ? alsoIn(skill) : '';
  $('#skill-copies').hidden = !skill.copies.length;

  const rows = Object.entries({ name: skill.name, description: skill.description, ...skill.properties }).map(([key, value]) => {
    const row = element('tr', '');
    row.append(element('th', key), element('td', typeof value === 'string' ? value : JSON.stringify(value)));
    return row;
  });
  $('#front-matter tbody').replaceChildren(...rows);
  $('#skill-body').innerHTML = DOMPurify.sanitize(marked.parse(skill.body, { async: false }));
}

/** The text, each match of `wanted` in a `<mark>`. */
function highlighted(text, wanted) {
  if (!wanted) return [text];
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(wanted)) {
    parts.push(text.slice(end, match.index), element('mark', match[0]));
    end = match.index + match[0].length;
  }
  parts.push(text.slice(end));
  return parts.filter((part) => part !== '');
}

/** `1 skill`, `2 skills`. */
function count(number, one, many) {
  return `${number} ${number === 1 ? one : many}`;
}

function alsoIn(skill) {
  return `also in ${skill.copies.join(', ')}`;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

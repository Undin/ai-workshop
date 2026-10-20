// The web view's page: the repository field, its skills, and the chosen skill's SKILL.md, from
// GET /api/scan. A SKILL.md is untrusted: its Markdown is sanitized before it is shown.
import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#scan');
const input = $('#source');
const status = $('#status');
const main = $('main');
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
    const answer = await response.json();
    if (controller.signal.aborted) return;
    if (!response.ok) return show(answer.error ?? `The server answered ${response.status}`, { error: true });
    render(answer);
  } catch (error) {
    if (!controller.signal.aborted) show(`Cannot reach the Skill Atlas server: ${error.message}`, { error: true });
  }
}

/** A message instead of the result, or above it with `withResult`; red with `error`. */
function show(message, { withResult = false, error = false } = {}) {
  status.hidden = !message;
  status.textContent = message;
  status.classList.toggle('error', error);
  main.hidden = !withResult;
}

function render({ repository, skills, warnings }) {
  show(skills.length ? '' : 'No skills found', { withResult: true });
  $('#repository').textContent = `${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`;
  $('#warnings').replaceChildren(...warnings.map((warning) => element('li', `warning: ${warning}`)));

  const items = skills.map((skill) => {
    const button = element('button', '');
    button.type = 'button';
    button.append(element('span', skill.name, 'name'));
    if (skill.summary) {
      const summary = element('span', skill.summary, 'summary');
      summary.title = skill.summary;
      button.append(summary);
    }
    if (skill.copies.length) button.append(element('span', alsoIn(skill), 'copies'));
    button.addEventListener('click', () => choose(skill, button));
    const item = element('li', '');
    item.append(button);
    return { skill, item, button };
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

/** Keeps the skills whose name or first sentence contains the filter's text, in any case. */
function applyFilter() {
  const text = filter.value.trim();
  const wanted = text.toLowerCase();
  let shown = 0;
  for (const { skill, item } of listed) {
    const kept = !wanted || [skill.name, skill.summary].some((field) => field.toLowerCase().includes(wanted));
    item.hidden = !kept;
    if (kept) shown++;
  }
  $('#shown').textContent = shown ? `Showing ${shown} of ${listed.length} ${listed.length === 1 ? 'skill' : 'skills'}` : `No skills match ${text}`;
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

function alsoIn(skill) {
  return `also in ${skill.copies.join(', ')}`;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

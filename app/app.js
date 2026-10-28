// Apus page: choices, settings and results. The work happens in worker.js; the texts are in i18n.js.
import { applyLang, getLang, num, setLang, t, tn, translatePy } from './i18n.js';

const $ = (id) => document.getElementById(id);
const AUDIO = /\.(wav|flac|ogg|mp3|m4a|aiff?)$/i;
const FIELDS = ['threshold', 'hop_s', 'top_k', 'csv_separator', 'raven_tables', 'extract_clips', 'clips_per_band',
                'clip_extra_s', 'clip_species', 'resume', 'backend', 'notify'];
const state = { recordings: null, inputDir: null, top: null, list: null, listPath: null, listLabel: null,
                synonyms: null, folder: null, ready: false, running: false, lastRun: null, backend: null,
                names: [], built: [], modelSpeed: null, check: null, result: null, chip: ['Loading', null, ''],
                counts: null, species: null, ref: null, other: null, cal: null, cmp: null, act: null };
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } };

// ── Settings, saved in this browser ───────────────────────────────────────────────────────────────────────
const valueOf = (el) => (el.type === 'checkbox' ? el.checked : el.value);
function loadSettings() {
  const saved = load('apus.settings', {});
  for (const k of FIELDS) {
    if (!(k in saved)) continue;
    if ($(k).type === 'checkbox') $(k).checked = saved[k]; else $(k).value = saved[k];
  }
}
const saveSettings = () => save('apus.settings', Object.fromEntries(FIELDS.map((k) => [k, valueOf($(k))])));
const minTopK = () => Math.floor(1 / Number($('threshold').value) + 1e-9);
let topKRaised = null;
function checkTopK() {
  const min = minTopK();
  if (Number.isFinite(min) && Number($('top_k').value) < min) { $('top_k').value = min; topKRaised = min; }
  topKHint();
}
function topKHint() {
  $('top-k-hint').textContent = topKRaised ? t('Raised to {n}: up to {n} species can reach this threshold in one window', { n: topKRaised })
    : t('The best-scoring species of each window');
}
function settingsLine() {                            // the key settings, repeated beside the Run button
  $('settings-text').textContent = t('Threshold {t} · {h} s hop · {k} species per window',
    { t: num(Number($('threshold').value), 2), h: num(Number($('hop_s').value)), k: $('top_k').value });
}
loadSettings();
$('threshold-range').value = $('threshold').value;
$('clip-options').hidden = !$('extract_clips').checked;
for (const k of FIELDS) $(k).addEventListener('change', () => { checkTopK(); saveSettings(); settingsLine(); });
$('threshold-range').addEventListener('input', () => { $('threshold').value = Number($('threshold-range').value).toFixed(2); settingsLine(); });
$('threshold-range').addEventListener('change', () => $('threshold').dispatchEvent(new Event('change')));
$('threshold').addEventListener('input', () => { $('threshold-range').value = $('threshold').value; });
$('extract_clips').addEventListener('change', () => { $('clip-options').hidden = !$('extract_clips').checked; });
$('backend').addEventListener('change', () => location.reload());
$('hop_s').addEventListener('change', () => requestCheck());

// ── Day and night, language, help ─────────────────────────────────────────────────────────────────────────
// The page follows the system until the user picks the other mode; picking the system's mode follows it again
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light')) === 'dark';
function labelTheme() {
  const label = isDark() ? t('Day mode') : t('Night mode');
  $('theme').setAttribute('aria-label', label);
  $('theme').title = label;
}
$('theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  const differs = (next === 'dark') !== systemDark.matches;
  if (differs) document.documentElement.dataset.theme = next;
  else delete document.documentElement.dataset.theme;
  try { if (differs) localStorage.setItem('apus.theme', next); else localStorage.removeItem('apus.theme'); }
  catch { /* storage blocked: the choice lasts until the page closes */ }
  labelTheme();
  redrawSpectrograms();
});
systemDark.addEventListener('change', () => { labelTheme(); redrawSpectrograms(); });

function labelLang() {                               // the button offers the other language, named in it
  const other = getLang() === 'es' ? ['en', 'EN', 'English'] : ['es', 'ES', 'Español'];
  $('lang').textContent = other[1];
  $('lang').lang = other[0];
  $('lang').setAttribute('aria-label', other[2]);
  $('lang').title = other[2];
}
$('lang').addEventListener('click', () => { setLang(getLang() === 'es' ? 'en' : 'es'); relabel(); });

document.addEventListener('click', (e) => {          // "?" buttons open and close their help text
  const b = e.target.closest('button.help');
  if (!b) return;
  const open = b.getAttribute('aria-expanded') !== 'true';
  b.setAttribute('aria-expanded', String(open));
  $(b.getAttribute('aria-controls')).hidden = !open;
});

// Every text the page writes itself, again in the current language
function relabel() {
  if (!state.running) document.title = pageTitle();
  labelLang();
  labelTheme();
  topKHint();
  settingsLine();
  chip(...state.chip);
  recordingsSummary();
  renderCheck();
  listName();
  $('syn-name').textContent = state.synonyms ? state.synonyms.file.name : t('None');
  compareNames();
  outputLabels();
  updateRun();
  utcOffsets();
  if (state.result) renderResults(false);
}

// ── The worker ────────────────────────────────────────────────────────────────────────────────────────────
const worker = new Worker('worker.js', { type: 'module' });
worker.postMessage({ type: 'init', backend: $('backend').value });
worker.onmessage = ({ data }) => handlers[data.type]?.(data);

function chip(text, progress, mode = '') {
  state.chip = [text, progress, mode];
  const shown = progress == null ? t(text) : `${t(text)}: ${Math.round(progress * 100)}%`;
  $('model-text').textContent = mode === 'ready' ? t('Model ready · {backend}', { backend: translatePy(text) }) : shown;
  $('model-bar').style.width = progress == null ? '0' : `${Math.round(progress * 100)}%`;
  $('model').classList.toggle('ready', mode === 'ready');
  $('model').classList.toggle('failed', mode === 'failed');
}
function alertBox(text) { $('alert').hidden = !text; $('alert').textContent = text || ''; }
function log(lines) {
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = translatePy(line);
    $('log').append(li);
  }
}

const handlers = {
  status: ({ text, progress }) => {
    if (state.running) $('progress-text').textContent = translatePy(text);
    else chip(text, progress);
  },
  ready: ({ backend, note, names, speed }) => {
    state.ready = true;
    state.backend = backend;
    state.names = names;
    state.modelSpeed = speed;
    chip(backend, null, 'ready');
    if (note) log([note]);
    if (!self.crossOriginIsolated) log(['This page is not cross-origin isolated, so the CPU uses one thread (slower).']);
    updateRun();
    requestCheck();
    reopenLast();
  },
  log: ({ lines }) => log(lines),
  progress: ({ file, i, n, done, total, rate }) => {
    const pct = (100 * done) / Math.max(total, 1);
    $('bar-fill').style.width = `${pct}%`;
    $('bar').setAttribute('aria-valuenow', Math.round(pct));
    $('progress-pct').textContent = `${Math.floor(pct)}%`;
    document.title = `${Math.floor(pct)}% · Apus`;
    $('progress-text').textContent = t('Recording {i} of {n}: {file} · {rate} windows/s · {left} left',
      { i, n, file, rate: num(rate, 1), left: duration((total - done) / Math.max(rate, 1e-9), true) });
  },
  'confirm-replace': async () => {
    if (await ask(t('The output already holds results. Replace them with this run?'), t('Replace'), true)) start(true);
    else finish();
  },
  done: ({ result, backend, saved, windows, seconds, prepSeconds, modelSeconds }) => {
    finish();
    if (windows >= 20) save('apus.speed', { ...load('apus.speed', {}), [backend]: windows / seconds });
    save('apus.last', { where: saved, at: Date.now() });
    showResults(result, { backend, saved, windows, seconds, folder: state.lastRun.folder });
    log([`Timing: ${windows} windows in ${seconds.toFixed(1)} s: preparing audio ${prepSeconds.toFixed(1)} s, ` +
         `model ${modelSeconds.toFixed(1)} s.`]);
    notify(t('Done: {d} detections of {s} species.', { d: sum(result.species, 'detections'), s: result.species.length }));
  },
  stopped: () => {
    finish();
    alertBox(t('Stopped. Run again with "Continue a stopped run" on (in Advanced) to carry on where it stopped.'));
    notify(t('The run was stopped.'));
  },
  reopened: ({ result, saved, modified }) => {
    if (!result) return;
    showResults(result, { saved, modified, reopened: true, folder: saved === 'folder' ? state.folder : null });
  },
  checked: ({ summary }) => { state.check = summary; renderCheck(); },
  cleared: ({ shown }) => {
    if (load('apus.last', {}).where === 'browser') save('apus.last', null);
    if (shown) { state.result = null; $('results').hidden = true; $('results-empty').hidden = state.running; }
    alertBox('');
  },
  counts: ({ counts }) => { state.counts = counts; renderSpeciesList(); },
  species: ({ data, counts, keepScroll }) => {
    state.counts = counts;
    renderSpeciesList();
    if (keepScroll && state.species?.species === data.species) updateSpecies(data); else renderSpecies(data);
  },
  clip: (data) => gotClip(data),
  'tool-status': ({ for: tool, text }) => { const el = toolStatus[tool]; if (el) $(el).textContent = t(text); },
  calibrated: ({ data }) => { state.cal = data; $('cal-status').textContent = ''; renderCal(); renderMethods(); },
  compared: ({ data }) => { state.cmp = data; $('cmp-status').textContent = ''; renderCmp(); renderMethods(); },
  times: ({ data }) => { state.act = data; $('act-status').textContent = ''; renderAct(); },
  error: ({ message, for: request, key }) => {
    if (toolStatus[request]) { $(toolStatus[request]).textContent = translatePy(message); return; }
    if (request === 'clip') { clipFailed(key, message); return; }
    if (request === 'check') { state.check = { error: message }; renderCheck(); return; }
    if (request === 'reopen') return;                          // nothing to reopen: the empty page is right
    if (request === 'clear') { alertBox(t('The stored results could not be deleted: {e}', { e: message })); return; }
    finish();
    if (!state.ready) chip('The model could not start', null, 'failed');
    alertBox(translatePy(message));
    if (request === 'run') notify(translatePy(message));
  },
};
const toolStatus = { calibrate: 'cal-status', compare: 'cmp-status', times: 'act-status', species: 'cal-status' };

// A confirmation that names its consequence; resolves true when the user picks `yes`
function ask(text, yes, destructive = false) {
  const dialog = $('ask');
  $('ask-text').textContent = text;
  $('ask-yes').textContent = yes;
  $('ask-yes').classList.toggle('danger', destructive);
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }));
}

// ── Choices ───────────────────────────────────────────────────────────────────────────────────────────────
const pick = (button, input) => $(button).addEventListener('click', () => $(input).click());
pick('pick-folder', 'folder-input');
pick('pick-files', 'files-input');
pick('pick-list-file', 'list-file-input');
pick('pick-list-folder', 'list-folder-input');
pick('pick-syn', 'syn-input');

const topFolder = (f) => f.webkitRelativePath.split('/')[0];
const sizeText = (bytes) => (bytes < 1e8 ? `${num(Math.max(1, Math.round(bytes / 1e6)))} MB` : `${num(bytes / 1e9, 1)} GB`);

// `items` are {file, rel}: rel is the path inside the chosen folder, starting with its name, or the file's name
function setRecordings(items, folder) {
  const audio = items.filter(({ file }) => AUDIO.test(file.name));
  if (!audio.length) { alertBox(t('There are no audio files there. Choose WAV, FLAC or OGG files, or a folder of them.')); return; }
  alertBox('');
  const top = folder ? items[0].rel.split('/')[0] : 'recordings';
  state.inputDir = `in/${top}`;
  state.recordings = items.map(({ file, rel }) => ({ path: `in/${folder ? rel : `recordings/${file.name}`}`, file }));
  const datasets = new Set(audio.map(({ rel }) => { const parts = rel.split('/'); return parts.length > 2 ? parts[1] : top; }));
  state.picked = { n: audio.length, datasets: datasets.size, bytes: audio.reduce((s, { file }) => s + file.size, 0),
                   from: folder ? top : null };
  state.check = null;
  $('recordings').classList.add('chosen');
  recordingsSummary();
  updateRun();
  requestCheck();
}
function recordingsSummary() {
  const p = state.picked;
  $('recordings-summary').textContent = !p
    ? t('Drop a folder or audio files here, or choose them. Each sub-folder is one dataset, such as a site or a recorder.')
    : `${tn(p.n, '{n} recording', '{n} recordings')} ${tn(p.datasets, 'in {n} dataset', 'in {n} datasets')} (${sizeText(p.bytes)})` +
      (p.from ? ` ${t('from {name}', { name: p.from })}` : '');
}
$('folder-input').addEventListener('change', (e) =>
  setRecordings([...e.target.files].map((f) => ({ file: f, rel: f.webkitRelativePath })), true));
$('files-input').addEventListener('change', (e) =>
  setRecordings([...e.target.files].map((f) => ({ file: f, rel: f.name })), false));

// Drag and drop anywhere on the page: one folder is read like a chosen folder, loose files like chosen files
async function walk(entry, out) {
  if (entry.isFile) {
    out.push({ file: await new Promise((ok, fail) => entry.file(ok, fail)), rel: entry.fullPath.replace(/^\//, '') });
    return;
  }
  const reader = entry.createReader();     // gives a folder's entries in batches, then an empty one
  for (let batch; (batch = await new Promise((ok, fail) => reader.readEntries(ok, fail))).length;) {
    for (const child of batch) await walk(child, out);
  }
}
addEventListener('dragover', (e) => {
  e.preventDefault();                      // also stops the browser from opening a file dropped elsewhere
  if (!state.running) document.body.classList.add('dragging');
});
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
// What was dropped, as {items, folder}; throws with the message to show (`mixed`: for a folder dropped with more)
async function droppedItems(e, mixed) {
  const entries = [...e.dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);  // read before any await
  const folders = entries.filter((entry) => entry.isDirectory);
  if (folders.length && entries.length > 1) throw new Error(mixed);
  if (!entries.length) return { items: [...e.dataTransfer.files].map((f) => ({ file: f, rel: f.name })), folder: false };
  const items = [];
  try { for (const entry of entries) await walk(entry, items); }
  catch { throw new Error('That folder could not be read. Choose it with "Choose a folder" instead.'); }
  return { items, folder: folders.length === 1 };
}
addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  if (state.running) return;
  try {
    const { items, folder } = await droppedItems(e, 'Drop one folder, or one or more audio files.');
    setRecordings(items, folder);
  } catch (err) { alertBox(t(err.message)); }
});

// ── The recordings check: from the files' headers, with an estimated run time ────────────────────────────
function requestCheck() {
  if (!state.recordings || !state.ready || state.running) return;
  state.check = { pending: true };
  renderCheck();
  worker.postMessage({ type: 'check', files: state.recordings, inputDir: state.inputDir, hop_s: Number($('hop_s').value) });
}
function duration(seconds, about = false) {
  const s = Math.max(0, Math.round(seconds));
  let text;
  if (s < 90) text = t('{n} s', { n: Math.max(1, s) });
  else if (s < 5400) text = t('{n} min', { n: Math.round(s / 60) });
  else if (s < 172800) text = t('{h} h {m} min', { h: Math.floor(s / 3600), m: Math.round((s % 3600) / 60) });
  else text = t('{n} days', { n: num(s / 86400, 1) });
  return about && s >= 90 ? t('about {x}', { x: text }) : text;
}
function speedEstimate() {
  const measured = load('apus.speed', {})[state.backend];
  if (measured) return { speed: measured, rough: false };
  return state.modelSpeed ? { speed: state.modelSpeed * 0.5, rough: true } : null;
}
function renderCheck() {
  const box = $('check'), c = state.check;
  box.hidden = !c;
  if (!c) return;
  if (c.pending) { box.innerHTML = `<p class="hint">${esc(t('Checking the recordings…'))}</p>`; return; }
  if (c.error) { box.innerHTML = `<p class="hint">${esc(t('The recordings could not be checked: {e}', { e: translatePy(c.error) }))}</p>`; return; }
  const est = speedEstimate();
  const facts = [t('{d} of audio', { d: duration(c.seconds) }), tn(c.windows, '{n} window of 5 s', '{n} windows of 5 s')];
  if (est) facts.push(t(est.rough ? 'about {x} to analyse (a rough first estimate)' : 'about {x} to analyse',
                        { x: duration(c.windows / est.speed) }));
  const rates = Object.entries(c.rates).sort((a, b) => b[1] - a[1]).map(([sr, n]) => `${num(Number(sr) / 1000, 1)} kHz (${n})`);
  const issues = [
    [c.unreadable, (n) => tn(n, '{n} file cannot be read and will be skipped', '{n} files cannot be read and will be skipped'), (r) => `${r[0]}: ${translatePy(r[1])}`],
    [c.low_rate, (n) => tn(n, '{n} file is below 32 kHz: it holds no sound above half its sample rate', '{n} files are below 32 kHz: they hold no sound above half their sample rate'), (r) => `${r[0]} (${num(r[1] / 1000, 2)} kHz)`],
    [c.lossy, (n) => tn(n, '{n} file is compressed with loss (MP3, Vorbis or Opus), which can blur high frequencies', '{n} files are compressed with loss (MP3, Vorbis or Opus), which can blur high frequencies'), (r) => `${r[0]} (${r[1]})`],
    [c.short, (n) => tn(n, '{n} file is shorter than 5 s and is padded with silence', '{n} files are shorter than 5 s and are padded with silence'), (r) => `${r[0]} (${num(r[1])} s)`],
  ].filter(([rows]) => rows.length);
  box.innerHTML = `<p class="check-facts">${facts.map(esc).join(' · ')}</p>` +
    `<p class="hint">${esc(t('Sample rates: {r}', { r: rates.join(', ') }))}</p>` +
    issues.map(([rows, head, line]) => `<details class="issue"><summary><svg aria-hidden="true"><use href="#i-warn"/></svg>${esc(head(rows.length))}</summary>` +
      `<ul>${rows.slice(0, 50).map((r) => `<li>${esc(line(r))}</li>`).join('')}${rows.length > 50 ? `<li>…</li>` : ''}</ul></details>`).join('');
}

// ── Species lists: files, a folder, or a list built here ─────────────────────────────────────────────────
function setList(files, folder) {
  if (!files.length) return;
  state.list = files.map((f) => ({ path: `lists/${folder ? f.webkitRelativePath : f.name}`, file: f }));
  state.listPath = `/data/lists/${folder ? topFolder(files[0]) : files[0].name}`;
  state.listLabel = folder ? { folder: topFolder(files[0]), n: files.length } : { file: files[0].name };
  save('apus.listSource', 'file');
  listName();
}
function listName() {
  const l = state.listLabel;
  $('list-name').textContent = !l ? t('None: every species the model knows is kept')
    : l.built ? tn(l.built, 'Your list ({n} species)', 'Your list ({n} species)')
      : l.folder ? `${l.folder} (${tn(l.n, '{n} file', '{n} files')})` : l.file;
  $('list-name').parentElement.classList.toggle('set', !!l);
  $('clear-list').hidden = !l;
}
$('list-file-input').addEventListener('change', (e) => setList([...e.target.files], false));
$('list-folder-input').addEventListener('change', (e) => setList([...e.target.files], true));
$('clear-list').addEventListener('click', () => {
  state.list = state.listPath = state.listLabel = null;
  save('apus.listSource', null);
  listName();
});
function useBuilt(names) {
  state.built = names;
  save('apus.builtList', names);
  if (!names.length) { $('clear-list').click(); return; }
  const text = `${names.join('\n')}\n`;
  state.list = [{ path: 'lists/apus_species_list.txt', file: new File([text], 'apus_species_list.txt', { type: 'text/plain' }) }];
  state.listPath = '/data/lists/apus_species_list.txt';
  state.listLabel = { built: names.length };
  save('apus.listSource', 'built');
  listName();
}
if (load('apus.listSource', null) === 'built' && load('apus.builtList', []).length) useBuilt(load('apus.builtList', []));
else state.built = load('apus.builtList', []);

let draft = [];
function renderBuilder() {
  const q = $('builder-search').value.trim().toLowerCase();
  const chosen = new Set(draft);
  let matches = [];
  if (q.length >= 2) {
    const starts = [], contains = [];
    for (const name of state.names) {
      const n = name.toLowerCase();
      if (n.startsWith(q)) starts.push(name); else if (n.includes(q)) contains.push(name);
      if (starts.length >= 60) break;
    }
    matches = [...starts, ...contains].slice(0, 60);
  }
  $('builder-results').innerHTML = q.length < 2 ? `<li class="hint">${esc(t('Type at least two letters.'))}</li>`
    : !matches.length ? `<li class="hint">${esc(t('No class matches.'))}</li>`
      : matches.map((name) => `<li><button type="button" class="pick-name" data-name="${esc(name)}" ${chosen.has(name) ? 'disabled' : ''}>` +
        `<span class="sp">${esc(name)}</span><span class="add">${esc(chosen.has(name) ? t('Added') : t('Add'))}</span></button></li>`).join('');
  $('builder-chosen').innerHTML = draft.length ? draft.map((name) => `<li><span class="sp">${esc(name)}</span>` +
    `<button type="button" class="link" data-remove="${esc(name)}" aria-label="${esc(t('Remove {name}', { name }))}">${esc(t('Remove'))}</button></li>`).join('')
    : `<li class="hint">${esc(t('No species yet.'))}</li>`;
  $('builder-count').textContent = draft.length ? `(${draft.length})` : '';
}
$('build-list').addEventListener('click', () => {
  if (!state.names.length) { alertBox(t('Wait for the model to load: the list of its species comes with it.')); return; }
  draft = [...state.built];
  $('builder-search').value = '';
  renderBuilder();
  $('builder').returnValue = '';
  $('builder').showModal();
});
let builderTimer;
$('builder-search').addEventListener('input', () => { clearTimeout(builderTimer); builderTimer = setTimeout(renderBuilder, 120); });
$('builder-results').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-name]');
  if (!b) return;
  draft = [...draft, b.dataset.name].sort();
  renderBuilder();
});
$('builder-chosen').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-remove]');
  if (!b) return;
  draft = draft.filter((n) => n !== b.dataset.remove);
  renderBuilder();
});
$('builder-download').addEventListener('click', () => downloadText('apus_species_list.txt', `${draft.join('\n')}\n`));
$('builder').addEventListener('close', () => { if ($('builder').returnValue === 'yes') useBuilt(draft); });

$('syn-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.synonyms = { path: `syn/${f.name}`, file: f };
  $('syn-name').textContent = f.name;
  $('syn-name').parentElement.classList.add('set');
  $('clear-syn').hidden = false;
});
$('clear-syn').addEventListener('click', () => {
  state.synonyms = null;
  $('syn-name').textContent = t('None');
  $('syn-name').parentElement.classList.remove('set');
  $('clear-syn').hidden = true;
});

// ── The output folder (Chrome, Edge), remembered between visits ──────────────────────────────────────────
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('apus', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const idbGet = (key) => idb('readonly', (s) => s.get(key)).catch(() => null);
const idbSet = (key, value) => idb('readwrite', (s) => (value == null ? s.delete(key) : s.put(value, key))).catch(() => null);

function outputLabels() {
  if (!('showDirectoryPicker' in self)) {
    $('output-hint').textContent = t('The results stay in this browser, and you download them as a ZIP file at the end.');
    return;
  }
  $('output-name').textContent = state.folder ? state.folder.name : t('No folder chosen');
  $('folder-row').classList.toggle('set', !!state.folder);
  $('clear-output').hidden = !state.folder;
  $('output-hint').textContent = state.folder ? '' : t('Recommended: the results are written there as the run goes. Without a folder, they stay in this browser and you download them as a ZIP file at the end.');
}
if ('showDirectoryPicker' in self) {
  $('folder-row').hidden = false;
  $('pick-output').addEventListener('click', async () => {
    try {
      state.folder = await showDirectoryPicker({ id: 'apus-output', mode: 'readwrite' });
      idbSet('output', state.folder);
      outputLabels();
    } catch { /* cancelled */ }
  });
  $('clear-output').addEventListener('click', () => { state.folder = null; idbSet('output', null); outputLabels(); });
}
outputLabels();
const folderReady = idbGet('output').then((handle) => { if (handle) { state.folder = handle; outputLabels(); } });

async function writable(folder) {                    // asks again for a folder remembered from an earlier visit
  try {
    if ((await folder.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await folder.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch { return false; }
}

$('clear-stored').addEventListener('click', async () => {
  if (!await ask(t('Delete the results stored in this browser? Results saved in folders are kept.'), t('Delete'), true)) return;
  worker.postMessage({ type: 'clear' });              // in the worker's queue: a run asked for next waits for it
});

// The last results, when the page opens: from this browser at once, from a folder after one click
async function reopenLast() {
  const last = load('apus.last', null);
  if (state.result || state.running) return;
  if (!last || last.where === 'browser') { worker.postMessage({ type: 'reopen' }); return; }
  await folderReady;
  if (last.where !== 'folder' || !state.folder) return;
  $('reopen').hidden = false;
  $('reopen').textContent = t('Reopen the results in {name}', { name: state.folder.name });
}
$('reopen').addEventListener('click', async () => {
  if (!(await writable(state.folder))) { alertBox(t('Apus may not open the folder {name}. Choose it again.', { name: state.folder.name })); return; }
  $('reopen').hidden = true;
  worker.postMessage({ type: 'reopen', folder: state.folder });
});

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────────────
function updateRun() {
  $('run').disabled = !(state.ready && state.recordings) || state.running;
  $('run-hint').textContent = !state.recordings ? t('Choose your recordings first.')
    : !state.ready ? t('Waiting for the model to load…') : '';
  $('run-hint').hidden = !$('run-hint').textContent;
  $('settings-line').hidden = !$('run-hint').hidden;
  $('cmp-run').disabled = !state.ref || !state.result;
}

let wakeLock = null;
async function start(replace = false) {
  checkTopK();
  if (state.folder && !(await writable(state.folder))) {
    alertBox(t('Apus may not write into the folder {name}. Choose it again.', { name: state.folder.name }));
    return;
  }
  const clipSpecies = $('clip_species').value.split(',').map((s) => s.trim()).filter(Boolean);
  const settings = {
    threshold: Number($('threshold').value), hop_s: Number($('hop_s').value), top_k: Number($('top_k').value),
    csv_separator: $('csv_separator').value, raven_tables: $('raven_tables').checked, resume: $('resume').checked,
    species_list: state.listPath, synonyms_file: state.synonyms ? `/data/${state.synonyms.path}` : null,
    extract_clips: $('extract_clips').checked, clips_per_band: Number($('clips_per_band').value),
    clip_extra_s: Number($('clip_extra_s').value), clip_species: clipSpecies.length ? clipSpecies : null,
  };
  const files = [...state.recordings, ...(state.list || []), ...(state.synonyms ? [state.synonyms] : [])];
  state.running = true;
  state.lastRun = { folder: state.folder, settings, list: !!state.listPath };
  alertBox('');
  $('log').replaceChildren();
  $('results').hidden = true;
  $('results-empty').hidden = true;
  $('progress').hidden = false;
  $('bar-fill').style.width = '0';
  $('bar').setAttribute('aria-valuenow', 0);
  $('progress-pct').textContent = '0%';
  $('progress-text').textContent = t('Starting…');
  $('stop').hidden = false;
  updateRun();
  navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
  worker.postMessage({ type: 'run', files, inputDir: state.inputDir, settings, folder: state.folder, replace });
}
function finish() {
  state.running = false;
  $('stop').hidden = true;
  $('progress').hidden = true;
  $('results-empty').hidden = !$('results').hidden;    // back after a stop or an error; showResults hides it
  document.title = pageTitle();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  updateRun();
}
const pageTitle = () => t('Apus · Perch 2.0 in your browser');   // during a run the tab shows the progress instead
$('run').addEventListener('click', () => start(false));
$('stop').addEventListener('click', () => { worker.postMessage({ type: 'stop' }); $('progress-text').textContent = t('Stopping…'); });
addEventListener('beforeunload', (e) => { if (state.running) e.preventDefault(); });

// A system notification when a long run ends while the page is out of sight (asked for in Output)
$('notify').addEventListener('change', async () => {
  $('notify-hint').hidden = true;
  if (!$('notify').checked) return;
  if (!('Notification' in self)) { $('notify').checked = false; $('notify-hint').hidden = false; $('notify-hint').textContent = t('This browser cannot show notifications.'); }
  else if ((await Notification.requestPermission()) !== 'granted') {
    $('notify').checked = false;
    $('notify-hint').hidden = false;
    $('notify-hint').textContent = t('Notifications are blocked for this page. Allow them in the browser\'s site settings.');
  }
  saveSettings();
});
function notify(text) {
  if (!$('notify').checked || document.visibilityState === 'visible' || !('Notification' in self)
      || Notification.permission !== 'granted') return;
  try { new Notification('Apus', { body: text, icon: 'icons/favicon-32.png' }); } catch { /* not allowed here */ }
}

// ── Results ───────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) ? num(v, 3) : v == null ? '' : typeof v === 'number' ? num(v) : String(v));

function table(el, rows, columns, italic, onRow) {
  let sortKey = null, asc = false;
  const render = () => {
    const sorted = sortKey == null ? rows : [...rows].sort((a, b) =>
      (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * (asc ? 1 : -1));
    const head = `<thead><tr>${columns.map(([k, label]) => `<th scope="col" data-k="${k}"` +
      `${k === sortKey ? ` aria-sort="${asc ? 'ascending' : 'descending'}"` : ''}><button type="button">${esc(t(label))}</button></th>`).join('')}</tr></thead>`;
    const body = sorted.map((r) => `<tr data-i="${rows.indexOf(r)}">${columns.map(([k], j) =>
      `<td class="${j === 0 && italic ? 'species' : ''}">${j === 0 && onRow ? `<button type="button" class="row-link">${esc(fmt(r[k]))}</button>` : esc(fmt(r[k]))}</td>`).join('')}</tr>`).join('');
    el.innerHTML = `${head}<tbody>${body}</tbody>`;
    el.querySelectorAll('th').forEach((th) => th.firstChild.addEventListener('click', () => {
      asc = sortKey === th.dataset.k ? !asc : th.dataset.k === columns[0][0];
      sortKey = th.dataset.k;
      render();
      el.querySelector(`th[data-k="${sortKey}"] button`).focus();
    }));
    if (onRow) el.querySelectorAll('.row-link').forEach((b) => b.addEventListener('click', () => onRow(rows[b.closest('tr').dataset.i])));
  };
  render();
}

// A bar list of the most detected species, each value at the tip of its bar; the species table has every value
function chart(rows) {
  const top = rows.slice(0, 20);
  if (!top.length) { $('chart').innerHTML = `<p class="hint">${esc(t('No detections at this threshold: try a lower one.'))}</p>`; return; }
  const max = Math.max(...top.map((r) => r.detections));
  $('chart').innerHTML = `<ol class="bars" aria-label="${esc(t('Detections of the {n} most detected species', { n: top.length }))}">${top.map((r) => {
    const name = esc(r.species);
    return `<li title="${name}: ${r.detections}"><button type="button" class="name" data-species="${name}">${name}</button>` +
      `<span class="track"><span class="fill" style="--f: ${r.detections / max}"></span><span class="n">${num(r.detections)}</span></span></li>`;
  }).join('')}</ol>`;
}
$('chart').addEventListener('click', (e) => { const b = e.target.closest('[data-species]'); if (b) openSpecies(b.dataset.species); });

function showResults(result, opts) {
  state.result = { result, opts };
  state.counts = state.species = state.cal = state.cmp = state.act = null;
  clips.clear();
  renderResults(true);
  $('results').hidden = false;
  $('results-empty').hidden = true;
  if (!opts.reopened) {
    $('announce').textContent = t('Done: {d} detections of {s} species.', { d: sum(result.species, 'detections'), s: result.species.length });
    $('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    $('results').focus({ preventScroll: true });
  }
  selectTab(load('apus.tab', 'summary'), false);
}

function renderResults(first) {
  const { result, opts } = state.result;
  const d = sum(result.species, 'detections');
  const items = [['Recordings', sum(result.datasets, 'recordings_analysed')], ['Datasets', result.datasets.length],
                 ['Detections', d], ['Species', result.species.length]];
  if (opts.seconds) items.push(['Run time', duration(opts.seconds)]);
  $('tiles').innerHTML = items.map(([label, value]) =>
    `<div class="tile"><span class="label">${esc(t(label))}</span><span class="value">${esc(typeof value === 'number' ? num(value) : value)}</span></div>`).join('');
  $('results-when').hidden = !opts.reopened;
  if (opts.reopened) {
    $('results-when').textContent = t('Results of {date}, reopened. To listen to detections or compare, choose the same recordings and press Analyse: analysed recordings are skipped.',
      { date: new Date(opts.modified).toLocaleString(getLang(), { dateStyle: 'medium', timeStyle: 'short' }) });
  }
  $('summary').innerHTML = result.lines.map((l) => `<p>${esc(translatePy(l))}</p>`).join('') +
    (opts.seconds ? `<p>${esc(t('Run on {backend}: {w} windows in {s}.', { backend: opts.backend, w: num(opts.windows), s: duration(opts.seconds) }))}</p>` : '');
  $('failed').hidden = !result.failed.length;
  $('failed').innerHTML = result.failed.length ? '<svg aria-hidden="true"><use href="#i-warn"/></svg>' +
    `<strong>${esc(tn(result.failed.length, '{n} recording was not analysed', '{n} recordings were not analysed'))}</strong>` +
    `<ul>${result.failed.map((f) => `<li>${esc(f.file)}: ${esc(translatePy(f.error))}</li>`).join('')}</ul>` : '';
  table($('species-table'), result.species, [['species', 'Species'], ['detections', 'Detections'],
    ['recordings', 'Recordings'], ['datasets', 'Datasets'], ['mean_confidence', 'Mean confidence'],
    ['max_confidence', 'Highest confidence']], true, (r) => openSpecies(r.species));
  table($('dataset-table'), result.datasets, [['dataset', 'Dataset'], ['recordings_analysed', 'Recordings analysed'],
    ['recordings_with_detections', 'With detections'], ['detections', 'Detections'], ['species', 'Species']], false);
  chart(result.species);
  if (first) log([...result.messages, ...result.failed.map((f) => `⚠ Not analysed: ${f.file} (${f.error})`)]);
  const downloads = $('downloads');
  downloads.replaceChildren();
  if (opts.saved === 'folder') {
    downloads.innerHTML = `<p class="hint">${esc(t('Saved in the folder'))} <strong>${esc(opts.folder?.name ?? '')}</strong></p>`;
  } else {
    const button = document.createElement('button');
    button.className = 'primary';
    button.innerHTML = `<svg aria-hidden="true"><use href="#i-download"/></svg>${esc(t('Download the results (ZIP)'))}`;
    button.addEventListener('click', downloadZip);
    downloads.append(button);
  }
  renderSpeciesList();
  if (state.species) renderSpecies(state.species);
  renderCal();
  renderCmp();
  renderAct();
  renderMethods();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────────────────────────────────
const TABS = ['summary', 'check', 'thresholds', 'compare', 'activity', 'methods'];
function selectTab(name, focus = true) {
  if (!TABS.includes(name)) name = 'summary';
  for (const tab of TABS) {
    const on = tab === name;
    $(`tab-${tab}`).setAttribute('aria-selected', String(on));
    $(`tab-${tab}`).tabIndex = on ? 0 : -1;
    $(`panel-${tab}`).hidden = !on;
  }
  if (focus) $(`tab-${name}`).focus();
  save('apus.tab', name);
  if (name === 'check' && !state.counts && state.result) worker.postMessage({ type: 'counts' });
}
for (const tab of TABS) $(`tab-${tab}`).addEventListener('click', () => selectTab(tab, false));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const i = TABS.indexOf(e.target.id.replace('tab-', ''));
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  selectTab(TABS[(to + TABS.length) % TABS.length]);
});

// ── Check detections ──────────────────────────────────────────────────────────────────────────────────────
const perBand = () => Number($('clips_per_band').value) || 10;
function openSpecies(name) {
  selectTab('check', false);
  worker.postMessage({ type: 'species', name, perBand: perBand() });
}
function renderSpeciesList() {
  const q = $('species-search').value.trim().toLowerCase();
  const rows = (state.counts ?? []).filter((r) => r.species.toLowerCase().includes(q));
  $('species-list').innerHTML = !state.counts ? `<li class="hint">${esc(t('Loading…'))}</li>`
    : rows.map((r) => {
      const checked = r.correct + r.incorrect + r.unsure;
      return `<li><button type="button" data-species="${esc(r.species)}" ${state.species?.species === r.species ? 'aria-current="true"' : ''}>` +
        `<span class="sp">${esc(r.species)}</span><span class="meta">${esc(tn(r.detections, '{n} detection', '{n} detections'))}` +
        `${checked ? ` · ${esc(t('{n} checked', { n: checked }))}` : ''}</span></button></li>`;
    }).join('') || `<li class="hint">${esc(t('No species matches.'))}</li>`;
}
$('species-search').addEventListener('input', renderSpeciesList);
$('species-list').addEventListener('click', (e) => { const b = e.target.closest('[data-species]'); if (b) openSpecies(b.dataset.species); });

let showAll = false, shownRows = 0;
const PAGE = 20;
const keyOf = (r) => `${r.file}|${r.start_s}|${r.species}`;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function histogram(data) {                          // detections per 0.05 of confidence, the threshold marked
  const max = Math.max(1, ...data.histogram), W = 560, H = 120, bw = W / 20;
  const bars = data.histogram.map((n, i) => {
    if (!n) return '';
    const h = Math.max(2, ((H - 18) * n) / max), x = i * bw + 1, r = Math.min(3, h / 2);
    return `<path d="M${x} ${H - 18}v${-(h - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${bw - 2 - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}z"><title>${num(i * 0.05, 2)}–${num((i + 1) * 0.05, 2)}: ${n}</title></path>`;
  }).join('');
  const tx = data.threshold * W;
  return `<div class="histo-box"><svg class="histo" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('Detections by confidence score, in steps of 0.05'))}">` +
    `<line class="base" x1="0" x2="${W}" y1="${H - 18}" y2="${H - 18}"/>${bars}` +
    `<line class="mark" x1="${tx}" x2="${tx}" y1="0" y2="${H - 18}"/>` +
    [0, 0.5, 1].map((v) => `<text x="${v * W}" y="${H - 4}" text-anchor="${v === 0 ? 'start' : v === 1 ? 'end' : 'middle'}">${num(v, 1)}</text>`).join('') + '</svg>' +
    `<p class="hint">${esc(t('Detections by confidence score. The line marks the threshold ({t}).', { t: num(data.threshold, 2) }))}</p></div>`;
}
function bandsTable(data) {
  return `<table class="bands"><thead><tr><th scope="col">${esc(t('Confidence'))}</th><th scope="col">${esc(t('Detections'))}</th>` +
    `<th scope="col">${esc(t('Correct'))}</th><th scope="col">${esc(t('Incorrect'))}</th><th scope="col">${esc(t('Unsure'))}</th>` +
    `<th scope="col">${esc(t('Share correct'))}</th></tr></thead><tbody>` +
    data.bands.map((b) => `<tr><td>${esc(b.band.replace(/\./g, getLang() === 'es' ? ',' : '.'))}</td><td>${num(b.detections)}</td><td>${num(b.correct)}</td>` +
      `<td>${num(b.incorrect)}</td><td>${num(b.unsure)}</td><td>${b.share_correct == null ? '–' : `${num(100 * b.share_correct, 0)} %`}</td></tr>`).join('') +
    '</tbody></table>';
}
function speciesHead(data) {
  const sample = data.rows.filter((r) => r.in_sample);
  const done = sample.filter((r) => r.verdict).length;
  return `<div class="sp-head"><h3 class="sp-title">${esc(data.species)}</h3>` +
    `<p class="hint">${esc(tn(data.rows.length, '{n} detection', '{n} detections'))} · ${esc(t('{d} of {s} in the sample checked', { d: done, s: sample.length }))}</p>` +
    `<div class="meter" role="img" aria-label="${esc(t('{d} of {s} in the sample checked', { d: done, s: sample.length }))}"><span style="width:${sample.length ? (100 * done) / sample.length : 0}%"></span></div></div>`;
}
function renderSpecies(data) {
  state.species = data;
  showAll = false;
  shownRows = 0;
  const sample = data.rows.filter((r) => r.in_sample).length;
  $('species-detail').innerHTML = `<div class="sp-top">${speciesHead(data)}<div class="sp-figs"><div>${histogram(data)}</div>` +
    `<div class="table-wrap bands-wrap">${bandsTable(data)}</div></div></div>` +
    `<div class="sp-toolbar" role="radiogroup" aria-label="${esc(t('Which detections'))}">` +
    `<label><input type="radio" name="which" value="sample" checked> ${esc(t('Sample to check ({n})', { n: sample }))}</label>` +
    `<label><input type="radio" name="which" value="all"> ${esc(t('All detections ({n})', { n: data.rows.length }))}</label></div>` +
    `<p class="hint keys">${esc(t('Keys: Space plays, C correct, I incorrect, U unsure, arrows move between detections.'))}</p>` +
    '<ol class="dets" id="dets"></ol><button type="button" class="button small" id="more-dets" hidden></button>';
  $('species-detail').querySelectorAll('input[name="which"]').forEach((r) => r.addEventListener('change', () => {
    showAll = r.value === 'all' && r.checked ? true : r.value === 'sample' && r.checked ? false : showAll;
    shownRows = 0;
    $('dets').replaceChildren();
    moreRows();
  }));
  $('more-dets').addEventListener('click', moreRows);
  moreRows();
  renderSpeciesList();
}
function updateSpecies(data) {                       // after a verdict: keep the rows and their spectrograms
  state.species = data;
  const top = $('species-detail').querySelector('.sp-top');
  top.querySelector('.sp-head').outerHTML = speciesHead(data);
  top.querySelector('.histo-box').outerHTML = histogram(data);
  top.querySelector('.bands-wrap').innerHTML = bandsTable(data);
  const verdicts = new Map(data.rows.map((r) => [keyOf(r), r.verdict]));
  $('dets').querySelectorAll('li.det').forEach((li) => {
    const v = verdicts.get(li.dataset.key) ?? '';
    li.querySelectorAll('.verdict button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    li.dataset.verdict = v;
  });
}
function moreRows() {
  const rows = state.species.rows.filter((r) => showAll || r.in_sample);
  const next = rows.slice(shownRows, shownRows + PAGE);
  shownRows += next.length;
  $('dets').insertAdjacentHTML('beforeend', next.map(detRow).join(''));
  $('dets').querySelectorAll('li.det:not([data-seen])').forEach((li) => { li.dataset.seen = '1'; observer.observe(li); });
  $('more-dets').hidden = shownRows >= rows.length;
  $('more-dets').textContent = t('Show {n} more', { n: Math.min(PAGE, rows.length - shownRows) });
}
function detRow(r) {
  const key = keyOf(r);
  return `<li class="det" tabindex="0" data-key="${esc(key)}" data-verdict="${esc(r.verdict)}" aria-label="${esc(`${num(r.confidence, 2)}, ${r.file}, ${clock(r.start_s)}`)}">` +
    `<div class="spec"><canvas width="1" height="1"></canvas><span class="window"></span><span class="playhead"></span>` +
    `<button type="button" class="play" aria-label="${esc(t('Play'))}"><svg aria-hidden="true"><use href="#i-play"/></svg></button></div>` +
    `<div class="det-meta"><span class="conf">${num(r.confidence, 2)}</span><span class="where">${esc(r.file)} · ${clock(r.start_s)}–${clock(r.end_s)}</span>` +
    `${r.in_sample ? '' : `<span class="tag">${esc(t('not in the sample'))}</span>`}</div>` +
    `<div class="verdict" role="group" aria-label="${esc(t('Verdict'))}">${[['correct', 'Correct'], ['incorrect', 'Incorrect'], ['unsure', 'Unsure']]
      .map(([v, label]) => `<button type="button" data-v="${v}" aria-pressed="${r.verdict === v}">${esc(t(label))}</button>`).join('')}</div></li>`;
}
function rowData(li) { return state.species.rows.find((r) => keyOf(r) === li.dataset.key); }
function setVerdict(li, v) {
  const r = rowData(li);
  const verdict = li.dataset.verdict === v ? '' : v;              // the same button again takes the verdict back
  li.dataset.verdict = verdict;
  li.querySelectorAll('.verdict button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === verdict)));
  worker.postMessage({ type: 'verdict', file: r.file, start_s: r.start_s, species: r.species, verdict, perBand: perBand() });
}
$('species-detail').addEventListener('click', (e) => {
  const li = e.target.closest('li.det');
  if (!li) return;
  const vb = e.target.closest('.verdict button');
  if (vb) { setVerdict(li, vb.dataset.v); return; }
  if (e.target.closest('.spec')) play(li);
});
$('species-detail').addEventListener('keydown', (e) => {
  const li = e.target.closest('li.det');
  if (!li || e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
  const go = (el) => { if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); } };
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') { e.preventDefault(); play(li); }
  else if (k === 'c') setVerdict(li, 'correct');
  else if (k === 'i') setVerdict(li, 'incorrect');
  else if (k === 'u') setVerdict(li, 'unsure');
  else if (k === 'arrowdown' || k === 'j') { e.preventDefault(); go(li.nextElementSibling); }
  else if (k === 'arrowup' || k === 'k') { e.preventDefault(); go(li.previousElementSibling); }
});

// Spectrograms and sound, fetched from the worker as each row comes into view
const clips = new Map();                             // key -> {audio, spec, w, h, windowAt} or {error}
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    requestClip(entry.target);
  }
}, { rootMargin: '200px' });
let wantPlay = null;
function requestClip(li) {
  const key = li.dataset.key;
  if (clips.has(key)) { drawClip(li); return; }
  clips.set(key, { pending: true });
  const r = rowData(li);
  worker.postMessage({ type: 'clip', key, file: r.file, start_s: r.start_s, end_s: r.end_s, species: r.species,
                       extra: Number($('clip_extra_s').value) || 1 });
}
function gotClip(data) {
  clips.set(data.key, data);
  const li = $('dets')?.querySelector(`li.det[data-key="${CSS.escape(data.key)}"]`);
  if (li) drawClip(li);
  if (wantPlay === data.key && li) play(li);
}
function clipFailed(key, message) {
  clips.set(key, { error: message });
  const li = $('dets')?.querySelector(`li.det[data-key="${CSS.escape(key)}"]`);
  if (li) li.querySelector('.spec').dataset.error = translatePy(message);
}
function lut() {                                     // low energy in the surface colour, high energy in the ink
  const css = getComputedStyle(document.documentElement);
  const rgb = (v) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = css.getPropertyValue(v).trim(); c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lo = rgb('--surface-2'), hi = rgb('--ink');
  // A steep curve keeps the background noise light and the calls dark
  return Array.from({ length: 256 }, (_, i) => { const f = (i / 255) ** 2.2; return lo.map((a, j) => Math.round(a + (hi[j] - a) * f)); });
}
let colours = null;
function drawClip(li) {
  const c = clips.get(li.dataset.key);
  if (!c || c.pending || c.error) { if (c?.error) li.querySelector('.spec').dataset.error = translatePy(c.error); return; }
  colours ??= lut();
  const canvas = li.querySelector('canvas');
  canvas.width = c.w;
  canvas.height = c.h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(c.w, c.h);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const [r, g, b] = colours[c.spec[y * c.w + x]];
      const o = ((c.h - 1 - y) * c.w + x) * 4;               // low frequencies at the bottom
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const seconds = c.audio.length / 32000;
  const win = li.querySelector('.window');
  win.style.left = `${(100 * c.windowAt) / seconds}%`;
  win.style.width = `${(100 * Math.min(5, seconds - c.windowAt)) / seconds}%`;
  li.querySelector('.spec').classList.add('drawn');
}
function redrawSpectrograms() {
  colours = null;
  document.querySelectorAll('li.det .spec.drawn').forEach((s) => drawClip(s.closest('li.det')));
}

let audioCtx = null, playing = null;
function stopPlaying() {
  if (!playing) return;
  try { playing.source.stop(); } catch { /* already ended */ }
  cancelAnimationFrame(playing.frame);
  playing.li.classList.remove('playing');
  playing.li.querySelector('.play use').setAttribute('href', '#i-play');
  playing = null;
}
function play(li) {
  audioCtx ??= new AudioContext();                   // made and resumed inside the click: browsers allow sound then
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const was = playing?.li === li;
  stopPlaying();
  if (was) return;
  const c = clips.get(li.dataset.key);
  if (!c || c.pending) { wantPlay = li.dataset.key; if (!c) requestClip(li); return; }
  if (c.error) return;
  wantPlay = null;
  const buffer = audioCtx.createBuffer(1, c.audio.length, 32000);
  buffer.copyToChannel(c.audio, 0);
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  const t0 = audioCtx.currentTime;
  source.start();
  playing = { li, source };
  li.classList.add('playing');
  li.querySelector('.play use').setAttribute('href', '#i-pause');
  const head = li.querySelector('.playhead');
  const step = () => {
    const f = Math.min(1, (audioCtx.currentTime - t0) / buffer.duration);
    head.style.left = `${100 * f}%`;
    if (playing?.li === li) playing.frame = requestAnimationFrame(step);
  };
  step();
  source.onended = () => { if (playing?.li === li) stopPlaying(); };
}

// ── Thresholds (§9) ───────────────────────────────────────────────────────────────────────────────────────
$('cal-run').addEventListener('click', () => {
  $('cal-status').textContent = t('Fitting…');
  worker.postMessage({ type: 'calibrate', target: Number($('cal-target').value), minClips: Number($('cal-min').value) });
});
const logit = (p) => Math.log(Math.min(Math.max(p, 1e-6), 1 - 1e-6) / (1 - Math.min(Math.max(p, 1e-6), 1 - 1e-6)));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
function curveFigure(row, points, target) {             // one species: its checks, the fitted curve, the threshold
  const W = 240, H = 150, L = 30, B = 22, T = 8, R = 8, x = (v) => L + v * (W - L - R), y = (v) => T + (1 - v) * (H - T - B);
  const dots = points.map((p, i) => `<circle cx="${x(p.confidence)}" cy="${y(p.correct ? 1 : 0) + ((i % 5) - 2) * 1.6}" r="3.5"><title>${num(p.confidence, 3)}: ${esc(t(p.correct ? 'Correct' : 'Incorrect'))}</title></circle>`).join('');
  let curve = '';
  if (Number.isFinite(row.b1)) {
    const pts = Array.from({ length: 81 }, (_, i) => { const v = 0.005 + (0.99 * i) / 80; return `${x(v).toFixed(1)},${y(sigmoid(row.b0 + row.b1 * logit(v))).toFixed(1)}`; });
    curve = `<polyline class="fit" points="${pts.join(' ')}"/>`;
  }
  const thr = Number.isFinite(row.threshold) ? `<line class="thr" x1="${x(row.threshold)}" x2="${x(row.threshold)}" y1="${T}" y2="${H - B}"/>` : '';
  return `<figure class="mult"><figcaption><i>${esc(row.species)}</i> ${Number.isFinite(row.threshold) ? `<strong>${num(row.threshold, 2)}</strong>` : `<span class="hint">${esc(t('no threshold'))}</span>`}</figcaption>` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('Checked detections of {s} by confidence, with the fitted chance of being correct', { s: row.species }))}">` +
    `<line class="target" x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}"/><line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>` +
    `${thr}${curve}<g class="dots">${dots}</g>` +
    `<text x="${L - 4}" y="${y(1) + 4}" text-anchor="end">1</text><text x="${L - 4}" y="${y(0) + 4}" text-anchor="end">0</text>` +
    [0, 0.5, 1].map((v) => `<text x="${x(v)}" y="${H - 6}" text-anchor="middle">${num(v, 1)}</text>`).join('') + '</svg></figure>';
}
function renderCal() {
  const d = state.cal;
  if (!d) { $('cal-out').innerHTML = ''; return; }
  if (!d.thresholds.length) { $('cal-out').innerHTML = `<p class="hint">${esc(t('No checked detections yet. Mark some as correct or incorrect in the Check detections tab first.'))}</p>`; return; }
  const got = d.thresholds.filter((r) => Number.isFinite(r.threshold)).length;
  const rows = d.thresholds.map((r) => ({ ...r, threshold: Number.isFinite(r.threshold) ? r.threshold : null, note: translatePy(r.note || '') }));
  $('cal-out').innerHTML = `<p class="result-line">${esc(t('{g} of {n} species got a threshold. {p} of {d} detections pass their species\' threshold.', { g: got, n: d.thresholds.length, p: num(d.passing), d: num(d.detections) }))}</p>` +
    (d.dropped ? `<p class="hint">${esc(tn(d.dropped, '{n} sorted clip has no known confidence and was left out.', '{n} sorted clips have no known confidence and were left out.'))}</p>` : '') +
    '<div class="table-wrap"><table id="cal-table"></table></div>' +
    `<div class="multiples">${d.thresholds.map((r) => curveFigure(r, d.points.filter((p) => p.species === r.species), d.target)).join('')}</div>` +
    `<p class="hint">${esc(t('Dots: your checks, correct at the top and incorrect at the bottom. Line: the fitted chance of being correct. Vertical line: the threshold. Grey line: your target.'))}</p>` +
    `<p class="hint">${esc(t('Written to the output: thresholds/thresholds.csv, thresholds/precision_by_band.csv and detections_species_thresholds.csv.'))}</p>`;
  table($('cal-table'), rows, [['species', 'Species'], ['clips', 'Checked'], ['correct', 'Correct'], ['incorrect', 'Incorrect'],
    ['threshold', 'Threshold'], ['correct_clips_kept', 'Correct kept'], ['note', 'Note']], true);
}

// ── Compare (§8) ──────────────────────────────────────────────────────────────────────────────────────────
// The annotations ('ref') and another model's results ('other'): one or more files, or a folder, chosen or dropped.
// `items` are {file, rel} as for the recordings. `name` is the folder, the one file, or "3 files" (a folder of its own).
const TABLE = /\.(txt|csv)$/i;
function setCompareFiles(key, items, folder) {
  const tables = items.filter(({ file }) => TABLE.test(file.name));
  if (!tables.length) { $('cmp-status').textContent = t('There are no text or CSV files there.'); return; }
  $('cmp-status').textContent = '';
  const name = folder ? items[0].rel.split('/')[0]
    : tables.length === 1 ? tables[0].file.name : tn(tables.length, '{n} file', '{n} files');
  state[key] = { items: tables, folder, name };
  compareNames();
  updateRun();
}
function compareNames() {
  for (const key of ['ref', 'other']) {
    const s = state[key];
    $(`${key}-name`).textContent = !s ? t('Drop files or a folder here, or choose them.')
      : s.folder ? `${s.name} (${tn(s.items.length, '{n} file', '{n} files')})` : s.name;
    $(`${key}-field`).classList.toggle('set', Boolean(s));
  }
  $('clear-other').hidden = !state.other;
  $('other-name-row').hidden = !state.other;
}
for (const key of ['ref', 'other']) {
  pick(`pick-${key}-files`, `${key}-files-input`);
  pick(`pick-${key}-folder`, `${key}-folder-input`);
  $(`${key}-files-input`).addEventListener('change', (e) =>
    setCompareFiles(key, [...e.target.files].map((f) => ({ file: f, rel: f.name })), false));
  $(`${key}-folder-input`).addEventListener('change', (e) =>
    setCompareFiles(key, [...e.target.files].map((f) => ({ file: f, rel: f.webkitRelativePath })), true));
  const field = $(`${key}-field`);                   // a drop here is for this field, not a new set of recordings
  field.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('dragging');
    field.classList.add('drag-over');
  });
  field.addEventListener('dragleave', (e) => { if (!field.contains(e.relatedTarget)) field.classList.remove('drag-over'); });
  field.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    field.classList.remove('drag-over');
    try {
      const { items, folder } = await droppedItems(e, 'Drop one folder, or one or more files.');
      setCompareFiles(key, items, folder);
    } catch (err) { $('cmp-status').textContent = t(err.message); }
  });
}
$('clear-other').addEventListener('click', () => { state.other = null; compareNames(); });
$('cmp-run').addEventListener('click', () => {
  $('cmp-status').textContent = t('Comparing…');
  const as = (prefix, s) => s.items.map(({ file, rel }) =>
    ({ path: `${prefix}/${s.folder || s.items.length === 1 ? rel : `${s.name}/${rel}`}`, file }));
  worker.postMessage({ type: 'compare', files: [...as('ref', state.ref), ...(state.other ? as('other', state.other) : [])],
                       reference: `ref/${state.ref.name}`, other: state.other ? `other/${state.other.name}` : null,
                       otherName: $('other-model-name').value.trim() || 'BirdNET', countUnmatched: $('count-unmatched').checked });
});
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
function lineChart({ series, xLabel, yLabel, title, marks = [] }) {   // x and y from 0 to 1
  const W = 320, H = 230, L = 36, B = 34, T = 10, R = 10, x = (v) => L + v * (W - L - R), y = (v) => T + (1 - v) * (H - T - B);
  const lines = series.map((s, i) => `<polyline style="stroke:${SERIES[i]}" points="${s.points.filter(([a, b]) => b != null && a != null)
    .map(([a, b]) => `${x(a).toFixed(1)},${y(b).toFixed(1)}`).join(' ')}"/>`).join('');
  const dots = marks.map((m) => `<circle cx="${x(m.x)}" cy="${y(m.y)}" r="4.5" style="fill:${SERIES[m.series]}"><title>${esc(m.title)}</title></circle>`).join('');
  return `<figure class="line-chart"><figcaption>${esc(title)}</figcaption>` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">` +
    [0.25, 0.5, 0.75, 1].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('') +
    `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>${lines}${dots}` +
    [0, 0.5, 1].map((v) => `<text x="${x(v)}" y="${H - 18}" text-anchor="middle">${num(v, 1)}</text><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${num(v, 1)}</text>`).join('') +
    `<text class="axis-label" x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">${esc(xLabel)}</text>` +
    `<text class="axis-label" transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text></svg>` +
    `<ul class="legend">${series.map((s, i) => `<li><span class="key" style="background:${SERIES[i]}"></span>${esc(s.name)}</li>`).join('')}</ul></figure>`;
}
const LEVELS = { vocalization: 'Single calls', dataset: 'Species per dataset' };
function renderCmp() {
  const d = state.cmp;
  if (!d) { $('cmp-out').innerHTML = ''; return; }
  const models = Object.keys(d.curves);
  const charts = Object.keys(LEVELS).map((level) => lineChart({
    title: t('Precision against recall: {l}', { l: t(LEVELS[level]).toLowerCase() }), xLabel: t('Recall'), yLabel: t('Precision'),
    series: models.map((m) => ({ name: m, points: d.curves[m].filter((r) => r.level === level).sort((a, b) => a.threshold - b.threshold).map((r) => [r.recall, r.precision]) })),
    marks: models.map((m, i) => { const r = d.curves[m].find((c) => c.level === level && c.threshold === d.threshold); return r && r.recall != null && r.precision != null ? { x: r.recall, y: r.precision, series: i, title: `${m}: ${t('threshold')} ${num(d.threshold, 2)}` } : null; }).filter(Boolean),
  })).concat(Object.keys(LEVELS).map((level) => lineChart({
    title: t('Perch by threshold: {l}', { l: t(LEVELS[level]).toLowerCase() }), xLabel: t('Confidence threshold'), yLabel: t('Score'),
    series: [['precision', 'Precision'], ['recall', 'Recall'], ['f1', 'F1']].map(([k, name]) => ({ name: t(name), points: d.curves.Perch.filter((r) => r.level === level).map((r) => [r.threshold, r[k]]) })),
  })));
  $('cmp-out').innerHTML = `<ul class="messages">${d.messages.map((m) => `<li>${esc(translatePy(m))}</li>`).join('')}</ul>` +
    '<div class="table-wrap"><table id="cmp-summary"></table></div>' +
    `<p class="hint">${esc(t('A confidence of 0.5 does not mean the same for two models: compare them on the curves, not at one threshold. A best threshold marked ≤ is only an upper bound.'))}</p>` +
    `<div class="charts">${charts.join('')}</div>` +
    `<h3>${esc(t('By species'))}</h3><div class="table-wrap"><table id="cmp-species"></table></div>` +
    `<h3>${esc(t('By dataset'))}</h3><div class="table-wrap"><table id="cmp-datasets"></table></div>` +
    `<p class="hint">${esc(t('Written to the output: the comparison folder, with the false positives and missed calls of each model.'))}</p>`;
  table($('cmp-summary'), d.summary.map((r) => ({ ...r, level: t(LEVELS[r.level]) })), [['model', 'Model'], ['level', 'Level'],
    ['precision', 'Precision'], ['recall', 'Recall'], ['f1', 'F1'], ['best_threshold', 'Best threshold'], ['best_f1', 'Best F1'], ['pr_auc', 'PR AUC']], false);
  const wide = [['reference_events', 'Annotated'], ['voc_precision', 'Calls: precision'], ['voc_recall', 'Calls: recall'],
                ['ds_TP', 'Datasets: found'], ['ds_FN', 'Datasets: missed'], ['ds_FP', 'Datasets: false']];
  table($('cmp-species'), d.by_species, [['species', 'Species'], ['model', 'Model'], ...wide], true);
  table($('cmp-datasets'), d.by_dataset, [['dataset', 'Dataset'], ['model', 'Model'], ...wide], false);
}

// ── Activity: times from file names ──────────────────────────────────────────────────────────────────────
function utcOffsets() {
  const sel = $('utc-offset'), saved = load('apus.offset', -new Date().getTimezoneOffset());
  const label = (m) => `${m < 0 ? '−' : '+'}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')}:${String(Math.abs(m) % 60).padStart(2, '0')}`;
  sel.innerHTML = Array.from({ length: (14 + 12) * 4 + 1 }, (_, i) => -720 + 15 * i)
    .map((m) => `<option value="${m}" ${m === saved ? 'selected' : ''}>${label(m)}</option>`).join('');
}
utcOffsets();
$('names-tz').value = load('apus.namesTz', 'utc');
$('names-tz').addEventListener('change', () => save('apus.namesTz', $('names-tz').value));
$('utc-offset').addEventListener('change', () => save('apus.offset', Number($('utc-offset').value)));
$('act-run').addEventListener('click', () => {
  $('act-status').textContent = t('Reading times…');
  worker.postMessage({ type: 'times', namesInUtc: $('names-tz').value === 'utc', offsetMinutes: Number($('utc-offset').value) });
});
// Detections per hour of recording, one column per key. Drawn at about the width it is shown, so its labels
// keep their size; a long series scrolls in its box. Columns are at most 24 px wide, rounded at the top.
function columns(keys, effort, counts, labelEvery, label) {
  const W = Math.max(720, keys.length * 18), H = 170, B = 22, T = 8, slot = W / keys.length, bw = Math.min(24, slot - 4);
  const rate = keys.map((k) => (effort[k] ? (counts[k] ?? 0) / effort[k] : null));
  const max = Math.max(1e-9, ...rate.filter((v) => v != null));
  const bars = keys.map((k, i) => {
    const x = i * slot + (slot - bw) / 2, y0 = H - B;
    if (rate[i] == null) return `<rect class="none" x="${x}" y="${y0 - 2}" width="${bw}" height="2"><title>${esc(label(k))}: ${esc(t('no recording'))}</title></rect>`;
    const h = Math.max(rate[i] > 0 ? 2 : 0, ((H - B - T) * rate[i]) / max), r = Math.min(3, h / 2, bw / 2);
    return `<path d="M${x} ${y0}v${-(h - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${bw - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}z"><title>${esc(label(k))}: ` +
      `${esc(t('{d} detections in {h} h of recording', { d: counts[k] ?? 0, h: num(effort[k], 2) }))}</title></path>`;
  }).join('');
  return `<div class="col-chart"><svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W, 600)}px" role="img" aria-label="${esc(t('Detections per hour of recording'))}">` +
    `<line class="axis" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"/>${bars}` +
    keys.map((k, i) => (i % labelEvery === 0 ? `<text x="${i === 0 ? 2 : i * slot + slot / 2}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(label(k, true))}</text>` : '')).join('') +
    `</svg></div><p class="hint">${esc(t('Highest: {v} detections per hour of recording.', { v: num(max, max < 10 ? 2 : max < 100 ? 1 : 0) }))}</p>`;
}
function renderAct() {
  const d = state.act;
  if (!d) { $('act-out').innerHTML = ''; return; }
  const species = [...new Set(d.hour.detections.map((r) => r.species))].sort();
  const pick = $('act-species')?.value ?? '';
  const count = (rows) => rows.filter((r) => !pick || r.species === pick).reduce((m, r) => ({ ...m, [r.key]: (m[r.key] ?? 0) + r.detections }), {});
  const hours = Array.from({ length: 24 }, (_, h) => String(h));
  const dates = Object.keys(d.date.effort_hours).sort();
  const years = new Set(dates.map((k) => k.slice(0, 4))).size;             // short labels only within one year
  const parsed = d.files - d.unparsed.length;
  $('act-out').innerHTML = `<p class="result-line">${esc(t('Times read from {k} of {n} recordings, from {a} to {b} (local time, UTC{o}).', { k: parsed, n: d.files, a: d.first?.slice(0, 16) ?? '–', b: d.last?.slice(0, 16) ?? '–', o: d.offset }))}</p>` +
    (d.unparsed.length ? `<details class="issue"><summary><svg aria-hidden="true"><use href="#i-warn"/></svg>${esc(tn(d.unparsed.length, '{n} file name holds no date and time', '{n} file names hold no date and time'))}</summary><ul>${d.unparsed.slice(0, 50).map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>` : '') +
    `<div class="form-row"><div class="field"><label for="act-species">${esc(t('Species'))}</label><select id="act-species"><option value="">${esc(t('All species'))}</option>` +
    species.map((s) => `<option value="${esc(s)}" ${s === pick ? 'selected' : ''}>${esc(s)}</option>`).join('') + '</select></div></div>' +
    `<h3>${esc(t('By hour of the day'))}</h3>${columns(hours, d.hour.effort_hours, count(d.hour.detections), 3, (k) => `${k.padStart(2, '0')}:00`)}` +
    `<h3>${esc(t('By date'))}</h3>${columns(dates, d.date.effort_hours, count(d.date.detections), Math.max(1, Math.ceil(dates.length / 12)), (k, short) => (short && years === 1 ? k.slice(5) : k))}` +
    `<p class="hint">${esc(t('Detections per hour of recording: the detections at that hour or date, divided by the hours of audio analysed then. This is calling activity, not the number of animals.'))}</p>` +
    `<p class="hint">${esc(t('Written to the output: detection_times.csv, with each detection\'s time in UTC and in local time.'))}</p>`;
  $('act-species').addEventListener('change', renderAct);
}

// ── Methods ───────────────────────────────────────────────────────────────────────────────────────────────
const REFS = {
  apus: 'López-de Sancha, A. (2026). Apus: Perch 2.0 in your browser (version 0.2.0). https://github.com/Calotriton/Apus',
  perch: 'van Merriënboer, B., et al. (2025). Perch 2.0: The Bittern Lesson for Bioacoustics. arXiv:2508.04665.',
  wood: 'Wood, C. M., & Kahl, S. (2024). Guidelines for appropriate use of BirdNET scores and other detector outputs. Journal of Ornithology, 165, 777–782. https://doi.org/10.1007/s10336-024-02144-5',
  funosas: 'Funosas, D., et al. (2026). Ecological Indicators, 182, 114550.',
};
function renderMethods() {
  if (!state.result) return;
  const { result, opts } = state.result;
  const s = result.settings ?? {};
  const run = state.lastRun?.settings ?? {};
  const hop = s.hop_s ?? run.hop_s, topK = s.top_k ?? run.top_k, threshold = result.threshold ?? s.threshold;
  const windows = opts.windows ?? null;
  const parts = [t('Recordings were analysed with Perch 2.0 (van Merriënboer et al. 2025), a classifier of 14,795 classes of animal sounds, run in Apus 0.2.0 (López-de Sancha 2026) with ONNX Runtime Web.'),
    t('Each recording was converted to mono and resampled to 32 kHz with a polyphase filter. It was cut into 5 s windows every {hop} s, and in each window the mean was removed and the peak scaled to 0.25, as in perch-hoplite.', { hop: num(hop ?? 5) }),
    t('In each window the {k} highest-scoring classes were kept, and a class scoring at least {t} counted as a detection.', { k: topK ?? 10, t: num(threshold ?? 0.1, 2) })];
  if (result.lines.some((l) => l.startsWith('Species list:'))) parts.push(t('Detections of species not on the species list for each recording were removed.'));
  parts.push(t('The {n} recordings in {d} datasets gave {det} detections of {sp} species.', {
    n: num(sum(result.datasets, 'recordings_analysed')), d: result.datasets.length, det: num(sum(result.species, 'detections')), sp: result.species.length }) +
    (windows ? ` ${t('({w} windows analysed.)', { w: num(windows) })}` : ''));
  if (state.cal?.thresholds?.length) {
    parts.push(t('A threshold per species was then fitted from {c} checked detections, with a logistic regression of the verdict on the logit of the confidence, at a target probability of {p} (Wood & Kahl 2024).',
      { c: num(state.cal.points.length), p: num(state.cal.target, 2) }));
  }
  if (state.cmp) parts.push(t('Detections were compared with manual annotations at the vocalization and dataset levels (Funosas et al. 2026).'));
  $('methods-text').textContent = parts.join(' ');
  const refs = ['apus', 'perch', ...(state.cal?.thresholds?.length ? ['wood'] : []), ...(state.cmp ? ['funosas'] : [])];
  $('refs').innerHTML = refs.map((k) => `<li>${esc(REFS[k])}</li>`).join('');
}
$('copy-methods').addEventListener('click', async () => {
  const text = `${$('methods-text').textContent}\n\n${[...$('refs').children].map((li) => li.textContent).join('\n')}`;
  try { await navigator.clipboard.writeText(text); $('copy-methods').lastElementChild.textContent = t('Copied'); }
  catch { getSelection().selectAllChildren($('methods-text')); }
  setTimeout(() => { $('copy-methods').lastElementChild.textContent = t('Copy'); }, 2000);
});

// ── Downloads ─────────────────────────────────────────────────────────────────────────────────────────────
function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function downloadZip() {
  const { zipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js');
  const files = {};
  async function walkDir(dir, prefix) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') await walkDir(h, `${prefix}${name}/`);
      else files[`${prefix}${name}`] = new Uint8Array(await (await h.getFile()).arrayBuffer());
    }
  }
  await walkDir(await (await navigator.storage.getDirectory()).getDirectoryHandle('apus-results'), 'apus-results/');
  const url = URL.createObjectURL(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'apus-results.zip' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Start ─────────────────────────────────────────────────────────────────────────────────────────────────
applyLang();
relabel();

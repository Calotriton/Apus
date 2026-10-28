// Apus worker: Python (Pyodide) runs the notebook's logic (ADR 0003); ONNX Runtime Web runs Perch 2.0.
// In:  init, run, stop, reopen, check, species, counts, verdict, clip, calibrate, compare, times, clear
// Out: status, ready, log, progress, confirm-replace, done, stopped, reopened, checked, species, counts, clip,
//      tool-status, calibrated, compared, times, cleared, error ({message, for: the request that failed, key})
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs';

const VERSION = '0.2.0';
const LOCAL = ['localhost', '127.0.0.1'].includes(self.location.hostname);
// The owner's copy of the model on Hugging Face, pinned to the upload's commit (ADR 0005); a local copy
// while developing
const MODEL_BASE = LOCAL ? new URL('../model/', self.location.href).href
  : 'https://huggingface.co/Calotriton/perch-v2-onnx/resolve/bb0f724ee99fa4e0dc3637d8bbdc6a0e26660480/';
const FILES = {
  model: ['perch_v2.onnx', 'bf0c8467a924cb074663970ca4a0ab1e143602121930209657d0dff5d5cefa1f'],
  labels: ['labels.csv', 'e4d5c0397d8fb08bf90c6b13a34810af53504faad927e472fcc567793c9de057'],
  codes: ['perch_v2_ebird_classes.csv', '861aef71b679d8dcf07c0c71375188c46b680bd808c61a539f254dc21319bcc9'],
};
const MODEL_ID = `perch_v2.onnx sha256:${FILES.model[1]}`;
const PY_FILES = ['__init__.py', 'audio.py', 'names.py', 'project.py', 'results.py', 'compare.py', 'selftest.py',
                  'builtin_synonyms.txt', 'selftest_probs.f32'];
const WINDOW = 160000;
const BATCH = 4;                     // a one-minute recording at a 5 s hop is three full batches
// The files a reopened result is read from (the large predictions.csv only when it is needed)
const RESULT_FILES = ['run_settings.json', 'detections.csv', 'species_summary.csv', 'dataset_summary.csv', 'summary.txt',
                      'failed_recordings.csv', 'checked_detections.csv', 'clips/clips.csv'];

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';

let py, project, helpers, session, backend, classes, stopping = false, sklearn = false;
let lastRun = null;                  // the last Run (Python), kept for listening and comparing until the next run
let current = null;                  // the results on show: {sink, results (Python), inputDir}
const post = (message, transfer) => self.postMessage(message, transfer ?? []);
const status = (text, progress) => post({ type: 'status', text, progress });
const lastLine = (e) => String(e?.message ?? e).trim().split('\n').at(-1).replace(/^\w*(Error|Exception): /, '');

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A model file from the browser's cache, or downloaded once with progress; refused unless its SHA-256 matches
async function modelFile([name, hash], label) {
  const url = MODEL_BASE + name;
  const cache = await caches.open('apus-model');
  const cached = await cache.match(url);
  let bytes;
  if (cached) {
    bytes = new Uint8Array(await cached.arrayBuffer());
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download ${name} (HTTP ${res.status}).`);
    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (total) status(`Downloading ${label}`, got / total);
    }
    bytes = new Uint8Array(got);
    let at = 0;
    for (const p of parts) { bytes.set(p, at); at += p.length; }
  }
  if ((await sha256(bytes)) !== hash) {
    await cache.delete(url);
    throw new Error(`${name} is not the expected file. Reload the page to download it again.`);
  }
  if (!cached) {
    try { await cache.put(url, new Response(bytes)); } catch { /* no cache (private window): download next time */ }
  }
  return bytes;
}

async function startPython() {
  status('Starting Python');
  py = await loadPyodide();
  await py.loadPackage(['numpy', 'scipy', 'pandas', 'soundfile']);
  py.FS.mkdirTree('/apus/apus');
  for (const f of PY_FILES) {
    const res = await fetch(`apus/${f}`);
    if (!res.ok) throw new Error(`apus/${f}: HTTP ${res.status}`);
    py.FS.writeFile(`/apus/apus/${f}`, new Uint8Array(await res.arrayBuffer()));
  }
  py.runPython('import sys; sys.path.insert(0, "/apus")');
  project = py.pyimport('apus.project');
  // JS arrays arrive in Python as proxies; these turn them into numpy arrays
  const fns = py.runPython(`
import numpy as np
from apus import selftest
from apus.audio import load_clip, spectrogram
from apus.compare import compare
from apus.project import check_recordings, softmax
from apus.results import Results
def add(run, file, w0, logits):
    run.add(file, w0, np.asarray(logits.to_py(), dtype=np.float32))
def check(logits):
    return list(selftest.check(softmax(np.asarray(logits.to_py(), dtype=np.float32))))
def signal():
    return selftest.signal()
def out_files():
    import os
    return [os.path.relpath(os.path.join(d, n), "/out") for d, _, names in os.walk("/out") for n in names]
def clip(path, offset, duration):
    y = load_clip(path, offset, duration)
    data, w, h = spectrogram(y)
    return y.astype(np.float32), data, w, h
{"add": add, "check": check, "signal": signal, "out_files": out_files, "clip": clip, "compare": compare,
 "check_recordings": check_recordings, "Results": Results}
`);
  helpers = Object.fromEntries(['add', 'check', 'signal', 'out_files', 'clip', 'compare', 'check_recordings', 'Results']
    .map((k) => [k, fns.get(k)]));
  fns.destroy();
}

const float32Of = (proxy) => {
  const buf = proxy.getBuffer('f32');
  const copy = new Float32Array(buf.data);
  buf.release();
  proxy.destroy();
  return copy;
};
const exists = (path) => py.FS.analyzePath(path).exists;

// Scores for windows x [b, WINDOW]. A GPU compiles its programs for each batch size, so it always gets BATCH
// windows (padded with silence); the padding's scores are dropped.
async function infer(x, b) {
  const n = backend?.startsWith('CPU') ? b : BATCH;
  const input = n === b ? x : new Float32Array(n * WINDOW);
  if (input !== x) input.set(x);
  const out = await session.run({ inputs: new ort.Tensor('float32', input, [n, WINDOW]) }, ['label']);
  return out.label.data.subarray(0, b * (out.label.data.length / n));
}

async function selfTest(s) {
  session = s;
  return helpers.check(await infer(float32Of(helpers.signal()), 1)).toJs();   // [passed, max |Δp|]
}

// The model's own speed, in windows per second: a rough base for run-time estimates before any run
async function modelSpeed() {
  const x = new Float32Array(BATCH * WINDOW);
  await infer(x, BATCH);                                         // the first call also compiles
  const t = performance.now();
  await infer(x, BATCH);
  return BATCH / Math.max((performance.now() - t) / 1000, 1e-3);
}

async function init({ backend: preference }) {
  await startPython();
  const model = await modelFile(FILES.model, 'the model (409 MB, only the first time)');
  const text = async (f) => new TextDecoder().decode(await modelFile(f, 'the species names'));
  const names = (await text(FILES.labels)).split(/\r?\n/).slice(1).map((s) => s.trim()).filter(Boolean);
  let codes = (await text(FILES.codes)).split(/\r?\n/).slice(1).map((s) => s.trim());
  if (codes.at(-1) === '') codes.pop();
  if (codes.length !== names.length) codes = [];
  classes = [py.toPy(names), py.toPy(codes)];

  let note = null;
  session = null;
  backend = null;
  if (preference !== 'cpu' && self.navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        status('Checking the graphics card');
        ort.env.webgpu.adapter = adapter;
        const s = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] });
        const [ok, worst] = await selfTest(s);
        if (ok) {
          const info = adapter.info ?? {};
          backend = `GPU (${[info.vendor, info.architecture].filter(Boolean).join(' ') || 'WebGPU'})`;
        } else {
          await s.release();
          session = null;
          note = `The graphics card's results differ from the expected ones (by up to ${worst.toExponential(1)}), so the CPU is used.`;
        }
      }
    } catch (e) {
      session = null;
      note = `The graphics card could not run the model (${lastLine(e)}), so the CPU is used.`;
    }
  }
  if (!backend) {
    status('Preparing the CPU');
    backend = 'CPU';
    const [ok, worst] = await selfTest(await ort.InferenceSession.create(model, { executionProviders: ['wasm'] }));
    if (!ok) throw new Error(`The model gives unexpected results in this browser (by up to ${worst}).`);
    backend = `CPU (${ort.env.wasm.numThreads} thread${ort.env.wasm.numThreads === 1 ? '' : 's'})`;
  }
  post({ type: 'ready', backend, note, version: VERSION, isolated: self.crossOriginIsolated, names,
         speed: await modelSpeed() });
}

// ── Output: the user's folder (Chrome, Edge) or the browser's own storage (every browser) ──────────────────
const opfsRoot = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('apus-results', { create: true });
const sinkOf = async (folder) => (folder ? { dir: folder, opfs: false } : { dir: await opfsRoot(), opfs: true });

async function fileHandle(dir, path, create) {
  const parts = path.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
  return dir.getFileHandle(parts.at(-1), { create });
}

async function readSink(dir, path) {
  try {
    return new Uint8Array(await (await (await fileHandle(dir, path, false)).getFile()).arrayBuffer());
  } catch {
    return null;
  }
}

async function writeSink(sink, path, data, append = false) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const fh = await fileHandle(sink.dir, path, true);
  if (sink.opfs) {                                   // every browser supports sync handles in workers
    const h = await fh.createSyncAccessHandle();
    if (!append) h.truncate(0);
    h.write(bytes, { at: append ? h.getSize() : 0 });
    h.flush();
    h.close();
  } else {
    const w = await fh.createWritable({ keepExistingData: append });
    if (append) await w.seek((await fh.getFile()).size);
    await w.write(bytes);
    await w.close();
  }
}

async function removeSink(dir, path) {
  try { await dir.removeEntry(path); } catch { /* not there */ }
}

// Every file under a folder of the output, as paths from the output's root ('clips/Turdus_merula/correct/x.wav')
async function listSink(dir, folder) {
  const paths = [];
  let d = dir;
  try { for (const part of folder.split('/')) d = await d.getDirectoryHandle(part); } catch { return paths; }
  async function walk(h, prefix) {
    for await (const [name, child] of h.entries()) {
      if (child.kind === 'directory') await walk(child, `${prefix}${name}/`);
      else paths.push(`${prefix}${name}`);
    }
  }
  await walk(d, `${folder}/`);
  return paths;
}

// 'species_folder/clip.wav' for every clip already in the output folder, sorted into sub-folders or not
async function existingClips(dir) {
  return (await listSink(dir, 'clips')).map((p) => p.split('/')).filter((p) => p.length >= 3 && p.at(-1).endsWith('.wav'))
    .map((p) => `${p[1]}/${p.at(-1)}`);
}

async function copyOut(sink, path) { await writeSink(sink, path, py.FS.readFile(`/out/${path}`)); }
async function moveOut(sink, path) {                 // from Python's memory to the output, then forget it
  await copyOut(sink, path);
  py.FS.unlink(`/out/${path}`);
}
async function pushOut(...paths) {                   // files Python has just written, to the output on show
  for (const p of paths) if (exists(`/out/${p}`)) await copyOut(current.sink, p);
}

function setCurrent(sink, inputDir) {
  current?.results?.destroy();
  current = { sink, inputDir, results: helpers.Results('/out') };
}

// ── A run ────────────────────────────────────────────────────────────────────────────────────────────────
async function run({ files, inputDir, settings, folder, replace }) {
  stopping = false;
  const sink = await sinkOf(folder);
  const previous = await readSink(sink.dir, 'predictions.csv');
  if (previous && !settings.resume && !replace) return post({ type: 'confirm-replace' });
  if (previous && !settings.resume) await removeSink(sink.dir, 'predictions.csv');

  lastRun?.destroy();
  lastRun = null;
  current?.results?.destroy();
  current = null;
  try { py.FS.unmount('/data'); } catch { /* first run */ }
  py.FS.mkdirTree('/data');
  py.FS.mount(py.FS.filesystems.WORKERFS, { blobs: files.map((f) => ({ name: f.path, data: f.file })) }, '/data');
  py.runPython('import shutil; shutil.rmtree("/out", ignore_errors=True)');
  py.FS.mkdirTree('/out');
  if (previous && settings.resume) {
    py.FS.writeFile('/out/predictions.csv', previous);
    const json = await readSink(sink.dir, 'run_settings.json');
    if (json) py.FS.writeFile('/out/run_settings.json', json);
  }
  for (const keep of ['checked_detections.csv']) {            // the user's verdicts survive a re-run
    const bytes = await readSink(sink.dir, keep);
    if (bytes) py.FS.writeFile(`/out/${keep}`, bytes);
  }

  const provenance = py.toPy({ app: `Apus ${VERSION}`, backend });
  // Unset settings are left out so Python's defaults (None) apply: a JS null reaches Python as JsNull, not None
  const given = py.toPy(Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== null)));
  const r = project.Run(`/data/${inputDir}`, '/out', given, ...classes, MODEL_ID, provenance);
  const shown = r.messages.toJs();
  post({ type: 'log', lines: shown });
  await writeSink(sink, 'run_settings.json', py.FS.readFile('/out/run_settings.json'));

  const recordings = [];
  let total = 0;
  for (const f of r.todo.toJs()) {
    try {
      const rec = r.open(f);
      recordings.push([f, rec]);
      total += rec.n_windows;
    } catch (e) {
      r.fail(f, lastLine(e));
    }
  }

  let done = 0, i = 0, tPrep = 0, tModel = 0;
  const t0 = performance.now();
  for (const [f, rec] of recordings) {
    i += 1;
    try {
      for (let w0 = 0; w0 < rec.n_windows; w0 += BATCH) {
        if (stopping) {
          for (const [, other] of recordings) other.destroy();
          r.destroy();
          return post({ type: 'stopped' });
        }
        const w1 = Math.min(rec.n_windows, w0 + BATCH);
        const t = performance.now();
        const x = float32Of(r.frames(rec, w0, w1));
        const t2 = performance.now();
        helpers.add(r, f, w0, await infer(x, w1 - w0));
        tPrep += t2 - t;
        tModel += performance.now() - t2;
        done += w1 - w0;
        const seconds = (performance.now() - t0) / 1000;
        post({ type: 'progress', file: f, i, n: recordings.length, done, total, rate: done / seconds });
      }
      await writeSink(sink, 'predictions.csv', r.end_file(f), true);
    } catch (e) {
      r.fail(f, lastLine(e));
      post({ type: 'log', lines: [`⚠ ${f}: ${lastLine(e)}`] });
    }
    rec.destroy();
  }

  status('Writing the results');
  const result = JSON.parse(r.finish());
  // The tables stay in Python's memory as well, for checking, thresholds and times; clips do not
  for (const path of helpers.out_files().toJs()) if (path !== 'predictions.csv') await copyOut(sink, path);
  if (settings.extract_clips) {
    let n = 0;
    for (const path of r.clips(py.toPy(await existingClips(sink.dir)))) {
      if (path.endsWith('.wav')) await moveOut(sink, path); else await copyOut(sink, path);
      status(`Cutting audio clips: ${++n}`);
    }
  }
  result.messages = r.messages.toJs().slice(shown.length);       // the ones not shown at the start
  result.threshold = settings.threshold;
  result.settings = JSON.parse(new TextDecoder().decode(py.FS.readFile('/out/run_settings.json')));
  lastRun = r;
  setCurrent(sink, inputDir);
  post({ type: 'done', result, backend, saved: sink.opfs ? 'browser' : 'folder', windows: done,
         seconds: (performance.now() - t0) / 1000, prepSeconds: tPrep / 1000, modelSeconds: tModel / 1000 });
}

// ── The results of an earlier session ────────────────────────────────────────────────────────────────────
async function reopen({ folder }) {
  const sink = await sinkOf(folder);
  let modified = null;
  try { modified = (await (await fileHandle(sink.dir, 'species_summary.csv', false)).getFile()).lastModified; }
  catch { return post({ type: 'reopened', result: null }); }
  py.runPython('import shutil; shutil.rmtree("/out", ignore_errors=True)');
  py.FS.mkdirTree('/out/clips');
  for (const f of RESULT_FILES) {
    const bytes = await readSink(sink.dir, f);
    if (bytes) py.FS.writeFile(`/out/${f}`, bytes);
  }
  setCurrent(sink, null);
  post({ type: 'reopened', result: JSON.parse(current.results.summary()), saved: sink.opfs ? 'browser' : 'folder',
         modified });
}

// ── Before a run: what the chosen recordings hold, from their headers ───────────────────────────────────
async function check({ files, inputDir, hop_s }) {
  try { py.FS.unmount('/check'); } catch { /* first check */ }
  py.FS.mkdirTree('/check');
  py.FS.mount(py.FS.filesystems.WORKERFS, { blobs: files.map((f) => ({ name: f.path, data: f.file })) }, '/check');
  post({ type: 'checked', summary: JSON.parse(helpers.check_recordings(`/check/${inputDir}`, hop_s)) });
}

// ── Checking detections ──────────────────────────────────────────────────────────────────────────────────
function needResults() {
  if (!current) throw new Error('There are no results to work on yet. Analyse some recordings first.');
}

async function species({ name, perBand }) {
  needResults();
  post({ type: 'species', data: JSON.parse(current.results.species(name, perBand)),
         counts: JSON.parse(current.results.checked_counts()) });
}

async function counts() {
  needResults();
  post({ type: 'counts', counts: JSON.parse(current.results.checked_counts()) });
}

async function verdict({ file, start_s, species: name, verdict: v, perBand }) {
  needResults();
  await pushOut(current.results.set_verdict(file, start_s, name, v));
  post({ type: 'species', data: JSON.parse(current.results.species(name, perBand)),
         counts: JSON.parse(current.results.checked_counts()), keepScroll: true });
}

// A clip of one detection with its spectrogram: from the recording if it is here, otherwise from the clip
// cut by §7 (which may have been sorted into a sub-folder since)
async function clip({ file, start_s, end_s, species: name, extra, key }) {
  needResults();
  let path, offset, duration, windowAt;
  const recording = current.inputDir && `/data/${current.inputDir}/${file}`;
  if (recording && exists(recording)) {
    offset = Math.max(0, start_s - extra);
    duration = end_s - start_s + 2 * extra;
    path = recording;
    windowAt = start_s - offset;
  } else {
    const where = current.results.clip_name(file, start_s, name);
    const clipName = where && where.split('/').at(-1);
    const found = where && (await listSink(current.sink.dir, where.split('/').slice(0, 2).join('/')))
      .find((p) => p.endsWith(`/${clipName}`));
    const bytes = found && await readSink(current.sink.dir, found);
    if (!bytes) throw new Error('To listen, choose the same recordings again.');
    py.FS.writeFile('/tmp/apus_clip.wav', bytes);
    path = '/tmp/apus_clip.wav';
    offset = 0;
    duration = 3600;
  }
  const t = helpers.clip(path, offset, duration);
  const audio = float32Of(t.get(0));
  const specProxy = t.get(1);
  const spec = specProxy.toJs();
  specProxy.destroy();
  const w = t.get(2), h = t.get(3);
  t.destroy();
  if (windowAt === undefined) {                                  // a cut clip: where the 5 s window starts in it
    const seconds = audio.length / 32000, e = (seconds - 5) / 2;
    windowAt = e <= start_s ? e : start_s;
  }
  post({ type: 'clip', key, audio, spec, w, h, windowAt }, [audio.buffer, spec.buffer]);
}

// ── §9: a threshold per species ─────────────────────────────────────────────────────────────────────────
async function calibrate({ target, minClips }) {
  needResults();
  if (!sklearn) {
    post({ type: 'tool-status', for: 'calibrate', text: 'Loading scikit-learn (4.6 MB, only the first time)' });
    await py.loadPackage(['scikit-learn']);
    sklearn = true;
  }
  const sorted = (await listSink(current.sink.dir, 'clips')).filter((p) => p.split('/').length >= 4);
  const data = JSON.parse(current.results.calibrate(target, minClips, py.toPy(sorted)));
  await pushOut('thresholds/thresholds.csv', 'thresholds/precision_by_band.csv', 'detections_species_thresholds.csv');
  post({ type: 'calibrated', data });
}

// ── §8: comparison with annotations or another model ───────────────────────────────────────────────────
async function compare({ files, reference, other, otherName, countUnmatched }) {
  needResults();
  if (!lastRun) throw new Error('Comparing needs the recordings: choose them and press Analyse. Recordings already analysed are skipped.');
  try { py.FS.unmount('/compare'); } catch { /* first comparison */ }
  py.FS.mkdirTree('/compare');
  py.FS.mount(py.FS.filesystems.WORKERFS, { blobs: files.map((f) => ({ name: f.path, data: f.file })) }, '/compare');
  py.runPython('import shutil; shutil.rmtree("/out/comparison", ignore_errors=True)');
  const data = JSON.parse(helpers.compare(lastRun, `/compare/${reference}`, other ? `/compare/${other}` : null,
                                          otherName || 'BirdNET', countUnmatched));
  await pushOut(...helpers.out_files().toJs().filter((p) => p.startsWith('comparison/')));
  post({ type: 'compared', data });
}

// ── Times from file names ───────────────────────────────────────────────────────────────────────────────
async function times({ namesInUtc, offsetMinutes }) {
  needResults();
  if (!exists('/out/predictions.csv')) {
    const bytes = await readSink(current.sink.dir, 'predictions.csv');
    if (!bytes) throw new Error('predictions.csv is not in the output, so the recording effort is unknown.');
    py.FS.writeFile('/out/predictions.csv', bytes);
  }
  const data = JSON.parse(current.results.times(namesInUtc, offsetMinutes));
  await pushOut('detection_times.csv');
  post({ type: 'times', data });
}

// ── Deleting the results kept in this browser: here, in the queue, so a run asked for next waits for it ──
async function clear() {
  try { await (await navigator.storage.getDirectory()).removeEntry('apus-results', { recursive: true }); }
  catch (e) { if (e?.name !== 'NotFoundError') throw e; }
  const shown = !!current?.sink.opfs;
  if (shown) {                                   // the results on show were those files: forget them too
    current.results.destroy();
    current = null;
    lastRun?.destroy();
    lastRun = null;
  }
  post({ type: 'cleared', shown });
}

// One request at a time, in order: Python must not be entered by two of them at once. Stop jumps the queue.
const requests = { init, run, reopen, check, species, counts, verdict, clip, calibrate, compare, times, clear };
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.type === 'stop') { stopping = true; return; }
  queue = queue.then(() => requests[data.type]?.(data))
    .catch((e) => post({ type: 'error', message: lastLine(e), for: data.type, key: data.key }));
};

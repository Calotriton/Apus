// Apus worker: Python (Pyodide) runs the notebook's logic (ADR 0003); ONNX Runtime Web runs Perch 2.0.
// In:  {type: 'init', backend: 'auto' | 'cpu'}, {type: 'run', ...}, {type: 'stop'}
// Out: status, ready, log, progress, confirm-replace, done, stopped, error
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs';

const VERSION = '0.1.0';
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
const PY_FILES = ['__init__.py', 'audio.py', 'names.py', 'project.py', 'selftest.py', 'builtin_synonyms.txt',
                  'selftest_probs.f32'];
const WINDOW = 160000;
const BATCH = 4;                     // a one-minute recording at a 5 s hop is three full batches

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';

let py, project, helpers, session, backend, classes, stopping = false;
const post = (message) => self.postMessage(message);
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
from apus.project import softmax
def add(run, file, w0, logits):
    run.add(file, w0, np.asarray(logits.to_py(), dtype=np.float32))
def check(logits):
    return list(selftest.check(softmax(np.asarray(logits.to_py(), dtype=np.float32))))
def signal():
    return selftest.signal()
def out_files():
    import os
    return [os.path.relpath(os.path.join(d, n), "/out") for d, _, names in os.walk("/out") for n in names]
{"add": add, "check": check, "signal": signal, "out_files": out_files}
`);
  helpers = Object.fromEntries(['add', 'check', 'signal', 'out_files'].map((k) => [k, fns.get(k)]));
  fns.destroy();
}

const float32Of = (proxy) => {
  const buf = proxy.getBuffer('f32');
  const copy = new Float32Array(buf.data);
  buf.release();
  proxy.destroy();
  return copy;
};

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

async function init({ backend: preference }) {
  await startPython();
  const model = await modelFile(FILES.model, 'Perch 2.0 (409 MB, only the first time)');
  const text = async (f) => new TextDecoder().decode(await modelFile(f, 'class names'));
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
          note = `The graphics card's results differ from Perch's (by up to ${worst.toExponential(1)}), so the CPU is used.`;
        }
      }
    } catch (e) {
      session = null;
      note = `The graphics card could not run Perch (${lastLine(e)}), so the CPU is used.`;
    }
  }
  if (!backend) {
    status('Preparing the CPU');
    backend = 'CPU';
    const [ok, worst] = await selfTest(await ort.InferenceSession.create(model, { executionProviders: ['wasm'] }));
    if (!ok) throw new Error(`Perch gives unexpected results in this browser (by up to ${worst}).`);
    backend = `CPU (${ort.env.wasm.numThreads} thread${ort.env.wasm.numThreads === 1 ? '' : 's'})`;
  }
  post({ type: 'ready', backend, note, version: VERSION, isolated: self.crossOriginIsolated });
}

// ── Output: the user's folder (Chrome, Edge) or the browser's own storage (every browser) ──────────────────
const opfsRoot = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('apus-results', { create: true });

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

// 'species_folder/clip.wav' for every clip already in the output folder, sorted into sub-folders or not
async function existingClips(dir) {
  const names = [];
  let clips;
  try { clips = await dir.getDirectoryHandle('clips'); } catch { return names; }
  async function walk(d, species) {
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') await walk(h, species ?? name);
      else if (species && name.endsWith('.wav')) names.push(`${species}/${name}`);
    }
  }
  await walk(clips, null);
  return names;
}

async function moveOut(sink, path) {                 // from Python's memory to the output, then forget it
  await writeSink(sink, path, py.FS.readFile(`/out/${path}`));
  py.FS.unlink(`/out/${path}`);
}

// ── A run ────────────────────────────────────────────────────────────────────────────────────────────────
async function run({ files, inputDir, settings, folder, replace }) {
  stopping = false;
  const sink = folder ? { dir: folder, opfs: false } : { dir: await opfsRoot(), opfs: true };
  const previous = await readSink(sink.dir, 'predictions.csv');
  if (previous && !settings.resume && !replace) return post({ type: 'confirm-replace' });
  if (previous && !settings.resume) await removeSink(sink.dir, 'predictions.csv');

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
  for (const path of helpers.out_files().toJs()) if (path !== 'predictions.csv') await moveOut(sink, path);
  if (settings.extract_clips) {
    let n = 0;
    for (const path of r.clips(py.toPy(await existingClips(sink.dir)))) {
      await moveOut(sink, path);
      status(`Cutting audio clips: ${++n}`);
    }
  }
  result.messages = r.messages.toJs().slice(shown.length);       // the ones not shown at the start
  r.destroy();
  post({ type: 'done', result, backend, saved: sink.opfs ? 'browser' : 'folder', windows: done,
         seconds: (performance.now() - t0) / 1000, prepSeconds: tPrep / 1000, modelSeconds: tModel / 1000 });
}

self.onmessage = async ({ data }) => {
  if (data.type === 'stop') { stopping = true; return; }
  try {
    if (data.type === 'init') await init(data);
    else if (data.type === 'run') await run(data);
  } catch (e) {
    post({ type: 'error', message: lastLine(e) });
  }
};

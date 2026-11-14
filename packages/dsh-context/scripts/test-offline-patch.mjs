#!/usr/bin/env node
// test-offline-patch.mjs — self-contained assertions for the offline patch.
// Zero external deps (Node built-ins only; no zod, vitest, or network).
//
// Checks:
//   1. ORIGINAL upstream/package still contains the exact fetch/icon literals
//      with their expected counts: 3 network-fetch sites in lib/index.js and
//      2 CDN-icon sites across lib/index.js + lib/client.js.
//   2. After patching, lib/index.js has 0 `fetch(` expressions.
//   3. `node --check` passes on both patched files.
//   4. The remote CDN icon literal is gone from both files; the local
//      data:image/svg+xml icon is present in both.
//   5. Actual blocking: extract the 3 patched fetch functions and run them in
//      node:vm with a REAL fetch spy injected as the global — assert the spy
//      is called 0 times and each call rejects (proves the block happens
//      before any network use, without needing a live network).
//   6. Static scan: the blocked external hosts are no longer fetched, and no
//      new network primitive was introduced.
//
// Usage: node scripts/test-offline-patch.mjs [pluginRootDir] [upstreamPackageDir]

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require_ = createRequire(import.meta.url);
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Locate the pristine upstream/package (extracted original, unmodified) so the
// "original exact-match counts" section can verify the patch targeted the right
// literals. Search known locations; pass an explicit path as argv[3] if none fit.
function findUpstream(explicit) {
  if (explicit) return resolve(explicit);
  const candidates = [
    resolve(PKG_ROOT, '..', '..', 'upstream', 'package'), // staged/dsh-context -> root
    resolve(PKG_ROOT, '..', 'upstream', 'package'),
    resolve(PKG_ROOT, 'upstream', 'package'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(join(c, 'lib', 'index.js'), 'utf8');
      return c;
    } catch {}
  }
  console.error(
    'FAIL  could not locate pristine upstream/package (pass its dir as argv[3]); ' +
      'cannot verify original exact-match counts.',
  );
  process.exit(1);
}
const root = process.argv[2] ? resolve(process.argv[2]) : PKG_ROOT;
const upstream = findUpstream(process.argv[3]);

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    console.log(`  ok   ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}`);
  }
};
const count = (s, lit) => s.split(lit).length - 1;

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

const F_INDEX = 'let Xa=(e,t)=>fetch(e,t)';
const F_RECOM = 'let Gl=(e,t)=>fetch(e,t)';
const F_CATALOG = 'e.fetch??((e,t)=>fetch(e,t))';
const ICON = '`https://cdn.simpleicons.org/deepseek`';

// --- 1. original exact-match counts (proves patch targets were right) ------
console.log('\n[1] original upstream/package literal counts (must be exact)');
const oIdx = read(upstream, 'lib/index.js');
const oCli = read(upstream, 'lib/client.js');
ok(count(oIdx, F_CATALOG) === 1, 'index.js: catalog Qi fetch literal x1');
ok(count(oIdx, F_INDEX) === 1, 'index.js: balance Xa fetch literal x1');
ok(count(oIdx, F_RECOM) === 1, 'index.js: recom Gl fetch literal x1');
ok(
  count(oIdx, 'fetch(') === 3,
  'index.js: total network fetch( sites == 3 (no others)',
);
ok(count(oIdx, ICON) === 1, 'index.js: CDN icon literal x1');
ok(count(oCli, ICON) === 1, 'client.js: CDN icon literal x1');
ok(count(oIdx, ICON) + count(oCli, ICON) === 2, 'CDN icon total across files == 2');

// --- 2. patched index.js has zero fetch expressions ------------------------
console.log('\n[2] patched lib/index.js network scan');
const pIdx = read(root, 'lib/index.js');
const pCli = read(root, 'lib/client.js');
ok(count(pIdx, 'fetch(') === 0, 'index.js: fetch( expressions == 0');
ok(count(pIdx, 'fetch??') === 1, 'index.js: Qi fetch?? hook still present (import shape kept)');
ok(count(pIdx, MARK_SENTINEL()) === 3, '3 offline-blocked sentinels (one per fetch site; icons are a plain literal swap)');
ok(count(pIdx, ICON) === 0, 'index.js: CDN icon literal removed');
ok(count(pCli, ICON) === 0, 'client.js: CDN icon literal removed');
ok(
  pIdx.includes('data:image/svg+xml,') && pCli.includes('data:image/svg+xml,'),
  'both files carry local data:image/svg+xml icon',
);

// --- 3. node --check on both files -----------------------------------------
console.log('\n[3] node --check');
for (const rel of ['lib/index.js', 'lib/client.js']) {
  const r = spawnSync(process.execPath, ['--check', join(root, rel)], {
    encoding: 'utf8',
  });
  ok(r.status === 0, `node --check ${rel}${r.status === 0 ? '' : ' :: ' + r.stderr}`);
}

// --- 5. actual blocking via node:vm with a real fetch spy ------------------
console.log('\n[4] vm blocking test — real fetch spy must see 0 calls');
// Extract the patched stub as a valid Expression. Anchors point at the token
// just before the wrapping `(` so we capture the full `(async()=>{...})` plus
// any trailing sentinel comment, which vm can evaluate directly.
const Xa = extractParenExpr(pIdx, 'let Xa=');
const Gl = extractParenExpr(pIdx, 'let Gl=');
const QiCatalog = extractParenExpr(pIdx, 'e.fetch??'); // patched default expr

async function spyAndAssert(label, src) {
  let calls = 0;
  const sandbox = {
    fetch: (...a) => {
      calls++;
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
    Response,
    AbortSignal,
    Promise,
    Error,
    Object,
    Array,
    JSON,
    console,
  };
  const ctx = vm.createContext(sandbox);
  const fn = vm.runInContext(`(${src})`, ctx);
  let rejected = false;
  let err;
  try {
    await fn('https://api.deepseek.com/user/balance', {});
  } catch (e) {
    rejected = true;
    err = e;
  }
  ok(rejected, `${label}: rejects offline error`);
  ok(calls === 0, `${label}: global fetch spy called 0 times`);
  ok(
    rejected && /offline/.test(String(err && err.message)),
    `${label}: error message says offline (was: ${err && err.message})`,
  );
  return sandbox;
}

await spyAndAssert('Xa balance', Xa);
await spyAndAssert('Gl recom', Gl);

// Catalog: rebuild Qi's inner `u(e)` which invokes the patched fetch default.
{
  let calls = 0;
  const sandbox = {
    fetch: (...a) => {
      calls++;
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
    Response,
    AbortSignal,
    Promise,
    Error,
    Object,
    Array,
    JSON,
  };
  const ctx = vm.createContext(sandbox);
  // Evaluate the patched default fetch expression in isolation; calling it must
  // reject without touching the injected global fetch.
  const fn = vm.runInContext(`(${QiCatalog})`, ctx);
  let rejected = false;
  let err;
  try {
    await fn('https://models.dev/api.json', {});
  } catch (e) {
    rejected = true;
    err = e;
  }
  ok(rejected, 'catalog default fetch: rejects offline error');
  ok(calls === 0, 'catalog default fetch: global fetch spy called 0 times');
  ok(
    rejected && /offline/.test(String(err && err.message)),
    `catalog default fetch: message says offline (was: ${err && err.message})`,
  );
}

// --- 6. static scan: no blocked-host fetch remains, no new primitive -------
console.log('\n[5] static scan (blocked hosts not reachable, no new network API)');
for (const host of [
  'registry.npmjs.org',
  'registry.npmmirror.com',
  'models.dev/api.json',
  'raw.githubusercontent.com/bowenliang123/dsh-context/main/data/recoms.json',
  'gh-proxy.org',
]) {
  // Host strings may remain in inert data (lists), but must not appear inside a
  // live fetch(...) call. Since index.js has 0 fetch( at all, that holds.
  ok(!new RegExp('fetch\\([^)]*' + host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(pIdx),
    `index.js: no fetch(...) referencing ${host}`);
}
ok(count(pIdx, 'XMLHttpRequest') === 0 && count(pCli, 'XMLHttpRequest') === 0,
  'no XMLHttpRequest introduced');
ok(count(pIdx, 'new WebSocket') === 0 && count(pCli, 'new WebSocket') === 0,
  'no WebSocket introduced');

// --- helpers ---------------------------------------------------------------
function MARK_SENTINEL() {
  return '/*dsh-context:offline-blocked*/';
}

// Extract a balanced parenthesized expression (plus a trailing /*comment*/)
// starting at the first `(` after `anchor`. Returns text that is a valid JS
// Expression (e.g. `(async()=>{throw Error("…")})/*…*/`), ready for vm.
function extractParenExpr(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error('anchor not found: ' + anchor);
  let p = i + anchor.length;
  while (src[p] === ' ') p++;
  if (src[p] !== '(') throw new Error('expected ( after ' + anchor + ' (got ' + JSON.stringify(src.slice(p, p + 24)) + ')');
  let depth = 0;
  let j = p;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  // absorb a trailing sentinel comment right after the closing paren
  let tail = src.slice(j);
  const cm = tail.match(/^\s*\/\*[\s\S]*?\*\//);
  if (cm) j += cm[0].length;
  return src.slice(p, j);
}

// --- summary ---------------------------------------------------------------
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

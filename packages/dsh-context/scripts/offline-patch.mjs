#!/usr/bin/env node
// offline-patch.mjs — minimal offline hardening for dsh-context 0.83.0.
//
// WHAT IT DOES (exactly, nothing more):
//   1. lib/index.js — replaces the 3 bundled network fetch closures with local
//      Promise.reject stubs, so no request ever leaves the process:
//        a. `Qi` catalog/price fetch default  e.fetch ?? ((e,t) => fetch(e,t))
//           -> blocks npm version catalog (registry.npmjs.org / npmmirror) AND
//              the price catalog (models.dev/api.json), both routed through it.
//        b. `Xa` balance fetch               let Xa = (e,t) => fetch(e,t)
//           -> blocks POST {baseUrl}/user/balance (0 bytes sent).
//        c. `Gl` recommendation fetch          let Gl = (e,t) => fetch(e,t)
//           -> blocks GitHub raw rems.json + gh-proxy.org mirror; callers already
//              fall back to the local bundled recommendation on failure.
//   2. Icon swap: the fallback recommendation icon
//      `https://cdn.simpleicons.org/deepseek` (1x in lib/index.js, 1x in
//      lib/client.js) is replaced by a small inline data:image/svg+xml icon, so
//      the client never auto-requests the CDN. Remote recommendation icons stay
//      as-is — they are only reachable after Gl already rejects (fallback path).
//
// It does NOT touch global fetch, DSH tools, imports, Fleet/Context UI,
// prompts, locales, or package.json. Idempotent: re-running is a no-op.
//
// Usage:  node scripts/offline-patch.mjs [pluginRootDir]   (default: package root)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = process.argv[2] ? resolve(process.argv[2]) : PKG_ROOT;

// Sentinel comment marking a site as already patched.
const MARK = '/*dsh-context:offline-blocked*/';

// Rejection used at all three fetch sites. IMPORTANT: the `async` keyword must
// sit immediately before its `()=>`, or ASI-less minified code parses `async`
// as a bare identifier call -> runtime ReferenceError (node --check does NOT
// catch this). The whole arrow is wrapped in one paren pair so the sentinel
// comment can trail the closing paren without breaking the async-arrow parse.
// Synchronous `throw` inside the async arrow == Promise.reject(...), rejecting
// before any socket is opened.
const REJECT = (msg) =>
  `(async()=>{throw Error(${JSON.stringify(msg)})})${MARK}`;

// 14x14 dark rounded square with a light 'C' — self-contained, no CDN.
const ICON_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
      '<rect width="16" height="16" rx="4" fill="#5786FE"/>' +
      '<text x="8" y="11.6" font-family="sans-serif" font-size="10" ' +
      'font-weight="bold" text-anchor="middle" fill="#ffffff">C</text>' +
      '</svg>',
  );

const REMOTE_ICON = 'https://cdn.simpleicons.org/deepseek';

const INDEX_EDITS = [
  {
    label: 'index:catalog(Qi) — version catalog + models.dev price book',
    find: 'e.fetch??((e,t)=>fetch(e,t))',
    replace: `e.fetch??${REJECT('dsh-context offline: version/price catalog fetch blocked (no network)')}`,
  },
  {
    label: 'index:balance(Xa) — /user/balance',
    find: 'let Xa=(e,t)=>fetch(e,t)',
    replace: `let Xa=${REJECT('dsh-context offline: balance fetch blocked (no network)')}`,
  },
  {
    label: 'index:recom(Gl) — GitHub raw / gh-proxy recommendations',
    find: 'let Gl=(e,t)=>fetch(e,t)',
    replace: `let Gl=${REJECT('dsh-context offline: recommendation fetch blocked (no network)')}`,
  },
];

const ICON_EDIT = {
  label: 'icon — cdn.simpleicons.org -> local data:image/svg+xml',
  find: '`' + REMOTE_ICON + '`',
  replace: '`' + ICON_DATA_URI + '`',
};

const TARGETS = [
  { file: 'lib/index.js', edits: [...INDEX_EDITS, ICON_EDIT] },
  { file: 'lib/client.js', edits: [ICON_EDIT] },
];

let changed = 0;
for (const { file, edits } of TARGETS) {
  const path = join(root, file);
  let src = readFileSync(path, 'utf8');
  for (const { label, find, replace } of edits) {
    const hits = src.split(find).length - 1;
    if (hits === 0 && src.includes(replace)) {
      console.log('skip  ' + file + '  ' + label + '  (already patched)');
      continue;
    }
    if (hits !== 1) {
      console.error(
        'FAIL  ' + file + '  ' + label + ': expected exactly 1 occurrence of ' +
          JSON.stringify(find.slice(0, 48)) + ', found ' + hits,
      );
      process.exit(1);
    }
    src = src.replace(find, replace);
    changed += 1;
    console.log('patch ' + file + '  ' + label);
  }
  writeFileSync(path, src);
}

console.log('\ndone: ' + changed + ' edit(s) applied under ' + root);
if (changed === 0) console.log('(no changes — already fully patched)');

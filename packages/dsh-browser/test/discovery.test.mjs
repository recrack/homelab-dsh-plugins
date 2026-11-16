import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserCandidates, discoverInstalledBrowser } from '../lib/index.js'

test('browser discovery covers Chrome, Edge, Chromium and operator override on macOS', () => {
  const rows = browserCandidates({ platform: 'darwin', home: '/Users/tester', env: { DSHPLUGIN_BROWSER_EXECUTABLE_PATH: '/opt/browser' } })
  assert.deepEqual(rows[0], { path: '/opt/browser', channel: 'custom' })
  assert.ok(rows.some((row) => row.channel === 'chrome'))
  assert.ok(rows.some((row) => row.channel === 'edge'))
  assert.ok(rows.some((row) => row.channel === 'chromium'))
  assert.equal(new Set(rows.map((row) => row.path)).size, rows.length)
})

test('browser discovery constructs Windows candidates without host-path leakage', () => {
  const rows = browserCandidates({
    platform: 'win32',
    home: 'C:\\Users\\tester',
    env: { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
  })
  assert.ok(rows.some((row) => row.path === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'))
  assert.ok(rows.some((row) => row.path.endsWith('Microsoft\\Edge\\Application\\msedge.exe')))
})

test('Camoufox discovery uses an explicit executable without trying to fetch a browser', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-camoufox-discovery-'))
  const executablePath = join(root, 'camoufox')
  try {
    await writeFile(executablePath, 'binary')
    const found = await discoverInstalledBrowser({
      engine: 'camoufox',
      platform: 'win32',
      env: { CAMOUFOX_EXECUTABLE_PATH: executablePath },
    })
    assert.deepEqual(found, { path: executablePath, channel: 'camoufox' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

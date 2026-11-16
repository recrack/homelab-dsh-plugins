import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserManager } from '../lib/index.js'

test('preinstalled Camoufox starts a session, acts, and blocks redirects', { timeout: 60_000 }, async (t) => {
  if (!process.env.CAMOUFOX_EXECUTABLE_PATH || !process.env.CAMOUFOX_FPGEN_DATA) {
    t.skip('set CAMOUFOX_EXECUTABLE_PATH and CAMOUFOX_FPGEN_DATA to run the preinstalled Camoufox browser')
    return
  }

  let port = 0
  let blockedHits = 0
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`)
    if (url.pathname === '/redirect') {
      response.writeHead(302, { location: `http://localhost:${port}/blocked` })
      response.end()
      return
    }
    if (url.pathname === '/blocked') blockedHits += 1
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><button onclick="this.dataset.clicked=\'yes\'">Test Camoufox</button>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
  const origin = `http://127.0.0.1:${port}`
  const rootDir = await mkdtemp(join(tmpdir(), 'dsh-browser-camoufox-runtime-'))
  let manager
  try {
    manager = new BrowserManager({
      engine: 'camoufox',
      rootDir,
      allowedOrigins: [origin],
      discoverBrowser: async () => ({ path: process.env.CAMOUFOX_EXECUTABLE_PATH, channel: 'camoufox' }),
    })
    const started = await manager.start('camoufox-runtime', { url: origin })
    assert.equal(started.browser.channel, 'camoufox')
    const observation = await manager.observe('camoufox-runtime')
    const button = observation.nodes.find((node) => node.name === 'Test Camoufox')
    assert.ok(button)
    const clicked = await manager.act('camoufox-runtime', { kind: 'click', ref: button.ref })
    assert.equal(clicked.status, 'confirmed')

    const redirected = await manager.act('camoufox-runtime', { kind: 'navigate', url: `${origin}/redirect` })
    assert.notEqual(redirected.status, 'confirmed')
    assert.equal(blockedHits, 0, 'redirect reached the disallowed origin')
  } finally {
    try {
      await manager?.dispose()
    } finally {
      try {
        server.closeAllConnections?.()
        await new Promise((resolve) => server.close(resolve))
      } finally {
        const leftovers = await readdir(rootDir)
        await rm(rootDir, { recursive: true, force: true })
        assert.deepEqual(leftovers, [])
      }
    }
  }
})

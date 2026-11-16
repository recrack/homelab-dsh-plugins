import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Camoufox } from 'camoufox'
import { ensureModel } from 'fpgen-js'
import { getActivePath } from 'camoufox/dist/multiversion.js'
import { launchPath } from 'camoufox/dist/pkgman.js'

const outputPath = process.argv[2]
assert.ok(outputPath, 'usage: node scripts/prefetch-camoufox.mjs <executable-path-file>')

const activePath = getActivePath()
assert.ok(activePath, 'No active Camoufox build is installed; run `camoufox fetch` first.')
const executablePath = launchPath(activePath)
await access(executablePath, constants.X_OK)
await ensureModel()

const profileDir = await mkdtemp(join(tmpdir(), 'dsh-browser-camoufox-prefetch-'))
let context
try {
  context = await Camoufox({
    headless: true,
    persistent_context: true,
    noViewport: true,
    user_data_dir: profileDir,
    executable_path: executablePath,
    geoip: false,
    firefox_user_prefs: {
      'app.update.enabled': false,
      'browser.shell.checkDefaultBrowser': false,
      'datareporting.healthreport.uploadEnabled': false,
      'datareporting.policy.dataSubmissionEnabled': false,
      'dom.serviceWorkers.enabled': false,
      'extensions.update.enabled': false,
      'toolkit.telemetry.enabled': false,
      'toolkit.telemetry.unified': false,
    },
  })
  await context.setOffline(true)
  await context.close()
  context = undefined
  const target = resolve(outputPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${executablePath}\n`, { mode: 0o444 })
} finally {
  if (context) await context.close().catch(() => {})
  await rm(profileDir, { recursive: true, force: true })
}

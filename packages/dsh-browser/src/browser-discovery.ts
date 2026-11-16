import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'
import { pluginEnv, pluginEnvName } from './plugin-env.js'

/** Suffix of the operator-only executable-path override (see plugin-env.ts). */
export const BROWSER_EXECUTABLE_PATH_ENV_SUFFIX = 'BROWSER_EXECUTABLE_PATH'

export type BrowserEngine = 'chromium' | 'camoufox'
export type BrowserChannel = 'chrome' | 'edge' | 'chromium' | 'custom' | 'camoufox'

export interface BrowserExecutable {
  path: string
  channel: BrowserChannel
}

export interface BrowserDiscoveryInput {
  engine?: BrowserEngine
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
}

/** Candidate list only; kept pure so every platform branch is unit-testable. */
export function browserCandidates(input: BrowserDiscoveryInput = {}): BrowserExecutable[] {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  const home = input.home ?? homedir()
  const candidates: BrowserExecutable[] = []
  const override = pluginEnv(BROWSER_EXECUTABLE_PATH_ENV_SUFFIX, { env })?.trim()
  if (override) candidates.push({ path: override, channel: 'custom' })

  if (platform === 'darwin') {
    candidates.push(
      { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', channel: 'chrome' },
      { path: join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), channel: 'chrome' },
      { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', channel: 'edge' },
      { path: join(home, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), channel: 'edge' },
      { path: '/Applications/Chromium.app/Contents/MacOS/Chromium', channel: 'chromium' },
      { path: join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium'), channel: 'chromium' },
    )
  } else if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
    for (const root of roots) {
      candidates.push(
        { path: win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), channel: 'chrome' },
        { path: win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), channel: 'edge' },
        { path: win32.join(root, 'Chromium', 'Application', 'chrome.exe'), channel: 'chromium' },
      )
    }
  } else {
    candidates.push(
      { path: '/usr/bin/google-chrome', channel: 'chrome' },
      { path: '/usr/bin/google-chrome-stable', channel: 'chrome' },
      { path: '/opt/google/chrome/chrome', channel: 'chrome' },
      { path: '/usr/bin/microsoft-edge', channel: 'edge' },
      { path: '/usr/bin/microsoft-edge-stable', channel: 'edge' },
      { path: '/usr/bin/chromium', channel: 'chromium' },
      { path: '/usr/bin/chromium-browser', channel: 'chromium' },
      { path: '/snap/bin/chromium', channel: 'chromium' },
    )
  }

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false
    seen.add(candidate.path)
    return true
  })
}

export async function discoverInstalledBrowser(input: BrowserDiscoveryInput = {}): Promise<BrowserExecutable> {
  const engine = input.engine ?? 'chromium'
  if (engine === 'camoufox') {
    const env = input.env ?? process.env
    const override = pluginEnv(BROWSER_EXECUTABLE_PATH_ENV_SUFFIX, { env })?.trim()
      || env.CAMOUFOX_EXECUTABLE_PATH?.trim()
    if (override) return await assertExecutable(override, 'camoufox', input.platform ?? process.platform)

    const [{ getActivePath }, { launchPath }] = await Promise.all([
      import('camoufox/dist/multiversion.js'),
      import('camoufox/dist/pkgman.js'),
    ])
    const activePath = getActivePath()
    if (activePath === null) {
      throw new Error('No active Camoufox build is installed. Install it during image build with `camoufox fetch`.')
    }
    return await assertExecutable(launchPath(activePath), 'camoufox', input.platform ?? process.platform)
  }

  for (const candidate of browserCandidates(input)) {
    try {
      return await assertExecutable(candidate.path, candidate.channel, input.platform ?? process.platform)
    } catch {
      // Try the next known installed-browser location.
    }
  }
  throw new Error(
    'No supported browser executable was found. Install Google Chrome, Microsoft Edge, or Chromium; '
      + `operators may set ${pluginEnvName(BROWSER_EXECUTABLE_PATH_ENV_SUFFIX)} to an absolute browser executable.`,
  )
}

async function assertExecutable(path: string, channel: BrowserChannel, platform: NodeJS.Platform): Promise<BrowserExecutable> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`Browser executable is not a file: ${path}`)
  await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
  return { path, channel }
}

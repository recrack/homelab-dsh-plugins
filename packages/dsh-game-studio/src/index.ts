/**
 * dsh-game-studio Host plugin: agent tools and one `/game-studio` command that
 * share the same operations, so the sidebar buttons and the agent do exactly
 * the same thing.
 */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  applyCandidate, generateCandidates, prepareGeneration, revertSlot, writeState,
  type CandidateMeta, type Generation, type ImageGenerator,
} from './assets.ts'
import { buildProject } from './build.ts'
import { runCodexBatch, type CodexBatch } from './generation.ts'
import {
  DEFAULT_GITHUB_REPO, GH_AUTH_AGENT_HINT, ghInstallCommand, NO_GH_AGENT_HINT,
} from './github.ts'
import {
  exportProjectHtml, publishProjectToPages, restoreProjectVersion, shareProjectGame,
} from './operations.ts'
import { openaiCost } from './pricing.ts'
import { describePlaytest, GAME_STATE_CONTRACT, playtest, PLAYTEST_PLATFORMS, RENDERS_CONTRACT, type PlaytestPlatform } from './playtest.ts'
import { loadReference, type ReferenceImage } from './reference.ts'
import { stopAllShares, stopShare, type ShareScope } from './share.ts'
import { askToShare, askToSpend, spendNotice } from './spend.ts'
import { cloudflaredInstallCommand, NO_TUNNEL_AGENT_HINT, requireCloudflared } from './tunnel.ts'
import { listVersions } from './versions.ts'
import { exportWall, listGames, type WallLang } from './wall.ts'
import { exportWechatProject, findWechatCli, NO_WECHAT_CLI_HINT, uploadWechatProject } from './wechat.ts'
import { createProject, loadManifest, ORIENTATIONS, TEMPLATES, unnamedSlots, type SlotRequest } from './project.ts'
import { CODEX_EFFORTS, resolveCodex, type CodexEffort } from './providers/codex.ts'
import { OPENAI_DEFAULT_MODEL, openaiGenerate } from './providers/openai.ts'
import { resolveInside, shortId, StudioError } from './util.ts'

/** Told to the agent so it never goes looking for how the asset ledger works. */
const EDIT_SLOT_FILES = 'You may draw a slot\'s picture yourself by overwriting its file in assets/ (e.g. write your own SVG); '
  + 'the studio notices on the next build and records it as your edit, so leave assets/ASSETS.json alone.'

const SLOTS_EXAMPLE = '{"hero": "小鸡", "enemy": "狐狸", "card": {"label": "卡面", "size": [256, 384]}, "pickup": null}'

/** The slots argument of game_studio_create, as a JSON string or an object. */
function parseSlots(value: unknown): Record<string, SlotRequest> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) }
    catch { throw new StudioError(`slots must be a JSON object, e.g. ${SLOTS_EXAMPLE}`, 'BAD_SLOTS') }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StudioError(`slots must be a JSON object, e.g. ${SLOTS_EXAMPLE}`, 'BAD_SLOTS')
  }
  return parsed as Record<string, SlotRequest>
}

function namingHint(slots: string[]): string {
  return `The sidebar still calls ${slots.join(', ')} by the template's generic names; set slots.<slot>.label in game.json `
    + 'to the user\'s characters, in their language (e.g. "小鸡"), so the sidebar names them.'
}

export const name = 'dsh-game-studio'
export const inject = ['tools', 'workingDirectory']

export interface Config {
  /** OpenAI image model; pin it so results stay comparable. */
  openaiModel?: string
  /** OpenAI-compatible base URL, e.g. a company gateway. */
  openaiBaseUrl?: string
  /** Name of the credential (or environment variable) holding the API key. */
  openaiCredential?: string
  /** Image service: `auto` uses OpenAI when its key is set and otherwise the Codex CLI. */
  imageProvider?: 'auto' | 'openai' | 'codex'
  /** Codex CLI executable; found on PATH or through the login shell when unset. */
  codexPath?: string
  /** Model for Codex image runs; Codex's own default when unset. */
  codexModel?: string
  /** Reasoning effort for Codex image runs. Default low: the run only calls the image tool. */
  codexReasoningEffort?: CodexEffort
  /** Give up on one Codex image after this many minutes. Default 15. */
  codexTimeoutMinutes?: number
  /** Ask the user to approve each generation (service, image count, expected cost) before it runs. Default true. */
  confirmSpending?: boolean
  /** cloudflared executable for public share links; found on PATH or standard install locations when unset. */
  cloudflaredPath?: string
  /** GitHub CLI (gh) executable for publishing to GitHub Pages; found on PATH or standard install locations when unset. */
  ghPath?: string
  /** Public GitHub repository name (under the signed-in user) for GitHub Pages publishing. Default dsh-games. */
  githubRepo?: string
  /** Maximum time in milliseconds to wait for a GitHub Pages deployment to finish building. Default 180000 (3 minutes). */
  pagesTimeoutMs?: number
  /** Optional path to WeChat DevTools CLI (`wechatide` or `cli`) for uploading WeChat Mini Game experience builds. */
  wechatCliPath?: string
}

const QUALITIES = ['low', 'medium', 'high'] as const

const PROVIDERS = ['openai', 'codex'] as const
type Provider = typeof PROVIDERS[number]

function candidateSummary(item: CandidateMeta) {
  return { number: item.number, id: item.id, file: item.file, pass: item.checks.pass, problems: item.checks.problems, model: item.model }
}

/** Shape the sidebar reads from tool presentation metadata. */
function presentation(kind: string, project: string, extra: Record<string, unknown> = {}) {
  return { studio: 1, kind, project, ...extra } as any
}

export function apply(ctx: any, config: Config = {}): void {
  const model = config.openaiModel ?? OPENAI_DEFAULT_MODEL
  const credentialName = config.openaiCredential ?? 'OPENAI_API_KEY'
  let credentials: any
  let jobs: any
  let approval: any
  let attachments: any

  ctx.inject(['credentials'], (child: any) => {
    credentials = child.credentials
    child.effect(() => () => { credentials = undefined })
  })
  ctx.inject(['jobs'], (child: any) => {
    jobs = child.jobs
    child.effect(() => () => { jobs = undefined })
  })
  ctx.inject(['approval'], (child: any) => {
    approval = child.approval
    child.effect(() => () => { approval = undefined })
  })

  ctx.inject(['attachments'], (child: any) => {
    attachments = child.attachments
    child.effect(() => () => { attachments = undefined })
  })

  ctx.effect(() => () => { stopAllShares() })

  /** Whether the model behind this call can look at images (the same check DSH's read_image makes). */
  async function seesImages(exec: any): Promise<boolean> {
    try {
      const routed = exec.agent?.session?.requestHeader?.()?.config
      const provider = routed?.provider ?? exec.agent?.options?.provider
      const model = routed?.model ?? exec.agent?.options?.model
      const llm = ctx.get?.('llm')
      if (provider === undefined || model === undefined || llm === undefined) return false
      const info = await llm.resolveModelInfo(provider, model, exec.signal)
      return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
    } catch {
      return false
    }
  }

  async function confirmSpend(exec: any, provider: Provider, generation: Generation, count: number, quality: string, reference?: ReferenceImage): Promise<void> {
    if (config.confirmSpending === false) return
    const notice = spendNotice({
      provider, model, label: generation.spec.label, wide: !generation.spec.transparent, count, quality,
      ...(reference ? { reference: reference.name, ...(reference.fromChat ? { referenceFromChat: true } : {}) } : {}),
    })
    await askToSpend(approval, exec, 'game_studio_generate_asset', notice)
  }

  async function apiKey(): Promise<string> {
    try {
      const hit = await credentials?.resolve(credentialName)
      if (typeof hit?.value === 'string' && hit.value.length > 0) return hit.value
    } catch { /* fall through to the environment */ }
    const value = process.env[credentialName]
    if (value) return value
    throw new StudioError(
      `No image-generation key: store a credential named ${credentialName} in DSH, or start DSH with ${credentialName} set. `
      + 'The game still runs with its bundled art without a key.', 'NO_KEY')
  }

  async function hasOpenAIKey(): Promise<boolean> {
    try { await apiKey(); return true } catch { return false }
  }

  async function chooseProvider(requested?: Provider): Promise<Provider> {
    const wanted = requested ?? config.imageProvider ?? 'auto'
    if (wanted !== 'auto') return wanted
    if (await hasOpenAIKey()) return 'openai'
    try { await resolveCodex(config.codexPath); return 'codex' } catch { /* neither is set up */ }
    throw new StudioError(
      `No image service is set up. Store an OpenAI key as ${credentialName} (fast, billed per image), `
      + 'or install and sign in to the Codex CLI (uses your Codex plan, minutes per image). '
      + 'The game still runs with its bundled art without one.', 'NO_PROVIDER')
  }

  async function codexBatch(count: number): Promise<CodexBatch> {
    const effort = config.codexReasoningEffort ?? 'low'
    if (!CODEX_EFFORTS.includes(effort)) throw new StudioError(`codexReasoningEffort must be one of ${CODEX_EFFORTS.join(', ')}`, 'BAD_CONFIG')
    return {
      command: await resolveCodex(config.codexPath), count, effort,
      ...(config.codexModel ? { model: config.codexModel } : {}),
      timeoutMs: Math.max(1, config.codexTimeoutMinutes ?? 15) * 60_000,
    }
  }

  /** Run Codex as an owned background job; the agent gets a completion notice with the candidate ids. */
  function startCodexJob(dir: string, generation: Generation, batch: CodexBatch, exec: any): string {
    return jobs.start({
      kind: 'game-studio',
      label: `Codex: ${batch.count} ${generation.slot} image${batch.count === 1 ? '' : 's'} for ${basename(dir)}`,
      owner: exec.agent.id,
      ...(exec.callId !== undefined ? { toolCall: { callId: exec.callId, rootCallId: exec.rootCallId ?? exec.callId } } : {}),
      run: (job: any) => {
        const controller = new AbortController()
        const done = runCodexBatch(dir, generation, batch, String(job.id), controller.signal, (line) => { job.updateProgress(line) })
          .then(result => ({
            status: result.status,
            ...(result.errors.length > 0 ? { detail: result.errors[0]!.slice(0, 300) } : {}),
            result: JSON.stringify({
              project: dir, slot: generation.slot,
              candidates: result.candidates.sort((a, b) => a.number - b.number)
                .map(item => ({ number: item.number, id: item.id, pass: item.checks.pass, problems: item.checks.problems })),
              errors: result.errors,
              next: 'The candidates are in the Game Studio sidebar, labelled by number. Apply one with game_studio_apply_asset after the user picks it.',
            }),
          }), (error: unknown) => ({ status: 'failed' as const, detail: error instanceof Error ? error.message : String(error) }))
        return { cancel: (reason?: string) => { controller.abort(reason) }, done }
      },
    })
  }

  function generator(signal: AbortSignal): ImageGenerator {
    return async (request) => {
      const response = await openaiGenerate({ ...request, apiKey: await apiKey(), baseUrl: config.openaiBaseUrl, model, signal })
      return { ...response, provider: 'openai' }
    }
  }

  async function projectDir(exec: any, path: string): Promise<string> {
    if (exec.agent === undefined) throw new StudioError('This tool needs an agent session', 'NO_SESSION')
    const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    return resolveInside(cwd, path)
  }

  async function restoreVersion(dir: string, version: number) {
    return restoreProjectVersion(dir, version)
  }

  async function shareGame(dir: string, minutes: number, scope: ShareScope = 'lan', signal?: AbortSignal) {
    return shareProjectGame(dir, minutes, scope, { cloudflaredPath: config.cloudflaredPath, signal })
  }

  async function exportGame(dir: string, fileName?: string) {
    return exportProjectHtml(dir, fileName)
  }

  async function publishToPages(opts: {
    cwd: string
    dir?: string
    wall?: boolean
    projects?: string[]
    remove?: boolean
    lang?: WallLang
    exec?: any
    signal?: AbortSignal
  }) {
    const { exec, ...rest } = opts
    return publishProjectToPages({
      ...rest,
      ghPath: config.ghPath,
      githubRepo: config.githubRepo,
      pagesTimeoutMs: config.pagesTimeoutMs,
      ...(exec !== undefined ? { onApprove: notice => askToShare(approval, exec, 'game_studio_publish', notice) } : {}),
    })
  }

  const projectParam = { type: 'string', required: true, description: 'Game project folder, relative to the working directory.' } as const
  const slotParam = { type: 'string', required: true, description: 'Asset slot name from game.json (the template\'s hero, enemy, pickup, background, or one the game added).' } as const
  const json = { type: 'json' } as const

  ctx.tools.register(defineTool({
    name: 'game_studio_create',
    description: 'Create a playable small web game from a built-in template, build it, and show it in the Game Studio sidebar. '
      + 'Templates: "collector" (default) is a 60-second 2D top-down collect-and-dodge game; "voxel" is the same loop in a 3D voxel world '
      + '(Three.js, WebGL), whose characters are voxel models until the user applies their own art, which then shows as camera-facing sprites. '
      + 'When you reshape the voxel models, edit the boxes listed in MODELS in game.js and keep MODELS and window.__renderSlots. '
      + RENDERS_CONTRACT + ' ' + GAME_STATE_CONTRACT + ' ' + EDIT_SLOT_FILES + ' '
      + 'The new folder contains game.json (title, art style, asset slots, rules; rules are free-form: add any key and read it in game.js '
      + 'as window.GAME.rules.<key>, builds do not check rule names), '
      + 'game.js (the game code you may edit), and assets/.',
    parameters: {
      path: { ...projectParam, description: 'New, empty folder for the game, relative to the working directory.' },
      title: { type: 'string', required: true, description: 'Game title shown on the title screen.' },
      style: { type: 'string', description: 'Art direction shared by all generated assets, e.g. "watercolor storybook, warm palette".' },
      template: { type: 'string', enum: TEMPLATES, description: 'Which template to start from. Default collector; use voxel when the user asks for 3D.' },
      orientation: { type: 'string', enum: ORIENTATIONS, description: 'How the game is held: portrait (default, phone upright) or landscape '
        + '(side-scrollers, wide tracks or boards). Playtests and the sidebar preview follow it; it is saved as "orientation" in game.json.' },
      slots: { type: 'json', description: 'The game\'s art slots, as the sidebar shows them and AI art is made for: an object by slot name. '
        + 'A string renames a template slot after the user\'s character, in the user\'s language; '
        + 'an object {label, transparent (default true; false for a full-screen picture), size [w, h]} adds a new slot, or redraws a template slot to that shape '
        + '(e.g. a full portrait background), with a plain placeholder picture; '
        + 'null drops a template slot the game does not need. Give each kind of picture the game really draws its own slot '
        + '(cards, gems, towers, customers) instead of forcing them into hero / enemy / pickup. '
        + `Each slot's picture reaches game.js as window.GAME.assets.<slot> (a data: URL). E.g. ${SLOTS_EXAMPLE}.` },
    },
    output: {
      schema: json,
      render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args: any, value: any) => presentation('preview', value.project, { buildId: value.build.buildId }),
    },
    async execute(args: any, exec: any) {
      const dir = await projectDir(exec, args.path)
      const manifest = await createProject(dir, {
        title: args.title, style: args.style, template: args.template ?? 'collector', slots: parseSlots(args.slots),
        ...(args.orientation !== undefined ? { orientation: args.orientation } : {}),
      })
      const build = await buildProject(dir, `Created from the ${args.template ?? 'collector'} template`)
      await writeState(dir, build)
      const unnamed = await unnamedSlots(manifest)
      return {
        project: dir, title: manifest.title, orientation: manifest.orientation ?? 'portrait',
        slots: Object.fromEntries(Object.entries(manifest.slots).map(([slot, spec]) => [slot, spec.label])), rules: manifest.rules,
        build: { buildId: build.buildId, bytes: build.bytes },
        note: 'Playable now with bundled art. Read game.json and game.js before you edit them (files you have not read cannot be edited), '
          + 'change rules in game.json or code in game.js, then call game_studio_build.'
          + (unnamed.length > 0 ? ` ${namingHint(unnamed)}` : ''),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_build',
    description: 'Rebuild the game after editing game.json or game.js, and refresh the Game Studio sidebar preview. '
      + 'Always call it after code or rule changes; check `node --check game.js` first if you edited the script. '
      + 'Every build that changed the game is kept as a version the user can go back to; pass a short note saying what changed. '
      + 'To check that the change works, call game_studio_playtest. ' + RENDERS_CONTRACT + ' ' + EDIT_SLOT_FILES,
    parameters: {
      path: projectParam,
      note: { type: 'string', description: 'A few words on what changed, shown in the version list (e.g. "Shield every 5 lanterns").' },
    },
    output: {
      schema: json,
      render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args: any, value: any) => presentation('preview', value.project, { buildId: value.buildId }),
    },
    async execute(args: any, exec: any) {
      const dir = await projectDir(exec, args.path)
      const build = await buildProject(dir, args.note ?? 'Rebuilt')
      await writeState(dir, build)
      const unnamed = await unnamedSlots(await loadManifest(dir))
      return {
        project: dir, buildId: build.buildId, bytes: build.bytes, artifact: build.artifact,
        ...(unnamed.length > 0 ? { note: namingHint(unnamed) } : {}),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_apply_asset',
    description: 'Put one generated candidate into the game for its slot, rebuild, and refresh the preview. '
      + 'The previous asset is kept and can be restored with game_studio_revert_asset.',
    parameters: {
      path: projectParam, slot: slotParam,
      candidate: { type: 'string', required: true, description: 'The candidate\'s number as shown in the sidebar ("2" or "#2"), or its id.' },
    },
    output: {
      schema: json,
      render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args: any, value: any) => presentation('preview', value.project, { buildId: value.buildId }),
    },
    async execute(args: any, exec: any) {
      const dir = await projectDir(exec, args.path)
      const { record, candidate, build } = await applyCandidate(dir, args.slot, String(args.candidate))
      return { project: dir, slot: args.slot, number: candidate.number, file: record.file, buildId: build.buildId, license: record.license }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_revert_asset',
    description: 'Restore the previous asset of a slot, rebuild, and refresh the preview.',
    parameters: { path: projectParam, slot: slotParam },
    output: {
      schema: json,
      render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args: any, value: any) => presentation('preview', value.project, { buildId: value.buildId }),
    },
    async execute(args: any, exec: any) {
      const dir = await projectDir(exec, args.path)
      const { restored, build } = await revertSlot(dir, args.slot)
      return { project: dir, slot: args.slot, restored, buildId: build.buildId }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_list',
    description: 'List the games in the working directory (every folder with game.json and .studio/, up to two levels down), '
      + 'most recently changed first, with title, 2D/3D, whether it is built, and how many versions it has. '
      + 'Use it to find the game the user means ("the penguin game") before editing it, instead of searching the folders yourself. '
      + 'The user sees the same games on the Game wall in the sidebar (+ → Game Studio · My games).',
    parameters: {},
    output: { schema: json, render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(_args: any, exec: any) {
      const cwd = await projectDir(exec, '.')
      const scan = await listGames(cwd, exec.signal)
      return {
        games: scan.games.map(game => ({
          path: relative(cwd, game.project) || '.', title: game.title, dimension: game.dimension ?? 'unknown',
          built: game.built, versions: game.versions, updatedAt: game.updatedAt,
        })),
        ...(scan.partial ? { note: 'The workspace is large; only part of it was searched. Ask the user for the folder if the game is missing.' } : {}),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_export_wall',
    description: 'Export the game wall: one offline HTML page with a tile for every built game in the working directory (or the ones '
      + 'listed), where clicking a tile plays that game full-window. Good for sending to friends or putting on a static host. '
      + 'Written to export/<name>.html in the working directory. Games are not rebuilt; ones never built are left out and reported.',
    parameters: {
      games: { type: 'string', description: 'Optional JSON array of game folders (relative paths from game_studio_list) in display order. Default: every game, newest first.' },
      name: { type: 'string', description: 'File name without extension. Default game-wall.' },
      lang: { type: 'string', enum: ['zh', 'en'], description: 'Page language. Default: zh when the game titles are Chinese, else en.' },
    },
    output: { schema: json, render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args: any, exec: any) {
      const cwd = await projectDir(exec, '.')
      let projects: string[] | undefined
      if (typeof args.games === 'string' && args.games.trim() !== '') {
        let parsed: unknown
        try { parsed = JSON.parse(args.games) } catch { throw new StudioError('games must be a JSON array of folder paths', 'BAD_GAMES') }
        if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) throw new StudioError('games must be a JSON array of folder paths', 'BAD_GAMES')
        projects = parsed
      }
      const result = await exportWall({ root: cwd, projects, name: args.name, lang: args.lang as WallLang | undefined, signal: exec.signal })
      return { ...result, file: relative(cwd, result.file) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_export',
    description: 'Export the game as one self-contained HTML file (no network, works offline, opens in any browser or on a static host) '
      + 'into the project\'s export/ folder.',
    parameters: { path: projectParam, name: { type: 'string', description: 'File name without extension. Defaults to the game title.' } },
    output: {
      schema: json,
      render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args: any, value: any) => presentation('export', value.project, { file: value.file }),
    },
    async execute(args: any, exec: any) {
      const dir = await projectDir(exec, args.path)
      return { project: dir, ...(await exportGame(dir, args.name)) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_export_wechat',
    description: 'Export the game as a ready-to-open WeChat Mini Game package (`<project>/wx-minigame/`) from the exact same `game.js` and `game.json` '
      + 'source, enforcing WeChat\'s 4.00 MB main-package limit. Generates `project.config.json`, `game.json`, universal `weapp-adapter.js` '
      + '(WebGL2 + Canvas2D + multi-touch pointer/touch + `localStorage` + WebAudio + capsule safe-area `window.GAME.safeArea`), '
      + '`wx-config.js` + `window.GAME.watchRewardedAd()` (zero-interstitial IAA helper that defaults to instant free rewards before 100 UV), '
      + 'and `WECHAT_SUBMISSION_DRAFT.md` (pre-filled MP submission copy + 5 mandatory qualification system descriptions). '
      + 'Note: WeChat Mini Games render only to `<canvas id="game">` (2D Canvas or Three.js WebGL + CanvasTexture HUD), never HTML `<div>` overlays; '
      + 'run `game_studio_playtest` with `platform: "wechat"` to verify top-right UI clears WeChat\'s capsule button.',
    parameters: {
      path: projectParam,
      appid: { type: 'string', description: 'WeChat Mini Game AppID (e.g. "wx1234567890abcdef"). Preserves existing AppID on rebuild; defaults to "touristappid" for local DevTools preview.' },
      shareTitle: { type: 'string', description: 'Optional default title for WeChat friend/Moments share cards.' },
      adUnitId: { type: 'string', description: 'Optional Rewarded Video Ad Unit ID ("adunit-..."). Leave empty before reaching 100 cumulative UV.' },
    },
    timeoutMs: 120_000,
    output: {
      schema: json,
      render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args: any, value: any) => presentation('export', value.project, { file: value.outDir }),
    },
    async execute(args: any, exec: any) {
      const dir = await projectDir(exec, args.path)
      return exportWechatProject(dir, {
        ...(typeof args.appid === 'string' && args.appid.trim() ? { appid: args.appid } : {}),
        ...(typeof args.shareTitle === 'string' && args.shareTitle.trim() ? { shareTitle: args.shareTitle } : {}),
        ...(typeof args.adUnitId === 'string' ? { adUnitId: args.adUnitId } : {}),
        signal: exec.signal,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_versions',
    description: 'List the saved versions of the game, newest first. Every build that changed the game is a version '
      + '(code, rules and art together); the user can go back to any of them with game_studio_restore_version.',
    parameters: { path: projectParam },
    output: { schema: json, render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args: any, exec: any) {
      const dir = await projectDir(exec, args.path)
      const versions = await listVersions(dir)
      return {
        project: dir,
        versions: versions.slice(0, 20).map(v => ({ version: v.number, note: v.note, createdAt: v.createdAt, buildId: v.buildId })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_restore_version',
    description: 'Go back to an earlier version of the whole game (code, rules and art), rebuild, and refresh the preview. '
      + 'The current state stays in the list, so going back can be undone the same way.',
    parameters: { path: projectParam, version: { type: 'integer', required: true, description: 'Version number from game_studio_versions or the sidebar.' } },
    output: {
      schema: json,
      render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args: any, value: any) => presentation('preview', value.project, { buildId: value.buildId }),
    },
    async execute(args: any, exec: any) {
      const dir = await projectDir(exec, args.path)
      return { project: dir, ...(await restoreVersion(dir, Math.trunc(args.version))) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'game_studio_playtest',
    description: 'Play the latest game code in a headless Chrome or Edge on this computer and report what happened: '
      + 'phase changes (title → playing → won/lost), best score, hearts, frame rate, script errors, whether the hero stayed in view, '
      + 'and screenshots of the title, mid-game and end screens, plus close-ups of characters the game draws in code. '
      + GAME_STATE_CONTRACT + ' Use this instead of writing your own browser or screenshot scripts. '
      + 'Pass `rules` to change rules for this run only (e.g. {"duration": 3} to reach the win screen, {"hearts": 1} to test losing); '
      + 'the project, its build and its version history are not changed. '
      + 'While reshaping a character, pass characters: true to get only the close-ups, one image per slot, in a few seconds; '
      + 'do not write your own render scripts.',
    parameters: {
      path: projectParam,
      characters: { type: 'boolean', description: 'Only draw the close-ups of code-drawn characters (no play): fast, one image per slot. Default false.' },
      seconds: { type: 'integer', description: 'How long the autopilot plays, 1-60. Default 15.' },
      rules: { type: 'string', description: 'JSON object of rule overrides from game.json for this run only, e.g. {"duration": 3}.' },
      portrait: { type: 'boolean', description: 'true plays on a phone-shaped 390×844 touch screen, false at 960×540 landscape. '
        + 'Default follows "orientation" in game.json (portrait unless it says landscape); set that instead of passing this every time.' },
      platform: { type: 'string', enum: PLAYTEST_PLATFORMS, description: 'Runtime to simulate: "web" (default) or "wechat" (injects wx.* APIs, single-WebGL check, and renders WeChat\'s top-right capsule button on screenshots so UI collisions are immediately visible).' },
    },
    timeoutMs: 180_000,
    output: {
      schema: json,
      render: (_args: any, value: any) => [
        { type: 'text', text: value.summary },
        ...(value.images ?? []).flatMap((image: any) => [
          { type: 'text', text: `${image.name}:` },
          { type: 'image', attachment: image.attachment },
        ]),
      ],
    },
    async execute(args: any, exec: any) {
      const dir = await projectDir(exec, args.path)
      let rules: Record<string, unknown> | undefined
      if (args.rules !== undefined && String(args.rules).trim() !== '') {
        try { rules = typeof args.rules === 'string' ? JSON.parse(args.rules) : args.rules }
        catch { throw new StudioError('rules must be a JSON object, e.g. {"duration": 3}', 'BAD_RULES') }
        if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) throw new StudioError('rules must be a JSON object, e.g. {"duration": 3}', 'BAD_RULES')
      }
      const report = await playtest(dir, {
        ...(args.seconds !== undefined ? { seconds: Number(args.seconds) } : {}),
        ...(rules ? { rules } : {}),
        ...(typeof args.portrait === 'boolean' ? { portrait: args.portrait } : {}),
        ...(typeof args.platform === 'string' ? { platform: args.platform as PlaytestPlatform } : {}),
        ...(args.characters === true ? { charactersOnly: true } : {}),
        signal: exec.signal,
      })
      let summary = describePlaytest(report).replaceAll(`${dir}/`, '')
      const images: Array<{ name: string; attachment: unknown }> = []
      if (attachments !== undefined && await seesImages(exec)) {
        // One tool result is one message; keep its images inside the per-message byte limit.
        const limits = attachments.imageLimits ?? {}
        let budget = Math.min(limits.maxImageBytes ?? Infinity, limits.maxMessageImageBytes ?? Infinity)
        const order = ['characters', 'mid', 'end', 'title']
        for (const shot of [...report.shots].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))) {
          const data = await readFile(shot.file)
          if (data.byteLength > budget) continue
          try {
            images.push({ name: shot.name, attachment: await attachments.saveImage({ data: new Uint8Array(data), mediaType: shot.mediaType, name: basename(shot.file) }) })
            budget -= data.byteLength
          } catch { /* the file path in the summary still points at it */ }
        }
      } else {
        summary += '\nThis model cannot view images here; open the screenshots with read_image if it can, or describe them from the numbers above.'
      }
      return {
        project: dir, summary, finalPhase: report.finalPhase, bestScore: report.bestScore,
        errors: report.errors.length, runDir: relative(dir, report.runDir), images,
      }
    },
  }))

  // The sidebar's buttons call the same operations through this command.
  // Input: `<action> <json>`, where json carries an absolute project path.
  ctx.inject(['commands'], (child: any) => {
    child.commands.register({
      name: 'game-studio',
      description: 'Game Studio sidebar actions (apply, revert, build, export, restore, wall)',
      input: { hint: '<apply|revert|build|export|restore|wall> {"project": "...", ...}' },
      async handler({ agent, rawInput }: any) {
        try {
          // The Harness passes everything after `/game-studio`, leading whitespace included.
          const input = String(rawInput).trim()
          const space = input.search(/\s/u)
          const action = space < 0 ? input : input.slice(0, space)
          const payload = space < 0 ? {} : JSON.parse(input.slice(space + 1))
          const cwd = await ctx.workingDirectory.ensure(agent)
          if (action === 'wall') {
            const projects = Array.isArray(payload.projects) ? payload.projects.filter((item: unknown) => typeof item === 'string') : undefined
            const lang = payload.lang === 'zh' || payload.lang === 'en' ? payload.lang : undefined
            const wall = await exportWall({ root: cwd, projects, lang })
            return { kind: 'success', text: JSON.stringify(wall) }
          }
          const dir = resolveInside(cwd, String(payload.project ?? ''))
          let result: unknown
          if (action === 'apply') result = await applyCandidate(dir, String(payload.slot), String(payload.candidate))
          else if (action === 'revert') result = await revertSlot(dir, String(payload.slot))
          else if (action === 'build') { const build = await buildProject(dir, 'Rebuilt from the sidebar'); await writeState(dir, build); result = build }
          else if (action === 'export') result = await exportGame(dir)
          else if (action === 'export-wechat') result = await exportWechatProject(dir, { ...(typeof payload.appid === 'string' ? { appid: payload.appid } : {}) })
          else if (action === 'restore') result = await restoreVersion(dir, Math.trunc(Number(payload.version)))
          else if (action === 'unshare') { stopShare(dir); await writeState(dir); result = { stopped: true } }
          else if (action === 'status') { const state = await writeState(dir); result = { share: state.share } }
          else return { kind: 'error', text: `Unknown action "${action}"` }
          return { kind: 'success', text: JSON.stringify(result) }
        } catch (error) {
          if (error instanceof StudioError && error.code === 'NO_TUNNEL') {
            return {
              kind: 'error',
              text: JSON.stringify({
                code: 'NO_TUNNEL',
                platform: process.platform,
                install: cloudflaredInstallCommand(process.platform),
                message: error.message,
              }),
            }
          }
          if (error instanceof StudioError && error.code === 'NO_GH') {
            return {
              kind: 'error',
              text: JSON.stringify({
                code: 'NO_GH',
                platform: process.platform,
                install: ghInstallCommand(process.platform),
                message: error.message,
              }),
            }
          }
          if (error instanceof StudioError && error.code === 'GH_NOT_LOGGED_IN') {
            return {
              kind: 'error',
              text: JSON.stringify({
                code: 'GH_NOT_LOGGED_IN',
                message: error.message,
              }),
            }
          }
          if (error instanceof StudioError && error.code === 'REPO_NOT_OURS') {
            return {
              kind: 'error',
              text: JSON.stringify({
                code: 'REPO_NOT_OURS',
                repo: (error as StudioError & { repo?: string }).repo ?? (config.githubRepo ?? DEFAULT_GITHUB_REPO),
                message: error.message,
              }),
            }
          }
          if (error instanceof StudioError && error.code === 'GH_FAILED') {
            return {
              kind: 'error',
              text: JSON.stringify({
                code: 'GH_FAILED',
                message: error.message,
              }),
            }
          }
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    })
  })
}

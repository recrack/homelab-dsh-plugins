import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(resolve(root, 'plugins.json'), 'utf8'))
const upstream = 'https://github.com/JimLiu/open-artifacts'
const plugins = catalog.plugins.filter((plugin) => plugin.upstream === upstream)
const required = [
  'dsh-claude-artifacts',
  'dsh-claude-slides',
  'dsh-claude-design',
  'dsh-claude-design-system',
  'dsh-claude-data',
  'dsh-claude-motion',
  'dsh-claude-whiteboard',
]
const pluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]))
if (plugins.length !== required.length || required.some((id) => !pluginById.has(id))) {
  throw new Error('plugins.json must pin all seven Open Artifacts packages')
}

const snapshotRoot = resolve(root, 'packages/open-artifacts/snapshots')
const generatedRoot = resolve(root, 'packages/open-artifacts/generated')
rmSync(generatedRoot, { recursive: true, force: true })
mkdirSync(generatedRoot, { recursive: true })

for (const plugin of plugins) {
  if (!/^dsh-[a-z0-9-]+$/u.test(plugin.package) || typeof plugin.revision !== 'string') {
    throw new Error(`invalid Open Artifacts package metadata for ${plugin.id}`)
  }
  const archive = resolve(root, plugin.archive)
  if (!archive.startsWith(snapshotRoot + sep) || !existsSync(archive)) {
    throw new Error(`package snapshot is missing for ${plugin.id}`)
  }
  const actualIntegrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`
  if (actualIntegrity !== plugin.integrity) {
    throw new Error(`package snapshot integrity mismatch for ${plugin.id}`)
  }

  const target = resolve(generatedRoot, plugin.package)
  if (!target.startsWith(generatedRoot + sep)) throw new Error(`invalid package path for ${plugin.id}`)
  mkdirSync(target, { recursive: true })
  execFileSync('tar', ['-xzf', archive, '-C', target, '--strip-components=1', '--no-same-owner', '--no-same-permissions'], { stdio: 'ignore' })
  const manifest = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8'))
  if (manifest.name !== plugin.package || manifest.version !== plugin.revision) {
    throw new Error(`snapshot manifest does not match catalog for ${plugin.id}`)
  }
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || !existsSync(resolve(target, patch))) {
    throw new Error(`bundle patch is missing for ${plugin.id}`)
  }
  if (!existsSync(resolve(target, 'LICENSE')) || !existsSync(resolve(target, 'NOTICE.md'))) {
    throw new Error(`license notices are missing for ${plugin.id}`)
  }
}

for (const plugin of plugins) {
  for (const dependencyId of plugin.runtimeDependencies ?? []) {
    const dependency = pluginById.get(dependencyId)
    if (dependency === undefined) throw new Error(`unknown runtime dependency ${dependencyId} for ${plugin.id}`)
    const dependencyRoot = resolve(generatedRoot, dependency.package)
    const manifest = JSON.parse(readFileSync(resolve(generatedRoot, plugin.package, 'package.json'), 'utf8'))
    if (manifest.dependencies?.[dependency.package] === undefined) {
      throw new Error(`package dependency is missing for ${plugin.id}: ${dependency.package}`)
    }
    const nodeModules = resolve(generatedRoot, plugin.package, 'node_modules')
    mkdirSync(nodeModules, { recursive: true })
    const link = resolve(nodeModules, dependency.package)
    symlinkSync(relative(nodeModules, dependencyRoot), link, 'dir')
  }
}

console.log(`Installed Open Artifacts ${plugins.map(({ package: name, revision }) => `${name}@${revision}`).join(', ')}`)

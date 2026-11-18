import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const source = await readFile(join(root, 'src/client.js'), 'utf8')
const output = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  source.trimEnd(),
  'return module.exports; } });',
  '',
].join('\n')

await writeFile(join(root, 'lib/client.js'), output)
console.log(`built ${manifest.name}/lib/client.js (${output.length} bytes)`)

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'dist')
const html = await readFile(resolve(root, 'index.html'), 'utf8')

if (!html.includes('FindItViral has closed.') || /<script\b/i.test(html)) {
  throw new Error('The retirement page must announce closure and contain no scripts.')
}

// Clear only this explicit output directory, including old app assets and Pages Worker.
if (dirname(output) !== root || output === root) {
  throw new Error('Refusing to clear an output directory outside the project.')
}
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await writeFile(resolve(output, 'index.html'), html)
await writeFile(resolve(output, '404.html'), html)
console.log('Built the static retirement page. No app assets or Pages Worker were included.')

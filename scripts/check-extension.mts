import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Validates the built extension against the ways Chrome silently refuses to
 * load one. Each of these fails at install or run time with a message that
 * points somewhere unhelpful, so they are checked here instead.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'dist/extension')

const problems: string[] = []
const check = (ok: boolean, problem: string) => {
  if (!ok) problems.push(problem)
}

const exists = async (file: string) =>
  access(path.join(outDir, file)).then(() => true, () => false)

const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8')) as {
  manifest_version: number
  background?: { service_worker?: string }
  side_panel?: { default_path?: string }
  content_scripts?: { js?: string[] }[]
  host_permissions?: string[]
}

check(manifest.manifest_version === 3, 'manifest_version must be 3')

const referenced = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
].filter((file): file is string => typeof file === 'string')

for (const file of referenced) {
  check(await exists(file), `manifest references ${file}, which was not built`)
}

/**
 * Content scripts and the service worker are loaded as classic scripts, so a
 * bare `import` is a runtime error — and MV3's CSP forbids eval outright. Both
 * present as the extension simply doing nothing.
 */
for (const file of ['content.js', 'background.js']) {
  if (!(await exists(file))) continue
  const source = await readFile(path.join(outDir, file), 'utf8')

  check(!/^\s*import[\s{*'"]/m.test(source), `${file} contains a top-level import; it must be an IIFE`)
  check(!/^\s*export[\s{*]/m.test(source), `${file} contains an export; it must be an IIFE`)
  check(!/\beval\s*\(/.test(source), `${file} calls eval, which MV3's CSP forbids`)
}

// The readers are the reason the extension exists; a bundling mistake that
// tree-shook them would otherwise show up only as a scan that finds nothing.
if (await exists('content.js')) {
  const source = await readFile(path.join(outDir, 'content.js'), 'utf8')
  check(source.includes('ConnectionCard_'), 'content.js does not contain the connections reader')
  check(
    source.includes('data-chameleon-result-urn'),
    'content.js does not contain the network-manager reader',
  )
}

check(
  (manifest.host_permissions ?? []).every((pattern) => pattern.includes('linkedin.com')),
  'host_permissions must not reach beyond linkedin.com',
)

if (problems.length > 0) {
  console.error('Extension build is not loadable:\n')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

console.log(`Extension build looks loadable (${referenced.length} referenced files present).`)

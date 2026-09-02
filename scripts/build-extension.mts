import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Three entries with different shapes, so three passes.
 *
 * The side panel is an extension page and can be an ES module, but content
 * scripts and the service worker cannot: Chrome loads them as classic scripts,
 * and an `import` in either is a runtime error rather than a build one. Both
 * are therefore bundled as self-contained IIFEs.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'dist/extension')
const watch = process.argv.includes('--watch')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

await build({
  root: path.join(root, 'extension/src/panel'),
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: false,
    // Chrome will not load a side panel that reaches for a CDN, and inlining
    // keeps the bundle auditable — everything shipped is in this repo.
    modulePreload: { polyfill: false },
    watch: watch ? {} : null,
  },
})

for (const entry of ['content', 'background'] as const) {
  await build({
    root,
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: path.join(root, `extension/src/${entry}.ts`),
        formats: ['iife'],
        name: `incleanup_${entry}`,
        fileName: () => `${entry}.js`,
      },
      watch: watch ? {} : null,
    },
  })
}

await cp(path.join(root, 'extension/manifest.json'), path.join(outDir, 'manifest.json'))

console.log(`\nExtension built → ${path.relative(root, outDir)}`)
console.log('Load it with chrome://extensions → Developer mode → Load unpacked.')

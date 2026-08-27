import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageSource } from './evaluate.ts'
import { pageWith, runInPage as runSource } from '../linkedin/page/fixture.test-utils.ts'
import { DATASETS } from '../linkedin/datasets.ts'
import { harvestSearchResults } from '../linkedin/page/search.ts'

/**
 * The shared page readers are real TypeScript, but they reach the browser as
 * source text. tsx compiles with esbuild's `keepNames`, which rewrites nested
 * helpers into calls to a `__name` helper that does not exist in the page — the
 * reason these readers used to be maintained as untyped strings.
 *
 * `pageSource` supplies an identity `__name` in the evaluated scope. If that
 * ever stops happening, every reader throws `__name is not defined` inside the
 * page and every scan silently returns nothing, so it is asserted directly.
 */

const runInPage = (html: string, source: string): unknown =>
  runSource(pageWith(html), source)

test('the compiler really does inject the helper these readers would trip on', () => {
  // Guards the premise: if a future toolchain stops emitting `__name`, this
  // test turning red is the signal that the shim is no longer load-bearing.
  const anyReaderIsMangled = Object.values(DATASETS).some((spec) =>
    spec.harvest.fn.toString().includes('__name('),
  )
  assert.equal(
    anyReaderIsMangled,
    true,
    'expected esbuild keepNames to rewrite nested helpers; the shim assumes it',
  )
})

test('a reader stringified without the shim fails inside the page', () => {
  const raw = `(${DATASETS.connections.harvest.fn.toString()})()`
  assert.throws(() => runInPage('<body></body>', raw), /__name is not defined/)
})

test('every dataset reader runs inside a page once the shim is applied', () => {
  for (const [kind, spec] of Object.entries(DATASETS)) {
    const rows = runInPage('<body></body>', pageSource(spec.harvest))
    assert.deepEqual(rows, [], `${kind} reader should return an empty list, not throw`)

    const total = runInPage('<body></body>', pageSource(spec.total))
    assert.equal(total, null, `${kind} total should read null on an empty page`)
  }
})

test('arguments cross into the page as JSON', () => {
  // The manager reader is one parameterised function serving two lists, so its
  // arguments have to survive the boundary or both lists read nothing.
  const html = `<body><div data-chameleon-result-urn="urn:1">
      <a href="/company/acme/">Acme</a></div></body>`

  const pages = runInPage(html, pageSource(DATASETS.pages.harvest)) as { id: string }[]
  assert.deepEqual(pages.map((p) => p.id), ['acme'])

  // The same markup must read as nothing for the people list, which looks for
  // /in/ — proving the two calls really are parameterised differently.
  const following = runInPage(html, pageSource(DATASETS.following.harvest)) as unknown[]
  assert.deepEqual(following, [])
})

test('the search reader survives the boundary and reports the page language', () => {
  const html = `<html lang="tr"><body>
      <a href="/in/ada/">Ada | • 1. | A ve B ortak bağlantınız</a></body></html>`

  const result = runInPage(html, pageSource({ fn: harvestSearchResults, args: [] })) as {
    lang: string
    rows: { id: string }[]
  }

  assert.equal(result.lang, 'tr')
  assert.deepEqual(result.rows.map((r) => r.id), ['ada'])
})

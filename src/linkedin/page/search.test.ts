import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageWith, runInPage } from './fixture.test-utils.ts'
import { pageSource } from '../../server/evaluate.ts'
import { harvestSearchResults, type SearchHarvest } from './search.ts'
import { localeOf, parseMutualCount } from '../mutuals.ts'

const search = (html: string) =>
  runInPage<SearchHarvest>(pageWith(html), pageSource({ fn: harvestSearchResults, args: [] }))

test('reports the page language so the caller knows if it can read the wording', () => {
  assert.equal(search('<html lang="tr"><body></body></html>').lang, 'tr')
  assert.equal(search('<html lang="en-US"><body></body></html>').lang, 'en-US')
  assert.equal(search('<html><body></body></html>').lang, '')
})

/**
 * Every mutual-connection *name* under a result is a profile link too. Treating
 * anchors alone as results invents an entry for each of them — people who were
 * never in the search at all, arriving with a fabricated shared count.
 */
test('mutual-connection names do not become results of their own', () => {
  const { rows } = search(`<html lang="en"><body>
      <li>
        <a href="/in/ada/">Ada Lovelace<br>• 1st<br>A &amp; B are mutual connections</a>
        <div>
          <a href="/in/friend-a/">Friend A</a>
          <a href="/in/friend-b/">Friend B</a>
        </div>
      </li>
    </body></html>`)

  assert.deepEqual(rows.map((r) => r.id), ['ada'])
})

test('keeps the richest text when one profile appears more than once', () => {
  const { rows } = search(`<html lang="en"><body>
      <a href="/in/ada/">Ada Lovelace • 1st</a>
      <a href="/in/ada/">Ada Lovelace<br>• 1st<br>A &amp; B are mutual connections</a>
    </body></html>`)

  assert.equal(rows.length, 1)
  assert.match(rows[0]!.text, /mutual connections/)
})

/** The end-to-end path this whole locale change exists to protect. */
test('a Turkish result is counted, not silently zeroed', () => {
  const harvested = search(`<html lang="tr"><body>
      <a href="/in/ayse/">Ayşe Yılmaz<br>• 1.<br>Ali, Veli ve 19 diğer ortak bağlantınız</a>
    </body></html>`)

  const locale = localeOf(harvested.lang)
  assert.equal(locale, 'tr')
  assert.equal(parseMutualCount(harvested.rows[0]!.text, locale), 21)
})

test('a language the parser cannot read leaves the count unknown', () => {
  const harvested = search(`<html lang="de"><body>
      <a href="/in/klaus/">Klaus<br>• 1.<br>A, B und 19 weitere gemeinsame Kontakte</a>
    </body></html>`)

  // The row is still collected — it just must not be given a number.
  assert.equal(harvested.rows.length, 1)
  assert.equal(parseMutualCount(harvested.rows[0]!.text, localeOf(harvested.lang)), null)
})

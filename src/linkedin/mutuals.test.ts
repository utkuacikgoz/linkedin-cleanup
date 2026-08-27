import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localeOf, parseMutualCount } from './mutuals.ts'

test('reads the English wording LinkedIn prints under a result', () => {
  const en = (text: string) => parseMutualCount(text, 'en')

  assert.equal(en('Ada Lovelace | • 1st | A, B & 19 other mutual connections'), 21)
  assert.equal(en('Ada Lovelace | • 1st | A & B are mutual connections'), 2)
  assert.equal(en('Ada Lovelace | • 1st | A is a mutual connection'), 1)
  assert.equal(en('Ada Lovelace | • 1st | Software engineer'), 0)
})

test('reads the Turkish wording', () => {
  const tr = (text: string) => parseMutualCount(text, 'tr')

  assert.equal(tr('Ada Lovelace | • 1. | A, B ve 19 diğer ortak bağlantınız'), 21)
  assert.equal(tr('Ada Lovelace | • 1. | A, B ve 19 başka ortak bağlantı'), 21)
  assert.equal(tr('Ada Lovelace | • 1. | A ve B ortak bağlantınız'), 2)
  assert.equal(tr('Ada Lovelace | • 1. | A ortak bağlantınız'), 1)
  assert.equal(tr('Ada Lovelace | • 1. | Yazılım mühendisi'), 0)
})

test('separators do not let a mutual line bleed into the next field', () => {
  // innerText is flattened with " | ", so a two-name match must stay inside one
  // segment — otherwise a name three fields away counts as a mutual connection.
  assert.equal(parseMutualCount('A ve B | Yazılım mühendisi', 'tr'), 0)
})

/**
 * The regression this file exists for. The row filter accepts Turkish results,
 * but the parser once knew only English phrases, so every row fell through to
 * `0`. "0 shared" is the filter the README recommends before a bulk removal, so
 * a whole Turkish network looked like strangers worth cutting.
 */
test('a language the parser cannot read is unknown, never zero', () => {
  const german = 'Ada Lovelace | • 1. | A, B und 19 weitere gemeinsame Kontakte'

  assert.equal(parseMutualCount(german, localeOf('de-DE')), null)
  assert.equal(parseMutualCount('anything at all', localeOf('')), null)
  assert.equal(parseMutualCount('anything at all', localeOf(undefined)), null)
})

test('zero is only ever claimed for wording the parser actually knows', () => {
  // Same text, read as a language we support vs. one we do not.
  const text = 'Ada Lovelace | • 1st | Software engineer'
  assert.equal(parseMutualCount(text, localeOf('en-US')), 0)
  assert.equal(parseMutualCount(text, localeOf('fr')), null)
})

test('locale tags are matched on their base language', () => {
  assert.equal(localeOf('en-US'), 'en')
  assert.equal(localeOf('TR'), 'tr')
  assert.equal(localeOf('tr-TR'), 'tr')
  assert.equal(localeOf('de'), null)
})

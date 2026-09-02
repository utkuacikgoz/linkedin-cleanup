import assert from 'node:assert/strict'
import { test } from 'node:test'
import { looksCorporate } from './heuristics.ts'
import type { Entity } from './types.ts'

const person = (name: string, headline = '', mutual?: number | null): Entity => ({
  id: name,
  name,
  headline,
  url: `https://www.linkedin.com/in/${name}/`,
  ...(mutual === undefined ? {} : { mutual }),
})

test('flags names that carry a company token', () => {
  assert.equal(looksCorporate(person('Acme Solutions')).flagged, true)
  assert.equal(looksCorporate(person('Zeta Yazılım')).flagged, true)
  assert.equal(looksCorporate(person('Beta A.Ş.')).flagged, true)
})

test('flags a headline written in an organisation’s voice', () => {
  assert.equal(looksCorporate(person('Ada Lovelace', 'We help teams ship faster')).flagged, true)
  assert.equal(looksCorporate(person('Ada Lovelace', 'Bize ulaşın')).flagged, true)
})

test('leaves ordinary people alone', () => {
  assert.equal(looksCorporate(person('Ada Lovelace', 'Mathematician')).flagged, false)
  assert.equal(looksCorporate(person('Ayşe Yılmaz', 'Yazılım mühendisi')).flagged, false)
})

/**
 * The verdict is openly a guess, so it has to say why — the tag is hoverable
 * for exactly this reason, and a flag with no reason would be unreviewable.
 */
test('every flag comes with its reasons', () => {
  const verdict = looksCorporate(person('Acme Solutions | Digital', 'We build things'))

  assert.equal(verdict.flagged, true)
  assert.ok(verdict.reasons.length >= 2, 'expected several reasons')
  assert.ok(verdict.reasons.some((r) => r.includes('solutions')))
})

/**
 * Having no shared connections is weak evidence on its own — plenty of real
 * people share none. It may only ever reinforce a flag, never raise one.
 */
test('zero shared connections never flags someone by itself', () => {
  assert.equal(looksCorporate(person('Ada Lovelace', 'Mathematician', 0)).flagged, false)

  const reinforced = looksCorporate(person('Acme Solutions', '', 0))
  assert.equal(reinforced.flagged, true)
  assert.ok(reinforced.reasons.includes('no shared connections'))
})

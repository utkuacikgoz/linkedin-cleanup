import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseConnectedText } from './dates.ts'

const iso = (text: string) => {
  const at = parseConnectedText(text)
  return at === undefined ? undefined : new Date(at).toISOString().slice(0, 10)
}

test('reads the English date LinkedIn prints on a card', () => {
  assert.equal(iso('Connected on June 29, 2024'), '2024-06-29')
  assert.equal(iso('Connected on 29 June 2024'), '2024-06-29')
})

test('a day-first English date is not read as a Turkish month', () => {
  // "June" must not reach the Turkish month lookup, and "Ağustos" must not be
  // clipped to an ASCII prefix by the day-first pattern.
  assert.equal(iso('Connected on 29 June 2024'), '2024-06-29')
  assert.equal(iso('22 Ağustos 2024'), '2024-08-22')
})

test('reads the Turkish date', () => {
  assert.equal(iso('Bağlantı kurulma tarihi: 22 Ağustos 2024'), '2024-08-22')
  assert.equal(iso('22 ağustos 2024'), '2024-08-22')
  assert.equal(iso('1 Aralık 2019'), '2019-12-01')
})

/**
 * The label has to be matched around rather than stripped: trimming to the
 * first digit eats the month and leaves "29, 2024", which parses as a date in
 * the wrong year entirely.
 */
test('the label is not mistaken for part of the date', () => {
  assert.equal(iso('Connected on May 3, 2023'), '2023-05-03')
  assert.equal(iso('Bağlantı kurulma tarihi: 3 Mayıs 2023'), '2023-05-03')
})

test('text with no date in it stays undefined', () => {
  assert.equal(parseConnectedText(''), undefined)
  assert.equal(parseConnectedText('Message'), undefined)
  assert.equal(parseConnectedText('Connected'), undefined)
})

test('an unknown month name is not guessed at', () => {
  assert.equal(parseConnectedText('22 Elokuuta 2024'), undefined)
})

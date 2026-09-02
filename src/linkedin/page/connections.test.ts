import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageWith, runInPage } from './fixture.test-utils.ts'
import { pageSource } from '../../server/evaluate.ts'
import { harvestConnections, readConnectionsTotal } from './connections.ts'
import type { RawCard } from '../types.ts'

const harvest = (dom: ReturnType<typeof pageWith>) =>
  runInPage<RawCard[]>(dom, pageSource({ fn: harvestConnections, args: [] }))

const total = (dom: ReturnType<typeof pageWith>) =>
  runInPage<number | null>(dom, pageSource({ fn: readConnectionsTotal, args: [] }))

const card = (slug: string, name: string, headline: string, connected: string) => `
  <div componentkey="ConnectionCard_0-${slug}">
    <a href="/in/${slug}/"><img src="https://media.licdn.com/dms/image/${slug}.jpg"></a>
    <div>${name}</div>
    <div>${headline}</div>
    <div>${connected}</div>
    <button>Message</button>
  </div>`

test('reads a connection card into its fields', () => {
  const dom = pageWith(
    `<body><main>${card('ada-lovelace', 'Ada Lovelace', 'Mathematician at Analytical Engines', 'Connected on June 29, 2024')}</main></body>`,
  )

  assert.deepEqual(harvest(dom), [
    {
      id: 'ada-lovelace',
      name: 'Ada Lovelace',
      headline: 'Mathematician at Analytical Engines',
      connectedText: 'Connected on June 29, 2024',
      avatarUrl: 'https://media.licdn.com/dms/image/ada-lovelace.jpg',
    },
  ])
})

test('the button label never becomes a headline', () => {
  const dom = pageWith(
    `<body><main>
      <div componentkey="ConnectionCard_0-grace">
        <a href="/in/grace/"></a>
        <div>Grace Hopper</div>
        <button>Message</button>
      </div>
    </main></body>`,
  )

  assert.equal(harvest(dom)[0]?.headline, '')
})

/**
 * LinkedIn virtualises long lists: rows scrolled past are gone from the DOM
 * well before the list stops growing, so the scan accumulates across rounds
 * instead of snapshotting at the end. Each round must therefore return only
 * what is new, or every round re-reports the whole screenful.
 */
test('a second round returns only rows it has not seen', () => {
  const dom = pageWith(
    `<body><main>${card('ada', 'Ada', 'Engineer', 'Connected on June 1, 2024')}</main></body>`,
  )

  assert.equal(harvest(dom).length, 1)
  assert.deepEqual(harvest(dom), [])

  dom.window.document.querySelector('main')!.insertAdjacentHTML(
    'beforeend',
    card('grace', 'Grace', 'Engineer', 'Connected on June 2, 2024'),
  )

  assert.deepEqual(harvest(dom).map((c) => c.id), ['grace'])
})

/**
 * The componentkey attribute is LinkedIn's, not ours — the ancestor walk is the
 * fallback for the day it is renamed, and is the only thing standing between a
 * markup tweak and a scan that reads nothing.
 */
test('falls back to finding the list container when componentkey is gone', () => {
  const dom = pageWith(`<body><main><ul>
      <li><a href="/in/alice/"></a><div>Alice</div><div>Engineer</div></li>
      <li><a href="/in/bob/"></a><div>Bob</div><div>Designer</div></li>
      <li><a href="/in/carol/"></a><div>Carol</div><div>Analyst</div></li>
    </ul></main></body>`)

  assert.deepEqual(harvest(dom).map((c) => c.id), ['alice', 'bob', 'carol'])
  assert.equal(harvest(dom).length, 0)
})

test('profile ids survive percent-encoding', () => {
  const dom = pageWith(
    `<body><main>${card('ay%C5%9Fe-y%C4%B1lmaz', 'Ayşe Yılmaz', 'Yazılım mühendisi', 'Connected on May 3, 2023')}</main></body>`,
  )

  assert.equal(harvest(dom)[0]?.id, 'ayşe-yılmaz')
})

test('reads the declared total, however LinkedIn punctuates it', () => {
  assert.equal(total(pageWith('<body><h1>1,217 connections</h1></body>')), 1217)
  assert.equal(total(pageWith('<body><h1>1.217 connections</h1></body>')), 1217)
  assert.equal(total(pageWith('<body><h1>1 217 connections</h1></body>')), 1217)
  assert.equal(total(pageWith('<body><h1>1.217 bağlantı</h1></body>')), 1217)
  assert.equal(total(pageWith('<body><h1>Connections</h1></body>')), null)
})

/**
 * A stated total with no rows read is the signal that the reader is stale
 * rather than the list empty — the scan turns exactly this pair into a named
 * error instead of reporting "Found 0".
 */
test('a page that states a total but yields no rows is distinguishable', () => {
  const dom = pageWith('<body><h1>1,217 connections</h1><main></main></body>')

  assert.deepEqual(harvest(dom), [])
  assert.equal(total(dom), 1217)
})

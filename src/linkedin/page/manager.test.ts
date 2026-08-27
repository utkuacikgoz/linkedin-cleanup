import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageWith, runInPage } from './fixture.test-utils.ts'
import { pageSource } from '../../server/evaluate.ts'
import { FOLLOWING_ARGS, PAGES_ARGS, harvestManagerCards, readManagerTotal } from './manager.ts'
import type { RawCard } from '../types.ts'

const read = (html: string, args: [string, string]) =>
  runInPage<RawCard[]>(pageWith(html), pageSource({ fn: harvestManagerCards, args }))

const row = (href: string, name: string, detail: string) => `
  <div data-chameleon-result-urn="urn:li:fs_${name}">
    <a href="${href}"><img src="https://media.licdn.com/${name}.jpg"></a>
    <div>${name}</div>
    <div>${detail}</div>
    <button>Following</button>
  </div>`

test('reads followed company pages', () => {
  const cards = read(
    `<body>${row('/company/acme/', 'Acme', '12,400 followers')}</body>`,
    PAGES_ARGS,
  )

  assert.deepEqual(cards, [
    {
      id: 'acme',
      name: 'Acme',
      headline: '12,400 followers',
      avatarUrl: 'https://media.licdn.com/Acme.jpg',
    },
  ])
})

test('reads followed people', () => {
  const cards = read(`<body>${row('/in/ada/', 'Ada', 'Mathematician')}</body>`, FOLLOWING_ARGS)
  assert.deepEqual(cards.map((c) => c.id), ['ada'])
})

/**
 * One parameterised reader serves both lists, so the arguments are the only
 * thing keeping them apart. If they stop crossing into the page, each list
 * quietly reads the other's rows — or none at all.
 */
test('each list ignores the other kind of row', () => {
  const html = `<body>
      ${row('/company/acme/', 'Acme', '12,400 followers')}
      ${row('/in/ada/', 'Ada', 'Mathematician')}
    </body>`

  assert.deepEqual(read(html, PAGES_ARGS).map((c) => c.id), ['acme'])
  assert.deepEqual(read(html, FOLLOWING_ARGS).map((c) => c.id), ['ada'])
})

test('the Following button label never becomes a headline', () => {
  const cards = read(
    `<body><div data-chameleon-result-urn="urn:1">
        <a href="/company/acme/"></a><div>Acme</div><button>Following</button>
      </div></body>`,
    PAGES_ARGS,
  )

  assert.equal(cards[0]?.headline, '')
})

test('reads the declared total for either list', () => {
  const total = (html: string) =>
    runInPage<number | null>(pageWith(html), pageSource({ fn: readManagerTotal, args: [] }))

  assert.equal(total('<body><h2>148 pages</h2></body>'), 148)
  assert.equal(total('<body><h2>148 sayfa</h2></body>'), 148)
  assert.equal(total('<body><h2>Following 4 people</h2></body>'), 4)
  assert.equal(total('<body><h2>Pages</h2></body>'), null)
})

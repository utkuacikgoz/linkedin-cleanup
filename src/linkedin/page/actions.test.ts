import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageWith } from './fixture.test-utils.ts'
import { CONTROL_LABELS } from '../labels-ui.ts'
import { performAction, type ActionSpec, type PageActionResult } from './actions.ts'

/**
 * These drive the real removal code against a fixture that behaves like the
 * connections page: the menu only appears once its button is clicked, the
 * confirmation is a native <dialog>, and the row only leaves when the confirm
 * button is pressed.
 *
 * The action runs through `pageSource` in production; here it is called with
 * the fixture's globals installed, which exercises the same body.
 */

const labels = { ...CONTROL_LABELS } as unknown as Record<string, string>

type Options = {
  confirmLabel?: string
  menuOpensOnClick?: boolean
  removeOnConfirm?: boolean
  language?: 'en' | 'tr'
}

const connectionsPage = (options: Options = {}) => {
  const {
    confirmLabel = 'Remove connection',
    menuOpensOnClick = true,
    removeOnConfirm = true,
    language = 'en',
  } = options

  const text =
    language === 'tr'
      ? { more: 'Ada Lovelace için diğer işlemler', item: 'Bağlantıyı kaldır' }
      : { more: 'More actions', item: 'Remove connection' }

  const dom = pageWith(`<body><main>
      <input placeholder="Search by name" />
      <div componentkey="ConnectionCard_0-ada">
        <a href="/in/ada/">Ada Lovelace</a>
        <button class="more" aria-label="${text.more}"></button>
      </div>
    </main></body>`)

  const { document } = dom.window
  const card = document.querySelector('[componentkey]')!
  const more = document.querySelector('button.more')!

  more.addEventListener('click', () => {
    if (!menuOpensOnClick) return
    if (document.querySelector('[role="menuitem"]')) return

    const item = document.createElement('div')
    item.setAttribute('role', 'menuitem')
    item.textContent = text.item
    item.addEventListener('click', () => {
      const dialog = document.createElement('dialog')
      dialog.setAttribute('open', '')

      const confirm = document.createElement('button')
      confirm.textContent = confirmLabel
      confirm.addEventListener('click', () => {
        if (removeOnConfirm) card.remove()
        dialog.remove()
      })

      const cancel = document.createElement('button')
      cancel.textContent = 'Cancel'

      dialog.append(cancel, confirm)
      document.body.append(dialog)
    })
    document.body.append(item)
  })

  return dom
}

const act = (dom: ReturnType<typeof pageWith>, spec: Partial<ActionSpec> = {}) => {
  const globals = dom.window as unknown as Record<string, unknown>
  const saved = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    HTMLInputElement: globalThis.HTMLInputElement,
    KeyboardEvent: globalThis.KeyboardEvent,
    Event: globalThis.Event,
    window: (globalThis as { window?: unknown }).window,
  }

  Object.assign(globalThis, {
    document: globals.document,
    getComputedStyle: globals.getComputedStyle,
    HTMLInputElement: globals.HTMLInputElement,
    KeyboardEvent: globals.KeyboardEvent,
    Event: globals.Event,
    window: dom.window,
  })

  const done = performAction({
    kind: 'connections',
    id: 'ada',
    name: 'Ada Lovelace',
    dryRun: false,
    labels,
    ...spec,
  })

  return done.finally(() => Object.assign(globalThis, saved)) as Promise<PageActionResult>
}

test('removes a connection through the menu and the native dialog', async () => {
  const dom = connectionsPage()

  assert.deepEqual(await act(dom), { outcome: 'done' })
  assert.equal(dom.window.document.querySelector('[componentkey]'), null)
})

/**
 * The whole point of a dry run: it finds the person and checks it can reach the
 * control, and never clicks it. If this ever removes someone, the feature is
 * worse than not having it.
 */
test('a dry run reaches the control but removes nobody', async () => {
  const dom = connectionsPage()

  assert.deepEqual(await act(dom, { dryRun: true }), { outcome: 'would-do' })
  assert.ok(dom.window.document.querySelector('[componentkey]'), 'the card must still be there')
  assert.equal(dom.window.document.querySelector('dialog'), null, 'no dialog should have opened')
})

test('matches the Turkish labels', async () => {
  const dom = connectionsPage({ language: 'tr', confirmLabel: 'Bağlantıyı kaldır' })
  assert.deepEqual(await act(dom), { outcome: 'done' })
})

/**
 * The confirm button reads "Remove connection", not "Remove" — and "Cancel"
 * must never match, or a cancelled dialog is reported as a removal.
 */
test('an unrecognised dialog is a failure, not a silent success', async () => {
  const dom = connectionsPage({ confirmLabel: 'Yes, do it' })
  const result = await act(dom)

  assert.equal(result.outcome, 'failed')
  assert.match(result.error ?? '', /no recognised button/)
  assert.match(result.error ?? '', /Cancel/)
  assert.ok(dom.window.document.querySelector('[componentkey]'), 'nobody should have been removed')
})

test('a row still listed afterwards is reported as failed', async () => {
  const dom = connectionsPage({ removeOnConfirm: false })
  const result = await act(dom)

  assert.equal(result.outcome, 'failed')
  assert.match(result.error ?? '', /Still listed/)
})

test('someone already gone is not a failure', async () => {
  const dom = connectionsPage()
  assert.deepEqual(await act(dom, { id: 'grace', name: 'Grace Hopper' }), {
    outcome: 'already-gone',
    error: 'Not in the connections list',
  })
})

test('a menu that never opens is reported, after a retry', async () => {
  const dom = connectionsPage({ menuOpensOnClick: false })
  const result = await act(dom)

  assert.equal(result.outcome, 'failed')
  assert.match(result.error ?? '', /Remove connection/)
})

/**
 * The name box is React-controlled: assigning `.value` updates the DOM and
 * nothing else, so the list never filters and the card is never found. The
 * native setter plus an `input` event is what makes the filter real.
 */
test('typing into the name filter notifies the page, not just the DOM', async () => {
  const dom = connectionsPage()
  const input = dom.window.document.querySelector('input')!

  const seen: string[] = []
  input.addEventListener('input', () => seen.push(input.value))

  await act(dom)

  assert.deepEqual(seen, ['', 'Ada Lovelace'])
})

// ---------------------------------------------------------------- unfollows

const managerPage = (options: { flipsOnClick?: boolean; needsConfirm?: boolean } = {}) => {
  const { flipsOnClick = true, needsConfirm = false } = options

  const dom = pageWith(`<body><main>
      <div data-chameleon-result-urn="urn:li:company:1">
        <a href="/company/acme/">Acme</a>
        <button class="follow" aria-label="Click to stop following Acme"></button>
      </div>
    </main></body>`)

  const { document } = dom.window
  const button = document.querySelector('button.follow')!

  const stopFollowing = () => {
    // The row stays put and the button flips to "Follow"; the old label going
    // away is the only proof the request landed.
    button.setAttribute('aria-label', 'Click to follow Acme')
  }

  button.addEventListener('click', () => {
    if (!needsConfirm) {
      if (flipsOnClick) stopFollowing()
      return
    }

    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    const confirm = document.createElement('button')
    confirm.textContent = 'Unfollow'
    confirm.addEventListener('click', () => {
      if (flipsOnClick) stopFollowing()
      dialog.remove()
    })
    dialog.append(confirm)
    document.body.append(dialog)
  })

  return dom
}

const unfollow = (dom: ReturnType<typeof pageWith>, spec: Partial<ActionSpec> = {}) =>
  act(dom, { kind: 'pages', id: 'acme', name: 'Acme', ...spec })

test('unfollows a page and treats the label flipping as the proof', async () => {
  const dom = managerPage()

  assert.deepEqual(await unfollow(dom), { outcome: 'done' })
  assert.ok(dom.window.document.querySelector('[data-chameleon-result-urn]'), 'row stays in place')
})

test('unfollows through a confirmation dialog when LinkedIn asks for one', async () => {
  assert.deepEqual(await unfollow(managerPage({ needsConfirm: true })), { outcome: 'done' })
})

test('a button that never flips is a failure, not a success', async () => {
  const result = await unfollow(managerPage({ flipsOnClick: false }))

  assert.equal(result.outcome, 'failed')
  assert.match(result.error ?? '', /Still shows as followed/)
})

test('a dry run never clicks the follow button', async () => {
  const dom = managerPage()

  assert.deepEqual(await unfollow(dom, { dryRun: true }), { outcome: 'would-do' })
  assert.equal(
    dom.window.document.querySelector('button.follow')?.getAttribute('aria-label'),
    'Click to stop following Acme',
    'still followed',
  )
})

test('a page that is no longer followed is already-gone, not failed', async () => {
  const dom = managerPage()
  dom.window.document.querySelector('button.follow')!.setAttribute('aria-label', 'Click to follow Acme')

  assert.deepEqual(await unfollow(dom), {
    outcome: 'already-gone',
    error: 'Not currently followed',
  })
})

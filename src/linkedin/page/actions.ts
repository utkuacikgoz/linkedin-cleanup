import type { DatasetKind } from '../types.ts'

/**
 * Removing and unfollowing, as one self-contained page function.
 *
 * Shared by both front ends deliberately: the extension calls this in its
 * content script, and the Playwright driver stringifies the same source. There
 * is exactly one implementation of the irreversible operation, so running the
 * driver against a real account exercises precisely what the extension runs.
 *
 * Everything lives inside the one exported function because a module-scope
 * reference is `undefined` once a function is stringified for `page.evaluate`.
 *
 * Navigation is the caller's job — this assumes the page is already on the
 * right list.
 */

export type ActionSpec = {
  kind: DatasetKind
  /** Profile slug, or numeric page id. */
  id: string
  name: string
  dryRun: boolean
  /** `CONTROL_LABELS`, as regex source strings. */
  labels: Record<string, string>
}

export type PageActionResult = {
  outcome: 'done' | 'would-do' | 'already-gone' | 'failed'
  error?: string
}

export const performAction = async (spec: ActionSpec): Promise<PageActionResult> => {
  const { kind, id, name, dryRun, labels } = spec

  const re = (key: string) => new RegExp(labels[key] ?? '$^', 'i')
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  /** Polls rather than waits on an event: LinkedIn re-renders these rows
   *  constantly, and a node captured a tick earlier is often already detached. */
  const until = async <T>(get: () => T | null, timeoutMs: number): Promise<T | null> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = get()
      if (found) return found
      if (Date.now() >= deadline) return null
      await sleep(120)
    }
  }

  const isVisible = (el: Element): boolean => {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    const box = (el as HTMLElement).getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }

  const accessibleName = (el: Element): string =>
    (
      el.getAttribute('aria-label') ||
      (el as HTMLElement).innerText ||
      el.textContent ||
      el.getAttribute('title') ||
      ''
    ).trim()

  const byRole = (root: ParentNode, role: string, pattern: RegExp): HTMLElement | null => {
    const selector =
      role === 'button' ? 'button, [role="button"]' : `[role="${role}"]`
    for (const el of root.querySelectorAll(selector)) {
      if (!pattern.test(accessibleName(el))) continue
      if (!isVisible(el)) continue
      return el as HTMLElement
    }
    return null
  }

  const escape = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

  /**
   * The name box is React-controlled, so assigning `.value` updates the DOM and
   * nothing else — React never sees it and the list never filters. Going
   * through the native setter and dispatching `input` is what makes it real.
   */
  const setNativeValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const profileHref = (profileId: string) =>
    kind === 'pages' ? `/company/${profileId}` : `/in/${encodeURIComponent(profileId)}`

  /**
   * The confirmation is a native <dialog>, which carries the dialog role
   * implicitly — so an attribute selector like [role="dialog"] never matches
   * it. Both forms are checked.
   */
  const confirmDialog = async (): Promise<string | null> => {
    const dialog = await until(
      () =>
        [...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]')].find(
          isVisible,
        ) ?? null,
      4000,
    )
    if (!dialog) return null

    const confirm = await until(() => byRole(dialog, 'button', re('confirm')), 3000)
    if (!confirm) {
      // Leaving a half-open dialog behind would block every later action.
      escape()
      const seen = [...dialog.querySelectorAll('button')].map(accessibleName).filter(Boolean)
      return `Confirmation dialog has no recognised button (saw: ${seen.join(', ') || 'none'})`
    }

    confirm.click()
    return null
  }

  // ------------------------------------------------------------ connections

  if (kind === 'connections') {
    const findCard = (): HTMLElement | null => {
      for (const card of document.querySelectorAll('[componentkey^="ConnectionCard_"]')) {
        if (card.querySelector(`a[href*="${profileHref(id)}"]`)) return card as HTMLElement
      }
      return null
    }

    // Filtering by name beats scrolling to find someone; the card is then
    // picked by profile id, so two people with the same name cannot be confused.
    const box = document.querySelector<HTMLInputElement>(
      'main input[placeholder*="Search by name" i], main input[placeholder*="isme göre" i]',
    )
    if (box) {
      setNativeValue(box, '')
      setNativeValue(box, name)
      await sleep(1200)
    }

    const card = await until(findCard, 5000)
    if (!card) return { outcome: 'already-gone', error: 'Not in the connections list' }

    const moreActions = await until(() => byRole(card, 'button', re('moreActions')), 4000)
    if (!moreActions) return { outcome: 'failed', error: 'Card has no "More actions" button' }

    // The menu occasionally does not come up on the first click; one retry
    // costs a second and saves reporting a healthy row as unreachable.
    let removeItem: HTMLElement | null = null
    for (let attempt = 0; attempt < 2 && !removeItem; attempt++) {
      if (attempt > 0) {
        escape()
        await sleep(600)
      }
      moreActions.click()
      removeItem = await until(() => byRole(document, 'menuitem', re('removeItem')), 3500)
    }

    if (!removeItem) {
      escape()
      return { outcome: 'failed', error: 'Menu has no "Remove connection" entry' }
    }

    if (dryRun) {
      // A dry run never clicks the entry. Whether LinkedIn asks to confirm
      // after that click is its decision, not something to gamble a real
      // connection on.
      escape()
      return { outcome: 'would-do' }
    }

    removeItem.click()

    const problem = await confirmDialog()
    if (problem) return { outcome: 'failed', error: problem }

    // The row usually drops out on its own, which is the cheap answer. When it
    // lingers, re-running the filter asks LinkedIn instead of trusting the DOM.
    const gone = await until(() => (findCard() ? null : true), 6000)
    if (!gone) {
      if (box) {
        setNativeValue(box, '')
        setNativeValue(box, name)
        await sleep(1500)
      }
      if (findCard()) {
        return { outcome: 'failed', error: 'Still listed as a connection afterwards' }
      }
    }

    return { outcome: 'done' }
  }

  // -------------------------------------------------------------- unfollows

  const findRow = (): HTMLElement | null => {
    for (const row of document.querySelectorAll('[data-chameleon-result-urn]')) {
      if (row.querySelector(`a[href*="${profileHref(id)}"]`)) return row as HTMLElement
    }
    return null
  }

  // Scrolling is a convenience, never a precondition: the original driver let
  // it fail silently, and a scroll hiccup must not abort an irreversible run.
  const scroll = (run: () => void) => {
    try {
      run()
    } catch {
      /* no layout in this host */
    }
  }

  let row = findRow()
  if (!row) {
    // The row may be further down a long, lazily paged list.
    scroll(() => window.scrollTo(0, document.documentElement.scrollHeight))
    row = await until(findRow, 3000)
    if (!row) return { outcome: 'already-gone', error: 'Not in the list' }
  }

  const found = row
  scroll(() => found.scrollIntoView({ block: 'center' }))

  const button = await until(() => byRole(row as HTMLElement, 'button', re('stopFollowing')), 3000)
  if (!button) return { outcome: 'already-gone', error: 'Not currently followed' }

  if (dryRun) return { outcome: 'would-do' }

  button.click()

  const problem = await confirmDialog()
  if (problem) return { outcome: 'failed', error: problem }

  /**
   * The row stays in place after unfollowing and the button flips to "follow",
   * so that label disappearing *is* the proof the action landed. It needs a
   * real wait — sampling once after a fixed pause reports successes as
   * failures.
   */
  const flipped = await until(() => {
    const current = findRow()
    if (!current) return true
    return byRole(current, 'button', re('stopFollowing')) ? null : true
  }, 10000)

  if (!flipped) return { outcome: 'failed', error: 'Still shows as followed afterwards' }

  return { outcome: 'done' }
}

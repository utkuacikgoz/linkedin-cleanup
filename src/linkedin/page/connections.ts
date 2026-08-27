import type { RawCard } from '../types.ts'

/**
 * DOM readers that run inside the LinkedIn page.
 *
 * These are shared by both front ends: the extension imports them and calls
 * them directly in its content script, and the Playwright driver stringifies
 * them for `page.evaluate`. That second path is why every function here must be
 * **self-contained** — no imports, no module-scope references, nothing from a
 * closure. Only the DOM and its own body.
 *
 * State is cached on `window` between rounds. A fresh navigation clears it,
 * which is exactly when it should be recomputed.
 */

type Cache = {
  __incleanupSeen?: Set<string>
  __incleanupContainer?: Element | null
  __incleanupPane?: Element | null
}

/**
 * Returns only the cards that have appeared since the previous call.
 *
 * Locating a card by walking up from every anchor is quadratic once the list
 * holds hundreds of rows, and reading `innerText` forces a reflow per card. So
 * the list container is resolved once, and each round touches only rows whose
 * profile id is new.
 */
export const harvestConnections = (): RawCard[] => {
  const scope = window as unknown as Cache

  const idOf = (el: Element): string | null => {
    const href = el.getAttribute('href') || ''
    const match = href.match(/\/in\/([^/?#]+)/)
    return match ? decodeURIComponent(match[1]!) : null
  }

  const hasMultipleProfiles = (el: Element): boolean => {
    let seenId: string | null = null
    for (const anchor of el.querySelectorAll('a[href*="/in/"]')) {
      const id = idOf(anchor)
      if (!id) continue
      if (seenId === null) seenId = id
      else if (seenId !== id) return true
    }
    return false
  }

  // The list container is the parent of the largest group of sibling cards; a
  // card is the largest ancestor of an anchor that still holds one profile.
  const findContainer = (): Element | null => {
    const counts = new Map<Element, number>()
    const cards = new Set<Element>()

    for (const anchor of document.querySelectorAll('a[href*="/in/"]')) {
      if (!idOf(anchor)) continue

      let card: Element = anchor
      for (let depth = 0; depth < 15; depth++) {
        const parent = card.parentElement
        if (!parent || parent === document.body) break
        if (hasMultipleProfiles(parent)) break
        card = parent
      }
      if (cards.has(card)) continue
      cards.add(card)

      const parent = card.parentElement
      if (parent) counts.set(parent, (counts.get(parent) || 0) + 1)
    }

    let best: Element | null = null
    let bestCount = 0
    for (const [element, count] of counts) {
      if (count > bestCount) {
        best = element
        bestCount = count
      }
    }
    return best
  }

  if (!scope.__incleanupSeen) scope.__incleanupSeen = new Set<string>()
  const seen = scope.__incleanupSeen

  // LinkedIn tags each row with componentkey="ConnectionCard_<n>-<id>". When
  // that holds it is exact and cheap; the ancestor walk is the fallback for
  // when the attribute is renamed.
  let rows: Element[] = [...document.querySelectorAll('[componentkey^="ConnectionCard_"]')]
  if (rows.length === 0) {
    let container = scope.__incleanupContainer
    if (!container || !container.isConnected) {
      container = findContainer()
      scope.__incleanupContainer = container
    }
    if (!container) return []
    rows = [...container.children]
  }

  const found: RawCard[] = []
  for (const card of rows) {
    const anchor = card.querySelector('a[href*="/in/"]')
    if (!anchor) continue

    const id = idOf(anchor)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const lines = ((card as HTMLElement).innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (lines.length === 0) continue

    const name = lines[0]!
    const connectedText =
      lines.find((line) => /^(connected on|bağlantı kurulma|bağlantı tarihi)/i.test(line)) || ''
    const headline =
      lines.find(
        (line) =>
          line !== name &&
          line !== connectedText &&
          !/^(message|mesaj|connected|bağlantı|following|takip)/i.test(line) &&
          !/^\d+(st|nd|rd|th)$/i.test(line) &&
          line.length > 2,
      ) || ''

    const img = card.querySelector('img')
    const avatarUrl = img && /^https?:/.test(img.src) ? img.src : ''

    found.push({ id, name, headline, connectedText, avatarUrl })
  }

  // Nothing new can mean the fallback locked onto a stale container, so make
  // the next round re-resolve it.
  if (found.length === 0) scope.__incleanupContainer = null

  return found
}

/**
 * The connections page states its own total ("1,217 connections"). Knowing it
 * turns the scroll loop from "stop when it looks finished" — which LinkedIn
 * defeats by stalling mid-list for several seconds — into a real target. It is
 * also how a broken reader is told apart from an empty list.
 */
export const readConnectionsTotal = (): number | null => {
  const body = document.body.innerText ?? document.body.textContent ?? ''
  const match = body.match(/([\d][\d.,\u00a0 ]*)\s*(connections|bağlantı)/i)
  if (!match) return null
  const count = Number(match[1]!.replace(/[^\d]/g, ''))
  return Number.isFinite(count) && count > 0 ? count : null
}

/**
 * Some lists live in an inner scroll pane rather than the window. The pane is
 * picked by how many entries it contains rather than by size — sizing alone
 * picks up unrelated wrappers, and then the scroll silently does nothing.
 * Falls back to scrolling the window, which is what the classic pages use.
 */
export const scrollToEnd = (): number => {
  const scope = window as unknown as Cache

  let pane = scope.__incleanupPane as (Element & { scrollTop: number }) | null | undefined
  if (!pane || !pane.isConnected || pane.scrollHeight <= pane.clientHeight + 200) {
    pane = null
    let bestProfiles = 0
    for (const el of document.querySelectorAll('div, main, section, ul')) {
      if (el.scrollHeight <= el.clientHeight + 200) continue
      const profiles = el.querySelectorAll('a[href*="/in/"], a[href*="/company/"]').length
      if (profiles < 4) continue
      if (profiles > bestProfiles) {
        pane = el as Element & { scrollTop: number }
        bestProfiles = profiles
      }
    }
    scope.__incleanupPane = pane
  }

  if (pane) {
    pane.scrollTop = pane.scrollHeight
    return pane.scrollHeight
  }

  window.scrollTo(0, document.documentElement.scrollHeight)
  return document.documentElement.scrollHeight
}

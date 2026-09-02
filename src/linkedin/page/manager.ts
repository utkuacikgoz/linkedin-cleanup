import type { RawCard } from '../types.ts'

/**
 * Readers for the network-manager lists (followed pages and followed people).
 * These run the classic LinkedIn markup rather than the componentkey-based
 * rewrite used by the connections page, so cards carry
 * `data-chameleon-result-urn` and the action is a plain artdeco button.
 *
 * Self-contained, for the reason given in `connections.ts` — which is why the
 * two lists are one parameterised reader rather than two functions sharing a
 * helper. A module-scope reference is undefined once this is stringified.
 *
 * `idPattern` arrives as a regex *source string*: arguments cross into the page
 * as JSON, and a RegExp does not survive that.
 */
export const harvestManagerCards = (linkPattern: string, idPattern: string): RawCard[] => {
  const scope = window as unknown as { __incleanupManagerSeen?: Set<string> }
  if (!scope.__incleanupManagerSeen) scope.__incleanupManagerSeen = new Set<string>()
  const seen = scope.__incleanupManagerSeen

  const id_re = new RegExp(idPattern)
  const found: RawCard[] = []

  for (const row of document.querySelectorAll('[data-chameleon-result-urn]')) {
    const link = row.querySelector(`a[href*="${linkPattern}"]`)
    if (!link) continue

    const match = (link.getAttribute('href') || '').match(id_re)
    if (!match) continue
    const id = decodeURIComponent(match[1]!)
    if (seen.has(id)) continue

    const lines = ((row as HTMLElement).innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (lines.length === 0) continue

    // Rows read: name, then a detail line, then the Following button.
    const name = lines[0]!
    const headline =
      lines.find(
        (line) => line !== name && !/^(following|takip|unfollow|takibi bırak)$/i.test(line),
      ) || ''

    const img = row.querySelector('img')
    const avatarUrl = img && /^https?:/.test(img.src) ? img.src : ''

    seen.add(id)
    found.push({ id, name, headline, avatarUrl })
  }

  return found
}

export const PAGES_ARGS: [string, string] = ['/company/', '\\/company\\/([^/?#]+)']
export const FOLLOWING_ARGS: [string, string] = ['/in/', '\\/in\\/([^/?#]+)']

/** The declared total, e.g. "148 pages" or "You are following 4 people". */
export const readManagerTotal = (): number | null => {
  const text = document.body.innerText ?? document.body.textContent ?? ''
  const match =
    text.match(/([\d][\d.,]*)\s+(pages|sayfa)/i) ||
    text.match(/following\s+([\d][\d.,]*)\s+people/i)
  if (!match) return null
  const count = Number(match[1]!.replace(/[^\d]/g, ''))
  return Number.isFinite(count) && count > 0 ? count : null
}

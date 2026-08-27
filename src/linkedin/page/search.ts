/**
 * Reader for 1st-degree people search, which is the only page that prints
 * shared-connection counts. Self-contained, per `connections.ts`.
 */

export type SearchHarvest = {
  /** `<html lang>`, so the caller knows whether it can read the wording below. */
  lang: string
  rows: { id: string; text: string }[]
}

/**
 * Each result is one anchor wrapping the whole row, so its own text already
 * carries the mutual line. The mutual-connection *names* are anchors too, so a
 * row only counts when it shows a degree marker or a mutual line — otherwise
 * those names become fake results.
 *
 * The page language is returned alongside the rows rather than inferred from
 * them: the caller must be able to tell "no shared connections" from "this
 * wording is in a language we cannot read", and only the former is a zero.
 */
export const harvestSearchResults = (): SearchHarvest => {
  const best = new Map<string, string>()

  for (const anchor of document.querySelectorAll('a[href*="/in/"]')) {
    const match = (anchor.getAttribute('href') || '').match(/\/in\/([^/?#]+)/)
    if (!match) continue

    const text = ((anchor as HTMLElement).innerText || '').replace(/\n+/g, ' | ')
    if (!/•\s*1st\b|•\s*1\.|mutual connection|ortak bağlant/i.test(text)) continue

    const id = decodeURIComponent(match[1]!)
    const previous = best.get(id)
    if (!previous || text.length > previous.length) best.set(id, text)
  }

  return {
    lang: document.documentElement.getAttribute('lang') || '',
    rows: [...best.entries()].map((entry) => ({ id: entry[0], text: entry[1] })),
  }
}

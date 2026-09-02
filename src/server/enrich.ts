import { config } from './config.ts'
import { workPage } from './browser.ts'
import { evaluateInPage } from './evaluate.ts'
import { harvestSearchResults } from '../linkedin/page/search.ts'
import { localeOf, parseMutualCount } from '../linkedin/mutuals.ts'
import type { Entity } from './types.ts'

export type EnrichOptions = {
  onProgress: (done: number, total: number | null) => void
  onCheckpoint: (patches: Map<string, Partial<Entity>>) => Promise<void>
  shouldStop: () => boolean
}

export type EnrichResult = {
  patches: Map<string, Partial<Entity>>
  pagesRead: number
  hitCap: boolean
  /** Null when LinkedIn is rendering in a language the parser cannot read. */
  locale: string | null
}

/**
 * Walks 1st-degree people search page by page. LinkedIn caps this search at
 * roughly 1,000 results, so on a larger network the tail simply never appears —
 * those entries keep `mutual: null` rather than being recorded as zero.
 *
 * The page's own language decides whether a row with no mutual line means "no
 * shared connections" or "we cannot read this wording". Getting that wrong is
 * how every connection on a non-English account ends up looking like a
 * zero-shared stranger.
 */
export async function enrichMutuals(options: EnrichOptions): Promise<EnrichResult> {
  const { onProgress, onCheckpoint, shouldStop } = options
  const page = await workPage()
  const patches = new Map<string, Partial<Entity>>()

  let pagesRead = 0
  let emptyPages = 0
  let locale: ReturnType<typeof localeOf> = null

  for (let pageNumber = 1; pageNumber <= config.maxEnrichPages; pageNumber++) {
    if (shouldStop()) break

    let harvested: Awaited<ReturnType<typeof evaluateInPage<ReturnType<typeof harvestSearchResults>>>>
    try {
      await page.goto(
        `https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&page=${pageNumber}`,
        { waitUntil: 'domcontentloaded' },
      )
      await page.waitForTimeout(2600)
      harvested = await evaluateInPage(page, { fn: harvestSearchResults, args: [] })
    } catch {
      // A tab closed or a navigation refused mid-run should not throw away the
      // pages already gathered — this takes minutes to collect.
      break
    }
    pagesRead = pageNumber
    locale = localeOf(harvested.lang)

    if (harvested.rows.length === 0) {
      emptyPages += 1
      if (emptyPages >= 2) break
      continue
    }
    emptyPages = 0

    for (const row of harvested.rows) {
      if (!patches.has(row.id)) patches.set(row.id, { mutual: parseMutualCount(row.text, locale) })
    }

    onProgress(patches.size, null)

    if (pageNumber % 10 === 0) await onCheckpoint(patches)
  }

  return { patches, pagesRead, hitCap: pagesRead >= config.maxEnrichPages, locale }
}

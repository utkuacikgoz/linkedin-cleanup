import type { Page } from 'playwright-core'
import { config } from './config.ts'
import { workPage } from './browser.ts'
import { evaluateInPage } from './evaluate.ts'
import { DATASETS } from '../linkedin/datasets.ts'
import { scrollToEnd } from '../linkedin/page/connections.ts'
import { StaleReaderError } from '../linkedin/errors.ts'
import { scrollWaitFor } from '../linkedin/pacing.ts'
import type { DatasetKind, Entity, RawCard } from './types.ts'

export type ScanOptions = {
  onProgress: (count: number, total: number | null) => void
  /** Called periodically so a scan interrupted halfway is not wasted. */
  onCheckpoint: (entities: Entity[]) => Promise<void>
  shouldStop: () => boolean
}

/**
 * Some lists page in with a button instead of on scroll, in which case
 * scrolling alone stalls after the first screenful.
 */
async function clickLoadMore(page: Page): Promise<void> {
  const button = page
    .getByRole('button', {
      name: /^(load more|show more results|show more|daha fazla|daha fazla sonuç)/i,
    })
    .first()
  if (await button.isVisible().catch(() => false)) await button.click().catch(() => {})
}

export async function scanDataset(kind: DatasetKind, options: ScanOptions): Promise<Entity[]> {
  const { onProgress, onCheckpoint, shouldStop } = options
  const spec = DATASETS[kind]
  const page = await workPage()
  const cards = new Map<string, RawCard>()

  const absorb = async () => {
    const fresh = await evaluateInPage(page, spec.harvest)
    for (const card of fresh) if (!cards.has(card.id)) cards.set(card.id, card)
  }

  await page.goto(spec.url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await absorb()

  const declared = await evaluateInPage(page, spec.total)
  const target = declared === null ? null : Math.min(declared, config.maxConnections)

  // The page stating a total while the reader found nothing is not an empty
  // list — it is a reader that no longer matches LinkedIn's markup. Saying so
  // is the difference between a bug report and a tool that looks abandoned.
  if (declared !== null && declared > 0 && cards.size === 0) {
    throw new StaleReaderError(spec.label, declared)
  }

  onProgress(cards.size, target)

  let idleRounds = 0
  let checkpointedAt = 0

  while (idleRounds < config.scrollIdleRounds && cards.size < config.maxConnections) {
    if (shouldStop()) break
    if (target !== null && cards.size >= target) break

    const before = cards.size
    await evaluateInPage(page, { fn: scrollToEnd, args: [] })
    await clickLoadMore(page)
    // LinkedIn stalls mid-list for seconds at a time; back off rather than
    // mistaking a pause for the end of the list.
    await page.waitForTimeout(scrollWaitFor(idleRounds, config.scrollWaitMs))
    await absorb()
    idleRounds = cards.size > before ? 0 : idleRounds + 1
    onProgress(cards.size, target)

    if (cards.size - checkpointedAt >= config.checkpointEvery) {
      checkpointedAt = cards.size
      await onCheckpoint([...cards.values()].map(spec.toEntity))
    }
  }

  return [...cards.values()].slice(0, config.maxConnections).map(spec.toEntity)
}

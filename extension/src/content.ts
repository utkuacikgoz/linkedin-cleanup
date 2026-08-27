import { DATASETS } from '../../src/linkedin/datasets.ts'
import { scrollToEnd } from '../../src/linkedin/page/connections.ts'
import { StaleReaderError } from '../../src/linkedin/errors.ts'
import { PACING, scrollWaitFor } from '../../src/linkedin/pacing.ts'
import type { DatasetKind, Entity, RawCard } from '../../src/linkedin/types.ts'
import type { Request, ScanEvent } from './messages.ts'

/**
 * Runs inside the LinkedIn tab.
 *
 * The readers are imported and called directly here — no `eval`, which MV3's
 * content security policy forbids anyway. That is the whole reason they are
 * real functions rather than the source strings this project used to keep: the
 * Playwright driver stringifies the same code, the extension just calls it.
 *
 * The scan lives here rather than in the service worker on purpose. An MV3
 * worker is torn down after around thirty seconds idle, and a full scan runs
 * for minutes; a content script lives as long as its tab.
 */

let stopRequested = false

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const emit = (dataset: DatasetKind, event: ScanEvent) => {
  // The panel may be closed, in which case nobody is listening. That is fine
  // and must not abort the scan, so the delivery failure is swallowed.
  void chrome.runtime.sendMessage({ kind: 'incleanup:event', dataset, event }).catch(() => {})
}

async function scan(dataset: DatasetKind): Promise<void> {
  const spec = DATASETS[dataset]
  const cards = new Map<string, RawCard>()

  const absorb = () => {
    const fresh = spec.harvest.fn(...(spec.harvest.args as never[]))
    for (const card of fresh) if (!cards.has(card.id)) cards.set(card.id, card)
  }

  const entities = (): Entity[] => [...cards.values()].slice(0, PACING.maxEntries).map(spec.toEntity)

  absorb()

  const declared = spec.total.fn()
  const target = declared === null ? null : Math.min(declared, PACING.maxEntries)

  // A stated total with nothing read is a stale reader, not an empty list.
  if (declared !== null && declared > 0 && cards.size === 0) {
    throw new StaleReaderError(spec.label, declared)
  }

  emit(dataset, { kind: 'progress', found: cards.size, total: target })

  let idleRounds = 0
  let checkpointedAt = 0

  while (idleRounds < PACING.scrollIdleRounds && cards.size < PACING.maxEntries) {
    if (stopRequested) break
    if (target !== null && cards.size >= target) break

    const before = cards.size
    scrollToEnd()
    clickLoadMore()
    await sleep(scrollWaitFor(idleRounds))
    absorb()
    idleRounds = cards.size > before ? 0 : idleRounds + 1

    emit(dataset, { kind: 'progress', found: cards.size, total: target })

    if (cards.size - checkpointedAt >= PACING.checkpointEvery) {
      checkpointedAt = cards.size
      emit(dataset, { kind: 'checkpoint', entities: entities() })
    }
  }

  emit(dataset, { kind: 'done', entities: entities() })
}

/**
 * Some lists page in with a button instead of on scroll, in which case
 * scrolling alone stalls after the first screenful.
 */
function clickLoadMore(): void {
  const label = /^(load more|show more results|show more|daha fazla|daha fazla sonuç)/i

  for (const button of document.querySelectorAll('button')) {
    const text = (button.innerText || button.textContent || '').trim()
    if (!label.test(text)) continue
    if (button.offsetParent === null) continue
    button.click()
    return
  }
}

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
  if (message.kind === 'incleanup:ping') {
    sendResponse({ ready: true, url: location.href })
    return false
  }

  if (message.kind === 'incleanup:stop') {
    stopRequested = true
    sendResponse({ stopping: true })
    return false
  }

  if (message.kind === 'incleanup:scan') {
    stopRequested = false
    sendResponse({ started: true })

    scan(message.dataset).catch((error: unknown) => {
      emit(message.dataset, {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    })
    return false
  }

  return false
})

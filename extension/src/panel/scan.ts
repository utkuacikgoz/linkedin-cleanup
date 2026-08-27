import { DATASETS } from '../../../src/linkedin/datasets.ts'
import type { DatasetKind } from '../../../src/linkedin/types.ts'
import type { Request } from '../messages.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const send = <T>(tabId: number, message: Request): Promise<T | null> =>
  chrome.tabs.sendMessage(tabId, message).catch(() => null) as Promise<T | null>

/** The tab the work happens in: whichever LinkedIn tab is open, or a new one. */
async function linkedInTab(): Promise<chrome.tabs.Tab> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (active?.url?.includes('linkedin.com')) return active

  const [existing] = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' })
  if (existing) return existing

  return chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: false })
}

/**
 * Waits for the content script to answer rather than for a load event: a tab
 * can report itself complete before the script is listening, and a scan sent
 * into that gap is simply lost.
 */
async function waitForContentScript(tabId: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const pong = await send<{ ready: boolean }>(tabId, { kind: 'incleanup:ping' })
    if (pong?.ready) return true
    await sleep(400)
  }

  return false
}

export type StartResult = { tabId: number } | { error: string }

/**
 * Puts the tab on the right list and asks the content script to scan it.
 * Progress arrives separately, as `incleanup:event` runtime messages.
 */
export async function startScan(dataset: DatasetKind): Promise<StartResult> {
  const spec = DATASETS[dataset]

  const tab = await linkedInTab()
  if (tab.id === undefined) return { error: 'Could not find a LinkedIn tab to work in.' }

  if (!(tab.url ?? '').includes(spec.marker)) {
    await chrome.tabs.update(tab.id, { url: spec.url })
    // The navigation replaces the content script, so the old one cannot be
    // asked anything; the wait below is for the new one.
    await sleep(500)
  }

  if (!(await waitForContentScript(tab.id))) {
    return {
      error:
        'The LinkedIn tab never became ready. If you are signed out, sign in there and try again.',
    }
  }

  const started = await send<{ started: boolean }>(tab.id, {
    kind: 'incleanup:scan',
    dataset,
  })
  if (!started?.started) return { error: 'The LinkedIn tab did not accept the scan.' }

  return { tabId: tab.id }
}

export async function stopScan(tabId: number): Promise<void> {
  await send(tabId, { kind: 'incleanup:stop' })
}

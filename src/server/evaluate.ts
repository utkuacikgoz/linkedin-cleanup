import type { Page } from 'playwright-core'
import type { PageCall } from '../linkedin/datasets.ts'

/**
 * Runs one of the shared page readers inside the browser.
 *
 * tsx compiles with esbuild's `keepNames`, which rewrites nested helpers into
 * calls to a `__name` helper that does not exist inside the page — which is why
 * these readers used to be kept as untyped source strings. Supplying an
 * identity `__name` in the evaluated scope removes that constraint entirely, so
 * the readers can be real, type-checked functions shared with the extension.
 *
 * Arguments cross as JSON, so they must be serialisable — a RegExp is passed as
 * its source string and rebuilt on the far side.
 */
export function pageSource<T>(call: PageCall<T>): string {
  const args = call.args.map((arg) => JSON.stringify(arg)).join(', ')
  return `(() => { const __name = (f) => f; return (${call.fn.toString()})(${args}) })()`
}

export function evaluateInPage<T>(page: Page, call: PageCall<T>): Promise<Awaited<T>> {
  // page.evaluate resolves a promise the page returns, so an async reader
  // arrives here already settled.
  return page.evaluate(pageSource(call)) as Promise<Awaited<T>>
}

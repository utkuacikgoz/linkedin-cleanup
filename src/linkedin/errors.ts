/**
 * Raised when a list page states a total but the reader found no rows at all.
 * That combination cannot mean "your list is empty" — it means the selectors no
 * longer match what LinkedIn is serving.
 *
 * Reported as its own error so both front ends can say which reader broke and
 * what the page claimed, instead of returning a bare "Found 0" that a user
 * cannot tell apart from an empty account.
 */
export class StaleReaderError extends Error {
  constructor(
    readonly listLabel: string,
    readonly declaredTotal: number,
  ) {
    super(
      `${listLabel}: the page says ${declaredTotal.toLocaleString()}, but the reader found none. ` +
        `LinkedIn has almost certainly changed this page's markup — this build can no longer read it.`,
    )
    this.name = 'StaleReaderError'
  }
}

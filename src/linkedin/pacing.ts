/**
 * Scan pacing, shared by both front ends.
 *
 * These are not tuning knobs so much as the manners the tool is built on:
 * LinkedIn restricts accounts that act in a steady machine rhythm, and a scan
 * that hammers the page is the clearest automation signal an account can send.
 * The extension and the Playwright driver must agree on them, or the safer of
 * the two is not the one users actually run.
 */
export const PACING = {
  /** Upper bound on rows pulled in one scrape. */
  maxEntries: 5000,
  /** Scroll rounds without new rows before the scrape is considered complete. */
  scrollIdleRounds: 12,
  /** Pause after each scroll, for LinkedIn to append the next page of cards. */
  scrollWaitMs: 1200,
  /** New rows between snapshot writes, so an interrupted scan is not lost. */
  checkpointEvery: 200,

  /** Connection removals per run. Deliberately low: LinkedIn cannot undo them. */
  maxRemovalsPerRun: 100,
  /** Unfollows per run. Higher, because following again is one click. */
  maxUnfollowsPerRun: 500,

  /**
   * Randomised pause between actions. A steady machine rhythm is what LinkedIn
   * restricts accounts for, so this is a throttle, not a delay to tune away.
   */
  actionDelayMinMs: 1500,
  actionDelayMaxMs: 3500,
} as const

/** Per-run cap for a list. Removals are capped harder than unfollows. */
export const limitFor = (kind: 'connections' | 'pages' | 'following'): number =>
  kind === 'connections' ? PACING.maxRemovalsPerRun : PACING.maxUnfollowsPerRun

export const actionJitter = (
  minMs: number = PACING.actionDelayMinMs,
  maxMs: number = PACING.actionDelayMaxMs,
): number => minMs + Math.random() * Math.max(0, maxMs - minMs)

/**
 * LinkedIn stalls mid-list for seconds at a time. Backing off further on each
 * idle round is what keeps a pause from being mistaken for the end of the list.
 */
export const scrollWaitFor = (idleRounds: number, baseMs: number = PACING.scrollWaitMs): number =>
  baseMs * (1 + Math.min(idleRounds, 4))

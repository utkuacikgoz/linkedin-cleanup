import type { Page } from 'playwright-core'
import { config } from './config.ts'
import { workPage } from './browser.ts'
import { evaluateInPage } from './evaluate.ts'
import { DATASETS } from '../linkedin/datasets.ts'
import { CONTROL_LABELS } from '../linkedin/labels-ui.ts'
import { performAction } from '../linkedin/page/actions.ts'
import { actionJitter } from '../linkedin/pacing.ts'
import type { ActionResult, DatasetKind, Entity } from './types.ts'

/**
 * The driver no longer knows how to remove anyone — `performAction` does, in
 * the page, and the extension runs that same function. This file is what is
 * left: getting to the right list, pacing the run, and enforcing the caps.
 */

const jitter = () => actionJitter(config.removalDelayMinMs, config.removalDelayMaxMs)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function ensureOn(page: Page, url: string, marker: string): Promise<void> {
  if (page.url().includes(marker)) return
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
}

async function actOn(
  page: Page,
  kind: DatasetKind,
  entity: Entity,
  dryRun: boolean,
): Promise<ActionResult> {
  const base = { id: entity.id, name: entity.name }
  const spec = DATASETS[kind]

  await ensureOn(page, spec.url, spec.marker)
  if (/\/(login|uas|checkpoint|signup)/.test(page.url())) {
    return { ...base, outcome: 'failed', error: 'LinkedIn asked to log in again' }
  }

  const result = await evaluateInPage(page, {
    fn: performAction,
    args: [{ kind, id: entity.id, name: entity.name, dryRun, labels: CONTROL_LABELS }],
  })

  return { ...base, ...result }
}

export type ActionProgress = (result: ActionResult, done: number, total: number) => void

export async function runActions(
  kind: DatasetKind,
  targets: Entity[],
  options: { dryRun: boolean; shouldStop: () => boolean },
  onProgress: ActionProgress,
): Promise<ActionResult[]> {
  // Removing a connection cannot be undone; unfollowing can, so it is not held
  // to the same cap.
  const limit = kind === 'connections' ? config.maxRemovalsPerRun : config.maxUnfollowsPerRun
  if (targets.length > limit) {
    throw new Error(
      `Refusing to ${DATASETS[kind].verb} ${targets.length} entries in one run (limit ${limit}). ` +
        `Split it up, or raise INCLEANUP_MAX_REMOVALS / INCLEANUP_MAX_UNFOLLOWS.`,
    )
  }

  const page = await workPage()
  const results: ActionResult[] = []

  for (const [index, entity] of targets.entries()) {
    if (options.shouldStop()) break

    let result: ActionResult
    try {
      result = await actOn(page, kind, entity, options.dryRun)
    } catch (error) {
      result = {
        id: entity.id,
        name: entity.name,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }

    results.push(result)
    onProgress(result, index + 1, targets.length)

    if (index < targets.length - 1) await sleep(jitter())
  }

  return results
}

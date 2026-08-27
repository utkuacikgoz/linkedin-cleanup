import type { DatasetKind, Entity } from '../../src/linkedin/types.ts'
import type { PageActionResult } from '../../src/linkedin/page/actions.ts'

export type ActionTarget = { id: string; name: string }

export type ActionResult = ActionTarget & PageActionResult

/** Panel → content script. */
export type ScanRequest = { kind: 'incleanup:scan'; dataset: DatasetKind }
export type PingRequest = { kind: 'incleanup:ping' }
export type StopRequest = { kind: 'incleanup:stop' }
export type ActRequest = {
  kind: 'incleanup:act'
  dataset: DatasetKind
  targets: ActionTarget[]
  dryRun: boolean
}
export type Request = ScanRequest | PingRequest | StopRequest | ActRequest

/** Content script → panel, streamed while a scan runs. */
export type ScanEvent =
  | { kind: 'progress'; found: number; total: number | null }
  | { kind: 'checkpoint'; entities: Entity[] }
  | { kind: 'done'; entities: Entity[] }
  | { kind: 'error'; message: string }

export type ActEvent =
  | { kind: 'result'; result: ActionResult; done: number; total: number }
  | { kind: 'finished' }
  | { kind: 'error'; message: string }

export type ScanEventMessage = { kind: 'incleanup:event'; dataset: DatasetKind; event: ScanEvent }
export type ActEventMessage = { kind: 'incleanup:act-event'; dataset: DatasetKind; event: ActEvent }

export const isActEventMessage = (value: unknown): value is ActEventMessage =>
  typeof value === 'object' &&
  value !== null &&
  (value as ActEventMessage).kind === 'incleanup:act-event'

export const isScanEventMessage = (value: unknown): value is ScanEventMessage =>
  typeof value === 'object' && value !== null && (value as ScanEventMessage).kind === 'incleanup:event'

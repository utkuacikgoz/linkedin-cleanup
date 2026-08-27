import type { DatasetKind, Entity } from '../../src/linkedin/types.ts'

/** Panel → content script. */
export type ScanRequest = { kind: 'incleanup:scan'; dataset: DatasetKind }
export type PingRequest = { kind: 'incleanup:ping' }
export type StopRequest = { kind: 'incleanup:stop' }
export type Request = ScanRequest | PingRequest | StopRequest

/** Content script → panel, streamed while a scan runs. */
export type ScanEvent =
  | { kind: 'progress'; found: number; total: number | null }
  | { kind: 'checkpoint'; entities: Entity[] }
  | { kind: 'done'; entities: Entity[] }
  | { kind: 'error'; message: string }

export type ScanEventMessage = { kind: 'incleanup:event'; dataset: DatasetKind; event: ScanEvent }

export const isScanEventMessage = (value: unknown): value is ScanEventMessage =>
  typeof value === 'object' && value !== null && (value as ScanEventMessage).kind === 'incleanup:event'

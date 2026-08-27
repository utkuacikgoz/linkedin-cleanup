export type { DatasetKind, Entity, RawCard, Snapshot } from '../linkedin/types.ts'

export type ActionOutcome = 'done' | 'would-do' | 'already-gone' | 'failed'

export type ActionResult = {
  id: string
  name: string
  outcome: ActionOutcome
  error?: string
}

export type JobKind = 'scan' | 'act' | 'enrich'

export type JobEvent =
  | { type: 'log'; message: string }
  | { type: 'progress'; done: number; total: number | null; message: string }
  | { type: 'result'; result: ActionResult }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string }

export type JobState = {
  id: string
  kind: JobKind
  startedAt: number
  finishedAt?: number
  status: 'running' | 'done' | 'error'
  events: JobEvent[]
}

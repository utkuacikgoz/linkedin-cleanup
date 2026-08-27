import { DATASET_KINDS, DATASET_LABELS } from '../linkedin/labels.ts'
import type { DatasetInfo } from './api.ts'

/**
 * Which lists exist is a fixed property of the app, not something to ask the
 * server for: fetching it meant the whole navigation vanished whenever the API
 * was unreachable. The wording comes from the shared table so the tabs, the job
 * messages and the extension panel cannot drift apart.
 */
export const DATASETS: DatasetInfo[] = DATASET_KINDS.map((kind) => ({
  kind,
  ...DATASET_LABELS[kind],
}))

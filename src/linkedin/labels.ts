import type { DatasetKind } from './types.ts'

/**
 * How each list is named and what acting on an entry does.
 *
 * Kept apart from `datasets.ts` because that module pulls in the page readers:
 * the web app and the extension panel need the wording for their tabs, and
 * neither should have to bundle DOM-scraping code to render a label.
 */
export type DatasetLabel = {
  /** Used in prose: job messages, dialogs. */
  label: string
  /** Used on the tab, where width is scarce. */
  short: string
  verb: 'remove' | 'unfollow'
}

export const DATASET_LABELS: Record<DatasetKind, DatasetLabel> = {
  connections: { label: 'Connections', short: 'Connections', verb: 'remove' },
  pages: { label: 'Followed pages', short: 'Pages', verb: 'unfollow' },
  following: { label: 'People you follow', short: 'Following', verb: 'unfollow' },
}

export const DATASET_KINDS: DatasetKind[] = ['connections', 'pages', 'following']

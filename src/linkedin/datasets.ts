import { harvestConnections, readConnectionsTotal } from './page/connections.ts'
import { FOLLOWING_ARGS, PAGES_ARGS, harvestManagerCards, readManagerTotal } from './page/manager.ts'
import { parseConnectedText } from './dates.ts'
import { DATASET_LABELS, type DatasetLabel } from './labels.ts'
import type { DatasetKind, Entity, RawCard } from './types.ts'

export const CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/'
export const PAGES_URL = 'https://www.linkedin.com/mynetwork/network-manager/company/'
export const FOLLOWING_URL =
  'https://www.linkedin.com/mynetwork/network-manager/people-follow/following/'

/** Profile ids can contain non-ASCII characters, so the path segment is re-encoded. */
export const profileUrl = (id: string) => `https://www.linkedin.com/in/${encodeURIComponent(id)}/`

/**
 * A page reader plus the arguments it takes. Both front ends consume this: the
 * extension calls `fn(...args)` directly in its content script, the Playwright
 * driver stringifies `fn` and passes `args` as JSON. Keeping the arguments here
 * rather than in a closure is what lets one reader serve both.
 */
export type PageCall<T> = { fn: (...args: never[]) => T; args: unknown[] }

export type DatasetSpec = DatasetLabel & {
  url: string
  /** Substring that says the browser is already on this list. */
  marker: string
  harvest: PageCall<RawCard[]>
  total: PageCall<number | null>
  toEntity: (card: RawCard) => Entity
}

export const DATASETS: Record<DatasetKind, DatasetSpec> = {
  connections: {
    ...DATASET_LABELS.connections,
    url: CONNECTIONS_URL,
    marker: '/mynetwork/invite-connect/connections',
    harvest: { fn: harvestConnections, args: [] },
    total: { fn: readConnectionsTotal, args: [] },
    toEntity: (card) => ({
      id: card.id,
      name: card.name || card.id,
      headline: card.headline,
      url: profileUrl(card.id),
      avatarUrl: card.avatarUrl || undefined,
      connectedAt: parseConnectedText(card.connectedText ?? ''),
    }),
  },
  pages: {
    ...DATASET_LABELS.pages,
    url: PAGES_URL,
    marker: '/network-manager/company',
    harvest: { fn: harvestManagerCards, args: PAGES_ARGS },
    total: { fn: readManagerTotal, args: [] },
    toEntity: (card) => ({
      id: card.id,
      name: card.name || card.id,
      headline: card.headline,
      url: `https://www.linkedin.com/company/${card.id}/`,
      avatarUrl: card.avatarUrl || undefined,
    }),
  },
  following: {
    ...DATASET_LABELS.following,
    url: FOLLOWING_URL,
    marker: '/network-manager/people-follow',
    harvest: { fn: harvestManagerCards, args: FOLLOWING_ARGS },
    total: { fn: readManagerTotal, args: [] },
    toEntity: (card) => ({
      id: card.id,
      name: card.name || card.id,
      headline: card.headline,
      url: profileUrl(card.id),
      avatarUrl: card.avatarUrl || undefined,
    }),
  },
}

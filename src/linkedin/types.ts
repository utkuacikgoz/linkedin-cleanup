/** The lists this tool can read and prune. */
export type DatasetKind = 'connections' | 'pages' | 'following'

/** A row exactly as the page gave it up, before it is normalised. */
export type RawCard = {
  id: string
  name: string
  headline: string
  avatarUrl?: string
  connectedText?: string
}

export type Entity = {
  /** Public identifier: profile slug for people, numeric id for company pages. */
  id: string
  name: string
  /** Headline for people, follower count for pages. */
  headline: string
  url: string
  avatarUrl?: string
  /** People only: when the connection was made. */
  connectedAt?: number
  /**
   * People only: shared connections. `undefined` means not looked up yet,
   * `null` means we could not read it — never treat either as zero.
   */
  mutual?: number | null
}

export type Snapshot = {
  scrapedAt: number
  entities: Entity[]
}

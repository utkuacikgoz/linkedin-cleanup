import type { DatasetKind, Entity, Snapshot } from '../../src/linkedin/types.ts'

/**
 * chrome.storage.local in place of the CLI's files under ~/.incleanup, with the
 * same two invariants:
 *
 *  - shared-connection counts take minutes to gather, so a rescan must not
 *    overwrite them with the blank values a list page yields;
 *  - the keep list lives under its own key rather than as a flag on entities,
 *    so rewriting a snapshot wholesale cannot lose it.
 */

const snapshotKey = (kind: DatasetKind) => `snapshot:${kind}`
const KEEP_KEY = 'keep'

type KeepList = Partial<Record<DatasetKind, string[]>>

export async function readSnapshot(kind: DatasetKind): Promise<Snapshot | null> {
  const stored = await chrome.storage.local.get(snapshotKey(kind))
  const snapshot = stored[snapshotKey(kind)] as Snapshot | undefined
  return snapshot && Array.isArray(snapshot.entities) ? snapshot : null
}

export async function writeSnapshot(kind: DatasetKind, entities: Entity[]): Promise<Snapshot> {
  const snapshot: Snapshot = { scrapedAt: Date.now(), entities }
  await chrome.storage.local.set({ [snapshotKey(kind)]: snapshot })
  return snapshot
}

/**
 * A scan only knows what the list page shows, so writing its result verbatim
 * would erase anything looked up separately.
 */
export async function writeScannedSnapshot(
  kind: DatasetKind,
  entities: Entity[],
  known: Map<string, number | null | undefined>,
): Promise<Snapshot> {
  return writeSnapshot(
    kind,
    entities.map((entity) => {
      const mutual = known.get(entity.id)
      return mutual === undefined ? entity : { ...entity, mutual }
    }),
  )
}

/** Read once before a scan starts — never per checkpoint, which would merge a
 * partial scan against itself and drop everything the earlier rounds held. */
export async function readEnrichment(
  kind: DatasetKind,
): Promise<Map<string, number | null | undefined>> {
  const snapshot = await readSnapshot(kind)
  return new Map((snapshot?.entities ?? []).map((entity) => [entity.id, entity.mutual]))
}

export async function readKeepList(kind: DatasetKind): Promise<Set<string>> {
  const stored = await chrome.storage.local.get(KEEP_KEY)
  return new Set(((stored[KEEP_KEY] as KeepList | undefined) ?? {})[kind] ?? [])
}

export async function setKept(
  kind: DatasetKind,
  ids: string[],
  keep: boolean,
): Promise<Set<string>> {
  const stored = await chrome.storage.local.get(KEEP_KEY)
  const list = ((stored[KEEP_KEY] as KeepList | undefined) ?? {}) as KeepList
  const current = new Set(list[kind] ?? [])

  for (const id of ids) {
    if (keep) current.add(id)
    else current.delete(id)
  }

  list[kind] = [...current]
  await chrome.storage.local.set({ [KEEP_KEY]: list })
  return current
}

const LOG_KEY = 'actionLog'

export type LoggedAction = {
  at: number
  kind: DatasetKind
  id: string
  name: string
  outcome: string
  error?: string
}

/**
 * Removals cannot be undone on LinkedIn's side, so every attempt is recorded
 * locally — the extension's answer to `~/.incleanup/removals.log`, and the only
 * way back to someone cut by mistake.
 */
export async function appendActionLog(entries: LoggedAction[]): Promise<void> {
  if (entries.length === 0) return
  const stored = await chrome.storage.local.get(LOG_KEY)
  const log = ((stored[LOG_KEY] as LoggedAction[] | undefined) ?? []).concat(entries)
  await chrome.storage.local.set({ [LOG_KEY]: log })
}

export async function readActionLog(): Promise<LoggedAction[]> {
  const stored = await chrome.storage.local.get(LOG_KEY)
  return (stored[LOG_KEY] as LoggedAction[] | undefined) ?? []
}

/** Entries acted on are gone from LinkedIn, so they leave the snapshot too. */
export async function dropFromSnapshot(kind: DatasetKind, ids: Set<string>): Promise<void> {
  const snapshot = await readSnapshot(kind)
  if (!snapshot) return
  await writeSnapshot(
    kind,
    snapshot.entities.filter((entity) => !ids.has(entity.id)),
  )
}

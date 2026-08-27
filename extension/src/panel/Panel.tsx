import { useCallback, useEffect, useMemo, useState } from 'react'
import { DATASET_KINDS, DATASET_LABELS } from '../../../src/linkedin/labels.ts'
import { looksCorporate } from '../../../src/linkedin/heuristics.ts'
import type { DatasetKind, Entity } from '../../../src/linkedin/types.ts'
import {
  IconBuilding,
  IconCheckSquare,
  IconExternal,
  IconRefresh,
  IconSearch,
  IconShield,
  IconShieldOff,
  IconSquare,
  IconStop,
  IconUserCheck,
  IconUsers,
} from '../../../src/web/icons.tsx'
import { isScanEventMessage } from '../messages.ts'
import { readEnrichment, readKeepList, readSnapshot, setKept, writeScannedSnapshot } from '../storage.ts'
import { startScan, stopScan } from './scan.ts'

const TAB_ICONS = {
  connections: IconUsers,
  pages: IconBuilding,
  following: IconUserCheck,
} as const

type ScanState = { tabId: number; found: number; total: number | null } | null

/**
 * Read-only for now: it scans, stores and shows the lists, and maintains the
 * keep list. Removing and unfollowing stay in the Playwright driver until the
 * action selectors have been exercised against live markup from here — those
 * are the irreversible ones, and shipping them unproven is not worth the week
 * it saves.
 */
export function Panel() {
  const [kind, setKind] = useState<DatasetKind>('connections')
  const [entities, setEntities] = useState<Entity[]>([])
  const [scrapedAt, setScrapedAt] = useState<number | null>(null)
  const [kept, setKeptIds] = useState<Set<string>>(new Set())
  const [showKept, setShowKept] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [corporateOnly, setCorporateOnly] = useState(false)
  const [scan, setScan] = useState<ScanState>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [snapshot, keepList] = await Promise.all([readSnapshot(kind), readKeepList(kind)])
    setEntities(snapshot?.entities ?? [])
    setScrapedAt(snapshot?.scrapedAt ?? null)
    setKeptIds(keepList)
  }, [kind])

  useEffect(() => {
    setSelected(new Set())
    setShowKept(false)
    void refresh()
  }, [refresh])

  // Rows arrive while the scan is still running, so the list fills in as it
  // goes rather than staying empty behind a progress bar.
  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (!isScanEventMessage(message)) return
      const { dataset, event } = message

      if (event.kind === 'progress') {
        setScan((current) => (current ? { ...current, found: event.found, total: event.total } : current))
        return
      }

      if (event.kind === 'error') {
        setError(event.message)
        setScan(null)
        return
      }

      void (async () => {
        const known = await readEnrichment(dataset)
        await writeScannedSnapshot(dataset, event.entities, known)
        if (dataset === kind) await refresh()
        if (event.kind === 'done') setScan(null)
      })()
    }

    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [kind, refresh])

  const run = useCallback(async () => {
    setError(null)
    const started = await startScan(kind)
    if ('error' in started) {
      setError(started.error)
      return
    }
    setScan({ tabId: started.tabId, found: 0, total: null })
  }, [kind])

  const keep = useCallback(
    async (shouldKeep: boolean) => {
      const next = await setKept(kind, [...selected], shouldKeep)
      setKeptIds(next)
      setSelected(new Set())
    },
    [kind, selected],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entities.filter((entity) => {
      if (kept.has(entity.id) !== showKept) return false
      if (needle && !`${entity.name} ${entity.headline} ${entity.id}`.toLowerCase().includes(needle)) {
        return false
      }
      if (corporateOnly && !looksCorporate(entity).flagged) return false
      return true
    })
  }, [entities, query, corporateOnly, kept, showKept])

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allShownSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id))

  return (
    <div className="panel">
      <header className="panel-head">
        <nav className="tabs">
          {DATASET_KINDS.map((k) => {
            const TabIcon = TAB_ICONS[k]
            return (
              <button
                key={k}
                className={k === kind ? 'tab active' : 'tab'}
                onClick={() => setKind(k)}
                disabled={scan !== null}
              >
                <TabIcon />
                {DATASET_LABELS[k].short}
              </button>
            )
          })}
        </nav>

        <div className="panel-actions">
          {scan ? (
            <button onClick={() => void stopScan(scan.tabId)}>
              <IconStop size={14} />
              Stop
            </button>
          ) : (
            <button onClick={() => void run()}>
              <IconRefresh />
              {entities.length === 0 ? 'Scan' : 'Rescan'}
            </button>
          )}
          <button onClick={() => void keep(!showKept)} disabled={selected.size === 0}>
            {showKept ? <IconShieldOff /> : <IconShield />}
            {showKept ? 'Stop keeping' : 'Keep'}
            {selected.size > 0 && ` ${selected.size}`}
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {scan && (
        <div className="banner">
          Scanning… {scan.found}
          {scan.total ? ` of ${scan.total}` : ' found'}. Leave the LinkedIn tab open.
        </div>
      )}

      <div className="panel-filters">
        <div className="search">
          <IconSearch />
          <input
            value={query}
            placeholder="Search name, headline or id…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="filter checkbox">
          <input
            type="checkbox"
            checked={corporateOnly}
            onChange={(event) => setCorporateOnly(event.target.checked)}
          />
          <span>Looks like a company</span>
        </label>
      </div>

      <div className="statusline">
        <span>
          <strong>{filtered.length}</strong> of {entities.length}
        </span>
        <button className="link" onClick={() => setSelected(allShownSelected ? new Set() : new Set(filtered.map((e) => e.id)))} disabled={filtered.length === 0}>
          {allShownSelected ? <IconSquare /> : <IconCheckSquare />}
          {allShownSelected ? 'none' : 'all'}
        </button>
        <span className={showKept ? 'active' : undefined}>
          <strong>{kept.size}</strong> kept
          <button
            className="link"
            onClick={() => {
              setSelected(new Set())
              setShowKept((value) => !value)
            }}
          >
            {showKept ? 'back' : 'show'}
          </button>
        </span>
        {scrapedAt && <span className="dim">{new Date(scrapedAt).toLocaleDateString()}</span>}
      </div>

      <div className="panel-list">
        {filtered.length === 0 ? (
          <Empty hasEntities={entities.length > 0} keepView={showKept} label={DATASET_LABELS[kind].label} />
        ) : (
          filtered.map((entity) => (
            <Row
              key={entity.id}
              entity={entity}
              selected={selected.has(entity.id)}
              onClick={() => toggle(entity.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function Row({
  entity,
  selected,
  onClick,
}: {
  entity: Entity
  selected: boolean
  onClick: () => void
}) {
  const [imageBroken, setImageBroken] = useState(false)
  const corporate = looksCorporate(entity)

  return (
    <div className={selected ? 'row selected' : 'row'} onClick={onClick}>
      <span className="checkbox" aria-hidden>
        {selected ? '◉' : '○'}
      </span>
      {entity.avatarUrl && !imageBroken ? (
        <img
          className="avatar"
          src={entity.avatarUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageBroken(true)}
        />
      ) : (
        <span className="avatar placeholder" aria-hidden>
          {entity.name.charAt(0)}
        </span>
      )}
      <span className="who">
        <span className="name">
          {entity.name}
          {corporate.flagged && (
            <span className="tag" title={corporate.reasons.join('; ')}>
              company?
            </span>
          )}
        </span>
        <span className="headline">{entity.headline}</span>
      </span>
      <a
        className="open"
        href={entity.url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        <IconExternal size={14} />
      </a>
    </div>
  )
}

function Empty({
  hasEntities,
  keepView,
  label,
}: {
  hasEntities: boolean
  keepView: boolean
  label: string
}) {
  if (keepView) {
    return (
      <div className="empty">
        <p>Nothing on the keep list yet.</p>
        <p className="dim">Select anyone you never want to remove and press Keep.</p>
      </div>
    )
  }

  return (
    <div className="empty">
      {hasEntities ? (
        <p>Nothing matches these filters.</p>
      ) : (
        <>
          <p>No {label.toLowerCase()} scanned yet.</p>
          <p className="dim">Sign in to LinkedIn, then press Scan.</p>
        </>
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DATASET_KINDS, DATASET_LABELS } from '../../../src/linkedin/labels.ts'
import { looksCorporate } from '../../../src/linkedin/heuristics.ts'
import { limitFor } from '../../../src/linkedin/pacing.ts'
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
  IconTrash,
  IconUserCheck,
  IconUserMinus,
  IconUsers,
} from '../../../src/web/icons.tsx'
import { isActEventMessage, isScanEventMessage, type ActionResult } from '../messages.ts'
import {
  appendActionLog,
  dropFromSnapshot,
  readEnrichment,
  readKeepList,
  readSnapshot,
  setKept,
  writeScannedSnapshot,
} from '../storage.ts'
import { startAction, startScan, stopWork } from './scan.ts'

const TAB_ICONS = {
  connections: IconUsers,
  pages: IconBuilding,
  following: IconUserCheck,
} as const

type ScanState = { tabId: number; found: number; total: number | null } | null
type ActState = { tabId: number; done: number; total: number; dryRun: boolean } | null

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
  const [act, setAct] = useState<ActState>(null)
  const [results, setResults] = useState<ActionResult[]>([])
  const [confirming, setConfirming] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Results and run state are mirrored in refs because the "finished" message
   * has to read the whole run at once. Doing that inside a state updater would
   * run the logging twice under StrictMode — and this log is the only record of
   * an irreversible action.
   */
  const resultsRef = useRef<ActionResult[]>([])
  const actRef = useRef<ActState>(null)

  const verb = DATASET_LABELS[kind].verb
  const busy = scan !== null || act !== null

  const refresh = useCallback(async () => {
    const [snapshot, keepList] = await Promise.all([readSnapshot(kind), readKeepList(kind)])
    setEntities(snapshot?.entities ?? [])
    setScrapedAt(snapshot?.scrapedAt ?? null)
    setKeptIds(keepList)

    // Entries acted on are gone from the snapshot; keeping them selected would
    // leave the count pointing at people who are no longer there.
    const present = new Set((snapshot?.entities ?? []).map((entity) => entity.id))
    setSelected((current) => {
      const stillThere = [...current].filter((id) => present.has(id))
      return stillThere.length === current.size ? current : new Set(stillThere)
    })
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
      if (isScanEventMessage(message)) {
        const { dataset, event } = message

        if (event.kind === 'progress') {
          setScan((current) =>
            current ? { ...current, found: event.found, total: event.total } : current,
          )
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
        return
      }

      if (!isActEventMessage(message)) return
      const { dataset, event } = message

      if (event.kind === 'error') {
        setError(event.message)
        setAct(null)
        return
      }

      if (event.kind === 'result') {
        resultsRef.current = [...resultsRef.current, event.result]
        setResults(resultsRef.current)
        setAct((current) =>
          current ? { ...current, done: event.done, total: event.total } : current,
        )
        return
      }

      // finished
      const run = actRef.current
      actRef.current = null
      setAct(null)

      // A dry run changes nothing, so nothing is logged and nothing is dropped.
      if (!run || run.dryRun) return

      const finished = resultsRef.current
      void (async () => {
        await appendActionLog(
          finished.map((result) => ({
            at: Date.now(),
            kind: dataset,
            id: result.id,
            name: result.name,
            outcome: result.outcome,
            ...(result.error ? { error: result.error } : {}),
          })),
        )
        await dropFromSnapshot(
          dataset,
          new Set(
            finished
              .filter((r) => r.outcome === 'done' || r.outcome === 'already-gone')
              .map((r) => r.id),
          ),
        )
        if (dataset === kind) await refresh()
      })()
    }

    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [kind, refresh])

  const runScan = useCallback(async () => {
    setError(null)
    const started = await startScan(kind)
    if ('error' in started) {
      setError(started.error)
      return
    }
    setScan({ tabId: started.tabId, found: 0, total: null })
  }, [kind])

  const runAction = useCallback(async () => {
    setError(null)
    setConfirming(false)

    /**
     * Re-read from storage rather than trusting what this component last
     * rendered. The keep list is the one guarantee that has to survive a stale
     * view, so it is enforced at the moment of acting, not at the moment of
     * selecting.
     */
    const keepNow = await readKeepList(kind)
    const allowed = [...selected].filter((id) => !keepNow.has(id))
    const blocked = selected.size - allowed.length

    if (allowed.length === 0) {
      setError(
        blocked > 0 ? 'Every one of those is on the keep list.' : 'Nothing selected to act on.',
      )
      return
    }

    const limit = limitFor(kind)
    if (allowed.length > limit) {
      setError(
        `Refusing to ${verb} ${allowed.length} in one run (limit ${limit}). Narrow the selection.`,
      )
      return
    }

    const byId = new Map(entities.map((entity) => [entity.id, entity]))
    const targets = allowed.map((id) => ({ id, name: byId.get(id)?.name ?? id }))

    resultsRef.current = []
    setResults([])
    const started = await startAction(kind, targets, dryRun)
    if ('error' in started) {
      setError(started.error)
      return
    }

    const run = { tabId: started.tabId, done: 0, total: targets.length, dryRun }
    actRef.current = run
    setAct(run)
    if (blocked > 0) setError(`Skipped ${blocked} on the keep list.`)
    if (!dryRun) setSelected(new Set())
  }, [dryRun, entities, kind, selected, verb])

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
      // The keep list is a hard exclusion, not a filter you can clear by
      // accident: those entries are only ever visible in their own view.
      if (kept.has(entity.id) !== showKept) return false
      if (
        needle &&
        !`${entity.name} ${entity.headline} ${entity.id}`.toLowerCase().includes(needle)
      ) {
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
  const failures = results.filter((result) => result.outcome === 'failed')

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
                disabled={busy}
              >
                <TabIcon />
                {DATASET_LABELS[k].short}
              </button>
            )
          })}
        </nav>

        <div className="panel-actions">
          {scan ? (
            <button onClick={() => void stopWork(scan.tabId)}>
              <IconStop size={14} />
              Stop
            </button>
          ) : (
            <button onClick={() => void runScan()} disabled={busy}>
              <IconRefresh />
              {entities.length === 0 ? 'Scan' : 'Rescan'}
            </button>
          )}
          <button onClick={() => void keep(!showKept)} disabled={selected.size === 0 || busy}>
            {showKept ? <IconShieldOff /> : <IconShield />}
            {showKept ? 'Stop keeping' : 'Keep'}
            {selected.size > 0 && ` ${selected.size}`}
          </button>
          {!showKept && (
            <button
              className="danger"
              onClick={() => setConfirming(true)}
              disabled={busy || selected.size === 0}
            >
              {verb === 'remove' ? <IconTrash /> : <IconUserMinus />}
              {verb === 'remove' ? 'Remove' : 'Unfollow'}
              {selected.size > 0 && ` ${selected.size}`}
            </button>
          )}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {scan && (
        <div className="banner">
          Scanning… {scan.found}
          {scan.total ? ` of ${scan.total}` : ' found'}. Leave the LinkedIn tab open.
        </div>
      )}

      {act && (
        <div className="banner">
          {act.dryRun ? 'Dry run' : 'Working'} — {act.done} of {act.total}.{' '}
          <button className="link" onClick={() => void stopWork(act.tabId)}>
            stop
          </button>
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
        <button
          className="link"
          onClick={() =>
            setSelected(allShownSelected ? new Set() : new Set(filtered.map((e) => e.id)))
          }
          disabled={filtered.length === 0}
        >
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

      {failures.length > 0 && (
        <div className="panel-failures">
          {failures.map((result) => (
            <div key={result.id}>
              ✗ {result.name} — {result.error}
            </div>
          ))}
        </div>
      )}

      <div className="panel-list">
        {filtered.length === 0 ? (
          <Empty
            hasEntities={entities.length > 0}
            keepView={showKept}
            label={DATASET_LABELS[kind].label}
          />
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

      {confirming && (
        <ConfirmDialog
          verb={verb}
          count={selected.size}
          names={[...selected]
            .map((id) => entities.find((e) => e.id === id)?.name ?? id)
            .slice(0, 8)}
          dryRun={dryRun}
          onToggleDryRun={() => setDryRun((value) => !value)}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void runAction()}
        />
      )}
    </div>
  )
}

function ConfirmDialog({
  verb,
  count,
  names,
  dryRun,
  onToggleDryRun,
  onCancel,
  onConfirm,
}: {
  verb: 'remove' | 'unfollow'
  count: number
  names: string[]
  dryRun: boolean
  onToggleDryRun: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="overlay">
      <div className="dialog">
        <h2>
          {verb === 'remove' ? 'Remove' : 'Unfollow'} {count} {count === 1 ? 'entry' : 'entries'}?
        </h2>
        <ul className="preview">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
          {count > names.length && <li className="more">…and {count - names.length} more</li>}
        </ul>
        <p className="warning">
          {verb === 'remove'
            ? 'LinkedIn does not undo this — re-adding means a fresh invite they must accept.'
            : 'You can follow a page again later, but the list of who you followed is not kept.'}{' '}
          Every attempt is recorded, and the LinkedIn tab has to stay open.
        </p>
        <label className="dry-run">
          <input type="checkbox" checked={dryRun} onChange={onToggleDryRun} />
          Dry run — find each one and check the control, but never click it
        </label>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>
            {dryRun ? 'Start dry run' : `${verb === 'remove' ? 'Remove' : 'Unfollow'} ${count}`}
          </button>
        </div>
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

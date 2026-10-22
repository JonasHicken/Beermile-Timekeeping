import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  useStore, getEvent, runnersInEvent, heatsInEvent, runnersInHeat,
  addRunner, removeRunner, updateRunner, updateEvent,
  autoSplitHeats, createHeat, updateHeat, deleteHeat, assignRunner, crossingsInHeat,
} from '../lib/store.js'
import { useConfirm } from '../components/Confirm.jsx'
import ImportDialog from '../components/ImportDialog.jsx'
import SyncBadge from '../components/SyncBadge.jsx'
import { useOnlineSync } from '../lib/online.js'

export default function Setup() {
  const { eventId } = useParams()
  const nav = useNavigate()
  const event = useStore((s) => getEvent(s, eventId))
  const runners = useStore((s) => runnersInEvent(s, eventId))
  const heats = useStore((s) => heatsInEvent(s, eventId))

  const [bib, setBib] = useState('')
  const [name, setName] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importReport, setImportReport] = useState(null)
  const [heatSize, setHeatSize] = useState(12)
  // The list is sorted by bib, so editing one re-sorts on every keystroke and
  // the row leaps down the page mid-edit (2 -> 25 moved it eight places). Hold
  // the order still while a bib field has focus, and re-sort once it's done.
  const [frozenIds, setFrozenIds] = useState(null)
  // Once heats exist, Setup is mostly about the heats, and a 28-row start list
  // above them pushes "Open timing" a long scroll away. Collapse it then;
  // null means "follow the default", so an explicit choice sticks.
  const [listOpen, setListOpen] = useState(null)
  const [confirmNode, askConfirm] = useConfirm()
  // An event opened from a timing link is shared with other phones; its start
  // list and heats are set in the admin portal, so here they are read-only.
  const online = Boolean(event?.online)
  useOnlineSync(eventId, online)

  if (!event) {
    return (
      <div className="app">
        <Link to="/" className="backlink">← Home</Link>
        <div className="empty">Event not found.</div>
      </div>
    )
  }

  const assignedCount = runners.filter((r) => r.heatId).length
  const timedCount = useStore((s) => s.crossings.filter((c) => c.eventId === eventId).length)
  const showList = listOpen ?? !(heats.length > 0 && runners.length > 10)

  // Splitting only needs a confirmation when it would throw something away:
  // existing heats (and the runners' places in them), or recorded timing.
  function split() {
    if (!runners.length) return
    if (!heats.length) { autoSplitHeats(eventId, heatSize); return }
    askConfirm(timedCount
      ? {
          title: 'Re-split all heats?',
          body: `Rebuilds every heat from scratch in bib order, and deletes the ${timedCount} laps already recorded for this event.`,
          confirmLabel: 'Re-split and delete laps',
          danger: true,
          onConfirm: () => autoSplitHeats(eventId, heatSize),
        }
      : {
          title: 'Re-split all heats?',
          body: 'Rebuilds every heat from scratch in bib order. Any heats you set by hand are replaced.',
          confirmLabel: 'Re-split',
          onConfirm: () => autoSplitHeats(eventId, heatSize),
        })
  }

  // Frozen order, with any runner added meanwhile appended rather than dropped.
  const displayRunners = frozenIds
    ? [
        ...frozenIds.map((id) => runners.find((r) => r.id === id)).filter(Boolean),
        ...runners.filter((r) => !frozenIds.includes(r.id)),
      ]
    : runners

  function quickAdd(e) {
    e.preventDefault()
    if (!bib.trim()) return
    addRunner(eventId, { bib, name })
    setBib(''); setName('')
    document.getElementById('bibInput')?.focus()
  }


  return (
    <div className="app">
      <div className="topbar">
        <Link to="/" className="backlink">← Home</Link>
        <div className="spacer" />
        {online && <SyncBadge eventId={eventId} />}
        <button className="btn ghost" onClick={() => nav(`/event/${eventId}/live`)}>Results</button>
      </div>

      {online ? (
        <div className="stack">
          <h1 style={{ margin: 0, fontSize: 26 }}>{event.name}</h1>
          <div className="muted tiny">{event.date} · {event.numLaps} laps</div>
          <div className="card muted" style={{ fontSize: 15 }}>
            Shared race: every phone with the timing link sees the same heats and laps.
            The start list and heats are set by the organiser on beermilenorge.no and
            update here by themselves.
          </div>
          {heats.length > 0 && (
            <div className="list">
              {heats.map((h) => (
                <button key={h.id} className={`btn block${h.status === 'running' ? ' primary' : ''}`}
                  onClick={() => nav(`/event/${eventId}/heat/${h.id}`)}>
                  {h.name} · {runners.filter((r) => r.heatId === h.id).length} runners
                  {h.status === 'running' ? ' · running' : h.status === 'done' ? ' · done' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="stack">
        <input
          value={event.name}
          onChange={(e) => updateEvent(eventId, { name: e.target.value })}
          style={{ fontSize: 20, fontWeight: 700 }}
        />
        <div className="row">
          <div className="grow">
            <label className="label">Date</label>
            <input type="date" value={event.date} onChange={(e) => updateEvent(eventId, { date: e.target.value })} />
          </div>
          <div style={{ width: 110 }}>
            <label className="label">Laps</label>
            <input type="number" min="1" max="20" inputMode="numeric" value={event.numLaps}
              onChange={(e) => updateEvent(eventId, { numLaps: Number(e.target.value) || 1 })} />
          </div>
        </div>
      </div>
      )}

      {/* --- Start list --- */}
      <div className="row" style={{ marginTop: 28, marginBottom: 12, alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Start list <span className="muted">· {runners.length}</span>
        </h2>
        <div className="spacer" />
        {runners.length > 0 && (
          <button className="btn ghost sm" onClick={() => setListOpen(!showList)} aria-expanded={showList}>
            {showList ? 'Hide' : `Show all ${runners.length}`}
          </button>
        )}
      </div>

      {!online && runners.length === 0 && (
        <div className="card stack center" style={{ padding: 22, marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 20 }}>Add your runners</div>
          <div className="muted" style={{ fontSize: 15 }}>
            Import the start list from Excel or a CSV file, or paste it. You can also add runners one by one below.
          </div>
          <button className="btn primary block" onClick={() => setShowImport(true)}>
            Import start list
          </button>
        </div>
      )}

      {!online && showList && <>
      <form className="row" onSubmit={quickAdd}>
        <input id="bibInput" style={{ width: 92 }} inputMode="numeric" placeholder="Bib"
          value={bib} onChange={(e) => setBib(e.target.value)} />
        <input className="grow" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className={`btn${runners.length ? ' primary' : ''}`}>Add</button>
      </form>

      {runners.length > 0 && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn ghost grow" onClick={() => setShowImport(true)}>
            Import from file
          </button>
        </div>
      )}
      </>}

      {importReport && (
        <div className="card stack" style={{ marginTop: 10 }}>
          <div>
            <strong>
              Imported {importReport.added.length}{' '}
              {importReport.added.length === 1 ? 'runner' : 'runners'}.
            </strong>
            {importReport.duplicates.length > 0 && (
              <div className="form-error" style={{ marginTop: 6 }}>
                Skipped {importReport.duplicates.length} with a bib already in the list
                ({importReport.duplicates.slice(0, 6).map((d) => d.bib).join(', ')}
                {importReport.duplicates.length > 6 ? '…' : ''}).
              </div>
            )}
            {importReport.missingBib.length > 0 && (
              <div className="form-error" style={{ marginTop: 6 }}>
                Skipped {importReport.missingBib.length} row(s) with no bib number.
              </div>
            )}
          </div>
          <button className="btn sm" onClick={() => setImportReport(null)}>Dismiss</button>
        </div>
      )}

      {showImport && (
        <ImportDialog
          eventId={eventId}
          existingCount={runners.length}
          onClose={() => setShowImport(false)}
          onDone={(report) => setImportReport(report)}
        />
      )}

      {showList && (
      <div className="list" style={{ marginTop: 14 }}>
        {displayRunners.map((r) => (
          <div className="item" key={r.id}>
            {/* Bib and name are editable in place — fixing a typo shouldn't mean
                deleting the runner and re-adding them. */}
            <input
              className="bib-edit"
              value={r.bib}
              onChange={(e) => updateRunner(r.id, { bib: e.target.value })}
              readOnly={online}
              onFocus={() => setFrozenIds(displayRunners.map((x) => x.id))}
              onBlur={() => setFrozenIds(null)}
              inputMode="numeric"
              aria-label={`Bib for ${r.name || 'runner'}`}
            />
            <input
              className="name-edit grow"
              value={r.name}
              onChange={(e) => updateRunner(r.id, { name: e.target.value })}
              readOnly={online}
              placeholder="Name"
              aria-label={`Name for bib ${r.bib}`}
            />
            {/* The heat is editable right here — picking one moves the runner.
                Previously this was read-only text, so an empty heat could never
                be filled and the only way to assign was a full re-split. */}
            <select
              className={`heat-select${r.heatId ? '' : ' unassigned'}`}
              value={r.heatId ?? ''}
              onChange={(e) => assignRunner(r.id, e.target.value || null)}
              disabled={online}
              aria-label={`Heat for bib ${r.bib}`}
            >
              <option value="">Unassigned</option>
              {heats.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            {!online && <button className="btn ghost danger row-remove" onClick={() => removeRunner(r.id)} aria-label="Remove">✕</button>}
          </div>
        ))}
      </div>
      )}

      {/* --- Heats --- */}
      {(runners.length > 0 || heats.length > 0) && <>
      <h2 style={{ marginTop: 28, marginBottom: 4, fontSize: 16 }}>Heats</h2>
      <p className="muted tiny" style={{ marginTop: 0 }}>
        {assignedCount}/{runners.length} runners assigned.{' '}
        {online
          ? 'Heats are set by the organiser.'
          : 'Auto-split spreads runners evenly over as few heats as fit, in bib order. Or set each runner’s heat in the start list. Tap a heat’s name to rename it.'}
      </p>

      {!online && (
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div style={{ width: 130 }}>
          <label className="label">Runners / heat</label>
          <input type="number" min="1" max="60" inputMode="numeric" value={heatSize}
            onChange={(e) => setHeatSize(Number(e.target.value) || 1)} />
        </div>
        <button className={`btn${heats.length ? '' : ' primary'}`} onClick={split}>
          {heats.length ? 'Re-split' : 'Auto-split'}
        </button>
      </div>
      )}

      <div className="list">
        {heats.map((h) => (
          <HeatCard key={h.id} eventId={eventId} heat={h} runners={runners} online={online}
            askConfirm={askConfirm}
            onTime={() => nav(`/event/${eventId}/heat/${h.id}`)} />
        ))}
      </div>
      {!online && (
        <button className="btn ghost block add-heat" onClick={() => createHeat(eventId)}>+ Add a heat</button>
      )}
      {heats.length === 0 && (
        <div className="empty">
          <div className="display">No heats yet</div>
          Auto-split to create them automatically, or add an empty heat and assign
          runners to it from the start list.
        </div>
      )}
      </>}

      {confirmNode}
      <div style={{ height: 24 }} />
    </div>
  )
}

function HeatCard({ heat, onTime, askConfirm, online }) {
  const inHeat = useStore((s) => runnersInHeat(s, heat.id))
  const crossings = useStore((s) => crossingsInHeat(s, heat.id).length)
  const state = heat.status === 'running' ? 'live' : heat.status === 'done' ? 'done' : 'setup'
  return (
    <div className="card stack">
      <div className="row">
        <input
          className="heat-name grow"
          value={heat.name}
          onChange={(e) => updateHeat(heat.id, { name: e.target.value })}
          readOnly={online}
          aria-label="Heat name"
        />
        <span className={`pill ${state}`}>{heat.status}</span>
      </div>
      <div className="muted tiny" style={{ marginTop: -4 }}>
        {inHeat.length === 0
          ? 'No runners yet — assign them in the start list above.'
          : `${inHeat.length} runners · ${crossings} crossings`}
      </div>
      {inHeat.length > 0 && (
        <div className="heat-bibs">{inHeat.map((r) => r.bib).join(' · ')}</div>
      )}
      <button className="btn primary block" onClick={onTime} disabled={inHeat.length === 0}>
        {heat.status === 'pending' ? 'Open timing' : heat.status === 'running' ? 'Resume timing' : 'Review timing'}
      </button>
      {/* Deliberately low-weight: destructive, and sits on every heat card. */}
      {!online && (
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          className="btn ghost danger sm"
          onClick={() =>
            askConfirm({
              title: `Delete ${heat.name}?`,
              body: 'Its runners become unassigned and any timing recorded for this heat is cleared.',
              confirmLabel: 'Delete heat',
              danger: true,
              onConfirm: () => deleteHeat(heat.id),
            })
          }
        >
          Delete heat
        </button>
      </div>
      )}
    </div>
  )
}

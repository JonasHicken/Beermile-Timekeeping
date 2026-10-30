import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  useStore, getEvent, runnersInEvent, heatsInEvent, runnersInHeat, standings, bibOwner,
  addRunner, removeRunner, updateRunner, updateEvent, restoreEvent,
  autoSplitHeats, createHeat, updateHeat, deleteHeat, assignRunner, crossingsInHeat,
  crossingsForRunner, getHeat, getState, assignBibs, roleOf,
} from '../lib/store.js'
import { useConfirm } from '../components/Confirm.jsx'
import { useUndo } from '../components/Undo.jsx'
import ImportDialog from '../components/ImportDialog.jsx'
import BibAssign from '../components/BibAssign.jsx'
import SyncBadge from '../components/SyncBadge.jsx'
import WhoAmI from '../components/WhoAmI.jsx'
import { useOnlineSync } from '../lib/online.js'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export default function Setup() {
  const { eventId } = useParams()
  const nav = useNavigate()
  const event = useStore((s) => getEvent(s, eventId))
  const runners = useStore((s) => runnersInEvent(s, eventId))
  const heats = useStore((s) => heatsInEvent(s, eventId))
  const timedCount = useStore((s) => s.crossings.filter((c) => c.eventId === eventId && !c.void).length)

  const [bib, setBib] = useState('')
  const [name, setName] = useState('')
  const [addError, setAddError] = useState('')
  const [rowError, setRowError] = useState(null) // { id, msg }
  const [showImport, setShowImport] = useState(false)
  const [showBibs, setShowBibs] = useState(false)
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
  const [undoNode, offerUndo] = useUndo()
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
  const showList = listOpen ?? !(heats.length > 0 && runners.length > 10)

  // Splitting only needs a confirmation when it would throw something away:
  // existing heats (and the runners' places in them), or recorded timing.
  function split() {
    if (!runners.length) return
    const run = () => {
      const made = autoSplitHeats(eventId, heatSize)
      offerUndo(`Split into ${plural(made.length, 'heat')}`, () => restoreEvent(made.snap))
    }
    if (!heats.length) { run(); return }
    askConfirm(timedCount
      ? {
          title: 'Re-split all heats?',
          body: `Rebuilds every heat from scratch in bib order, and deletes the ${timedCount} laps already recorded for this event. You can undo it straight after.`,
          confirmLabel: 'Re-split and delete laps',
          danger: true,
          onConfirm: run,
        }
      : {
          title: 'Re-split all heats?',
          body: 'Rebuilds every heat from scratch in bib order. Any heats you set by hand are replaced.',
          confirmLabel: 'Re-split',
          onConfirm: run,
        })
  }

  // Results are worked out from the lap count, so changing it once laps are
  // recorded changes every result at once. That used to happen silently, on
  // every keystroke: clearing the box to type a new number made it 1 lap, and
  // the results crowned the fastest first lap as the winner.
  function changeLaps(n) {
    if (n === event.numLaps) return true
    const apply = () => {
      const was = event.numLaps
      updateEvent(eventId, { numLaps: n })
      offerUndo(`Laps changed to ${n}`, () => updateEvent(eventId, { numLaps: was }))
    }
    if (!timedCount) { apply(); return true }
    const finished = standings(getState(), eventId).finishers.length
    askConfirm({
      title: `Change to ${plural(n, 'lap')}?`,
      body:
        `Laps are already recorded for this event. Every result is worked out from the lap count, so ` +
        (n > event.numLaps
          ? `runners who finished ${plural(event.numLaps, 'lap')} will count as still on course until a ${ordinal(n)} lap is recorded` +
            (finished ? ` (${plural(finished, 'runner')} finished right now).` : '.')
          : `runners will finish after ${plural(n, 'lap')}, and their time becomes their ${ordinal(n)} lap — later laps no longer count.`) +
        ' Penalty laps still come on top.',
      confirmLabel: `Change to ${n}`,
      danger: true,
      onConfirm: apply,
    })
    return false
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
    const b = bib.trim()
    if (!b) { setAddError('Every runner needs a bib number.'); return }
    const owner = bibOwner(getState(), eventId, b)
    if (owner) { setAddError(`Bib ${b} already belongs to ${owner.name || 'another runner'}.`); return }
    addRunner(eventId, { bib: b, name })
    setBib(''); setName(''); setAddError('')
    document.getElementById('bibInput')?.focus()
  }

  function askRemove(r) {
    const laps = getState().crossings.filter((c) => c.runnerId === r.id && !c.void).length
    askConfirm({
      title: `Remove ${r.name || `bib ${r.bib}`}?`,
      body: laps
        ? `Bib ${r.bib} has ${plural(laps, 'recorded lap')}, which go too. You can undo it straight after.`
        : `Takes bib ${r.bib} off the start list. You can undo it straight after.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        const snap = removeRunner(r.id)
        offerUndo(`Removed ${r.name || `bib ${r.bib}`}`, () => restoreEvent(snap))
      },
    })
  }

  // Laps belong to the heat they were run in. Moving a runner who already has
  // laps takes them out of that heat's results and starts them from zero in
  // the new one, which looked like the runner had vanished. Say so first.
  function moveRunner(r, heatId) {
    const from = r.heatId
    const move = () => {
      assignRunner(r.id, heatId)
      const toName = heatId ? getHeat(getState(), heatId)?.name : 'Unassigned'
      offerUndo(`Moved ${r.name || `bib ${r.bib}`} to ${toName}`, () => assignRunner(r.id, from))
    }
    const laps = from ? crossingsForRunner(getState(), from, r.id).length : 0
    if (!laps) { move(); return }
    const fromName = getHeat(getState(), from)?.name ?? 'their heat'
    const toName = heatId ? getHeat(getState(), heatId)?.name : 'no heat'
    askConfirm({
      title: `Move ${r.name || `bib ${r.bib}`} to ${toName}?`,
      body:
        `${r.name || `Bib ${r.bib}`} has ${plural(laps, 'lap')} recorded in ${fromName}. Laps belong to the heat they were run in, ` +
        `so after the move they drop out of ${fromName} and the results, and ${heatId ? `start ${toName} from zero laps` : 'are not timed anywhere'}. ` +
        `Nothing is deleted: moving them back to ${fromName} brings the laps back.`,
      confirmLabel: 'Move anyway',
      onConfirm: move,
    })
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
          <div className="muted tiny">{event.date} · {plural(event.numLaps, 'lap')}</div>
          <div className="card muted" style={{ fontSize: 15 }}>
            {roleOf(event) === 'admin' && 'You are the admin of this race: you start and finish the heats and decide who times whom. '}
            {roleOf(event) === 'timer' && event.online.role && 'You are a timer: you record laps for your runners, and the admin starts the heats. '}
            {!event.online.role && 'Shared race: every phone with the timing link sees the same heats and laps. '}
            {roleOf(event) === 'admin'
              ? 'Runners, heats, bibs and timers are set in Race admin below; the timers’ phones follow by themselves.'
              : 'The start list and heats are set by the organiser and update here by themselves.'}
          </div>
          {roleOf(event) === 'timer' && event.online.role && <WhoAmI event={event} />}
          {heats.length > 0 && (
            <div className="list">
              {heats.map((h) => (
                <button key={h.id} className={`btn block${h.status === 'running' ? ' primary' : ''}`}
                  onClick={() => nav(`/event/${eventId}/heat/${h.id}`)}>
                  {h.name} · {runners.filter((r) => r.heatId === h.id).length} runners
                  {roleOf(event) === 'timer' && event.online.me && ` · ${runners.filter((r) => r.heatId === h.id && r.timer === event.online.me).length} yours`}
                  {h.status === 'running' ? ' · running' : h.status === 'done' ? ' · done' : ''}
                </button>
              ))}
            </div>
          )}
          {roleOf(event) === 'admin' && (
            <button className="btn primary block" onClick={() => nav(`/event/${eventId}/admin`)}>
              Race admin · runners, heats, bibs, timers
            </button>
          )}
        </div>
      ) : (
      <div className="stack">
        <input
          value={event.name}
          onChange={(e) => updateEvent(eventId, { name: e.target.value })}
          style={{ fontSize: 20, fontWeight: 700 }}
          placeholder="Event name"
          aria-label="Event name"
        />
        <div className="row">
          <div className="grow">
            <label className="label">Date</label>
            <input type="date" value={event.date} onChange={(e) => updateEvent(eventId, { date: e.target.value })} />
          </div>
          <div style={{ width: 110 }}>
            <label className="label">Laps</label>
            <NumberField value={event.numLaps} min={1} max={20} onCommit={changeLaps} label="Laps" />
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
          value={bib} onChange={(e) => { setBib(e.target.value); setAddError('') }} />
        <input className="grow" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className={`btn${runners.length ? ' primary' : ''}`}>Add</button>
      </form>
      {addError && <div className="form-error" style={{ marginTop: 6 }}>{addError}</div>}

      {runners.length > 0 && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn ghost grow" onClick={() => setShowImport(true)}>
            Import from file
          </button>
          <button className="btn ghost grow" onClick={() => setShowBibs(!showBibs)} aria-expanded={showBibs}>
            Assign bibs
          </button>
        </div>
      )}
      {showBibs && runners.length > 0 && (
        <BibAssign eventId={eventId} runners={runners} onClose={() => setShowBibs(false)}
          onApply={(changes) => {
            const snap = assignBibs(eventId, changes)
            setShowBibs(false)
            offerUndo(`New bibs for ${plural(changes.length, 'runner')}`, () => restoreEvent(snap))
          }} />
      )}
      </>}

      {importReport && (
        <div className="card stack" style={{ marginTop: 10 }}>
          <div>
            <strong>
              Imported {plural(importReport.added.length, 'runner')}.
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
                Skipped {plural(importReport.missingBib.length, 'row')} with no bib number.
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
          onDone={(report) => {
            setImportReport(report)
            offerUndo(`Imported ${plural(report.added.length, 'runner')}`, () => { restoreEvent(report.snap); setImportReport(null) })
          }}
        />
      )}

      {showList && (
      <div className="list" style={{ marginTop: 14 }}>
        {displayRunners.map((r) => (
          <div key={r.id} className="stack" style={{ gap: 4 }}>
          <div className="item">
            {/* Bib and name are editable in place — fixing a typo shouldn't mean
                deleting the runner and re-adding them. */}
            <BibEdit
              runner={r}
              eventId={eventId}
              readOnly={online}
              onFocus={() => { setFrozenIds(displayRunners.map((x) => x.id)); setRowError(null) }}
              onDone={(msg) => { setFrozenIds(null); setRowError(msg ? { id: r.id, msg } : null) }}
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
              onChange={(e) => moveRunner(r, e.target.value || null)}
              disabled={online}
              aria-label={`Heat for bib ${r.bib}`}
            >
              <option value="">Unassigned</option>
              {heats.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            {!online && <button className="btn ghost danger row-remove" onClick={() => askRemove(r)} aria-label={`Remove bib ${r.bib}`}>✕</button>}
          </div>
          {rowError?.id === r.id && <div className="row-error">{rowError.msg}</div>}
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
          <NumberField value={heatSize} min={1} max={60} onCommit={(n) => { setHeatSize(n); return true }} label="Runners per heat" />
        </div>
        <button className={`btn${heats.length ? '' : ' primary'}`} onClick={split}>
          {heats.length ? 'Re-split' : 'Auto-split'}
        </button>
      </div>
      )}

      <div className="list">
        {heats.map((h) => (
          <HeatCard key={h.id} eventId={eventId} heat={h} runners={runners} online={online}
            askConfirm={askConfirm} offerUndo={offerUndo}
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
      {undoNode}
      <div style={{ height: 24 }} />
    </div>
  )
}

// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// A number box that commits when you leave it (or press Enter), not on every
// keystroke. Committing per keystroke meant clearing "4" to type "5" turned
// the value into 1 and you got "15". An empty or unusable entry goes back to
// the old value; out-of-range entries are clamped and say so. onCommit(n) may
// return false to keep the old value on screen (e.g. while a confirmation is
// open; the new value lands if it is confirmed).
function NumberField({ value, min, max, onCommit, label }) {
  const [draft, setDraft] = useState(null)
  const [note, setNote] = useState(null) // { for: clamped value, text }

  function commit() {
    if (draft == null) return
    const n = parseInt(draft, 10)
    setDraft(null)
    if (!Number.isFinite(n)) { setNote(null); return }
    const clamped = Math.min(max, Math.max(min, n))
    setNote(clamped !== n ? { for: clamped, text: `${label}: ${min}–${max}, so ${clamped}.` } : null)
    onCommit(clamped)
  }

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        aria-label={label}
      />
      {/* Only while the clamped value is the one showing (not after a cancel). */}
      {note && note.for === value && <div className="field-note">{note.text}</div>}
    </>
  )
}

// Bib edited in place, checked when you leave the box. Every runner needs a
// bib and no two can share one, since the bib is who a timing tile is. A bad
// entry goes back to the old bib, with the reason shown under the row.
function BibEdit({ runner, eventId, readOnly, onFocus, onDone }) {
  const [draft, setDraft] = useState(null)

  function commit() {
    const b = (draft ?? runner.bib).trim()
    setDraft(null)
    if (b === String(runner.bib)) { onDone(null); return }
    if (!b) { onDone(`Every runner needs a bib, so ${runner.bib} was kept.`); return }
    const owner = bibOwner(getState(), eventId, b, runner.id)
    if (owner) { onDone(`Bib ${b} already belongs to ${owner.name || 'another runner'}, so ${runner.bib} was kept.`); return }
    updateRunner(runner.id, { bib: b })
    onDone(null)
  }

  return (
    <input
      className="bib-edit"
      value={draft ?? runner.bib}
      onChange={(e) => setDraft(e.target.value)}
      readOnly={readOnly}
      onFocus={onFocus}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      inputMode="numeric"
      aria-label={`Bib for ${runner.name || 'runner'}`}
    />
  )
}

function HeatCard({ heat, onTime, askConfirm, offerUndo, online }) {
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
          : `${plural(inHeat.length, 'runner')} · ${plural(crossings, 'crossing')}`}
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
              body: crossings
                ? `Its runners become unassigned and the ${plural(crossings, 'lap')} recorded in it are cleared. You can undo it straight after.`
                : 'Its runners become unassigned. You can undo it straight after.',
              confirmLabel: 'Delete heat',
              danger: true,
              onConfirm: () => {
                const snap = deleteHeat(heat.id)
                offerUndo(`Deleted ${heat.name}`, () => restoreEvent(snap))
              },
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

import { t, plural } from '../lib/i18n.js'
import { useState } from 'react'
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom'
import {
  useStore, getEvent, runnersInEvent, heatsInEvent, runnersInHeat, standings, bibOwner,
  addRunner, removeRunner, updateRunner, updateEvent, restoreEvent,
  autoSplitHeats, createHeat, updateHeat, deleteHeat, assignRunner, crossingsInHeat,
  crossingsForRunner, getHeat, getState, assignBibs, roleOf, timerHeat,
} from '../lib/store.js'
import { useConfirm } from '../components/Confirm.jsx'
import { useUndo } from '../components/Undo.jsx'
import ImportDialog from '../components/ImportDialog.jsx'
import BibAssign from '../components/BibAssign.jsx'
import SyncBadge from '../components/SyncBadge.jsx'
import TimerCode from '../components/TimerCode.jsx'
import NumberField from '../components/NumberField.jsx'
import EventFormatEditor from '../components/EventFormatEditor.jsx'
import { formatOf, describe, formatChangeWarning } from '../lib/eventFormat.js'
import { useOnlineSync, useSyncStatus } from '../lib/online.js'


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
  const sync = useSyncStatus(eventId)
  // A timer has no business in Setup: once they are in, they go straight to
  // the heat with their runners (and wait here until the admin gives them some).
  const timer = roleOf(event) === 'timer' && Boolean(event?.online?.role)
  const myHeat = useStore((s) => (timer && event.online.me ? timerHeat(s, event) : null))

  if (!event) {
    return (
      <div className="app">
        <Link to="/" className="backlink">{t('← Home')}</Link>
        <div className="empty">{t('Event not found.')}</div>
      </div>
    )
  }

  if (timer && myHeat && !sync?.needName) return <Navigate to={`/event/${eventId}/heat/${myHeat}`} replace />

  const assignedCount = runners.filter((r) => r.heatId).length
  const showList = listOpen ?? !(heats.length > 0 && runners.length > 10)

  // Splitting only needs a confirmation when it would throw something away:
  // existing heats (and the runners' places in them), or recorded timing.
  function split() {
    if (!runners.length) return
    const run = () => {
      const made = autoSplitHeats(eventId, heatSize)
      offerUndo(t('Split into {n}', { n: plural(made.length, 'heat') }), () => restoreEvent(made.snap))
    }
    if (!heats.length) { run(); return }
    askConfirm(timedCount
      ? {
          title: t('Re-split all heats?'),
          body: t('Rebuilds every heat from scratch in bib order, and deletes the {n} laps already recorded for this event. You can undo it straight after.', { n: timedCount }),
          confirmLabel: t('Re-split and delete laps'),
          danger: true,
          onConfirm: run,
        }
      : {
          title: t('Re-split all heats?'),
          body: t('Rebuilds every heat from scratch in bib order. Any heats you set by hand are replaced.'),
          confirmLabel: t('Re-split'),
          onConfirm: run,
        })
  }

  // Results are worked out from the timing points, so changing how many there
  // are once laps are recorded changes every result at once: it asks first.
  function changeFormat(f) {
    const was = { format: event.format, numLaps: event.numLaps }
    const apply = () => {
      updateEvent(eventId, { format: f, numLaps: f.points.length })
      offerUndo(`${t('Event')}: ${describe(f)}`, () => updateEvent(eventId, was))
    }
    const before = formatOf(event).points.length
    if (!timedCount || f.points.length === before) { apply(); return }
    askConfirm({
      title: t('Change to {n}?', { n: plural(f.points.length, 'timing point') }),
      body: formatChangeWarning(before, f.points.length, standings(getState(), eventId).finishers.length),
      confirmLabel: t('Change'),
      danger: true,
      onConfirm: apply,
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
    const b = bib.trim()
    if (!b) { setAddError(t('Every runner needs a bib number.')); return }
    const owner = bibOwner(getState(), eventId, b)
    if (owner) { setAddError(t('Bib {bib} already belongs to {name}.', { bib: b, name: owner.name || t('another runner') })); return }
    addRunner(eventId, { bib: b, name })
    setBib(''); setName(''); setAddError('')
    document.getElementById('bibInput')?.focus()
  }

  function askRemove(r) {
    const laps = getState().crossings.filter((c) => c.runnerId === r.id && !c.void).length
    askConfirm({
      title: t('Remove {name}?', { name: r.name || `${t('bib')} ${r.bib}` }),
      body: laps
        ? t('Bib {bib} has {n}, which go too. You can undo it straight after.', { bib: r.bib, n: plural(laps, 'recorded lap') })
        : t('Takes bib {bib} off the start list. You can undo it straight after.', { bib: r.bib }),
      confirmLabel: t('Remove'),
      danger: true,
      onConfirm: () => {
        const snap = removeRunner(r.id)
        offerUndo(t('Removed {name}', { name: r.name || `${t('bib')} ${r.bib}` }), () => restoreEvent(snap))
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
      const toName = heatId ? getHeat(getState(), heatId)?.name : t('Unassigned')
      offerUndo(t('Moved {name} to {heat}', { name: r.name || `${t('bib')} ${r.bib}`, heat: toName }), () => assignRunner(r.id, from))
    }
    const laps = from ? crossingsForRunner(getState(), from, r.id).length : 0
    if (!laps) { move(); return }
    const fromName = getHeat(getState(), from)?.name ?? t('their heat')
    const toName = heatId ? getHeat(getState(), heatId)?.name : t('no heat')
    askConfirm({
      title: t('Move {name} to {heat}?', { name: r.name || `${t('bib')} ${r.bib}`, heat: toName }),
      body: t(heatId
        ? '{name} has {n} recorded in {from}. Laps belong to the heat they were run in, so after the move they drop out of {from} and the results, and start {to} from zero laps. Nothing is deleted: moving them back to {from} brings the laps back.'
        : '{name} has {n} recorded in {from}. Laps belong to the heat they were run in, so after the move they drop out of {from} and the results, and are not timed anywhere. Nothing is deleted: moving them back to {from} brings the laps back.',
      { name: r.name || `${t('Bib')} ${r.bib}`, n: plural(laps, 'lap'), from: fromName, to: toName }),
      confirmLabel: t('Move anyway'),
      onConfirm: move,
    })
  }

  return (
    <div className="app">
      <div className="topbar">
        <Link to="/" className="backlink">{t('← Home')}</Link>
        <div className="spacer" />
        {online && <SyncBadge eventId={eventId} />}
        <button className="btn ghost" onClick={() => nav(`/event/${eventId}/live`)}>{t('Results')}</button>
      </div>

      {online ? (
        <div className="stack">
          <h1 style={{ margin: 0, fontSize: 26 }}>{event.name}</h1>
          <div className="muted tiny">{event.date} · {describe(formatOf(event))}</div>
          {roleOf(event) === 'admin' ? (
            <button className="btn block admin-entry" onClick={() => nav(`/event/${eventId}/admin`)}>
              <span>{t('Race admin')}</span>
              <span className="muted tiny">{t('Runners, heats, bibs and timers')}</span>
            </button>
          ) : (
            <div className="card muted" style={{ fontSize: 15 }}>
              {roleOf(event) === 'timer' && event.online.role
                ? t('You are a timer: the admin gives you your runners and starts the heats.')
                : t('Shared race: every phone with the timing link sees the same heats and laps.')}
            </div>
          )}
          {roleOf(event) === 'timer' && sync?.needName && <TimerCode eventId={eventId} token={event.online.token} hint={sync.needName} />}
          {timer && event.online.me && !sync?.needName && (
            <div className="card stack center" style={{ padding: 24 }}>
              <div className="display" style={{ fontSize: 22 }}>{t('You’re in, {name}', { name: event.online.me })}</div>
              <div className="muted">{t('The admin has not given you any runners yet. This screen moves on to your heat by itself as soon as they do.')}</div>
            </div>
          )}
          {heats.length > 0 && !timer && (
            <div className="list">
              {roleOf(event) === 'admin' && <h2 style={{ margin: '10px 0 0', fontSize: 16 }}>{t('Heats · you start and finish them')}</h2>}
              {heats.map((h) => (
                <button key={h.id} className={`btn block${h.status === 'running' ? ' primary' : ''}`}
                  onClick={() => nav(`/event/${eventId}/heat/${h.id}`)}>
                  {h.name} · {plural(runners.filter((r) => r.heatId === h.id).length, 'runner')}
                  {roleOf(event) === 'timer' && event.online.me && ` · ${t('{n} yours', { n: runners.filter((r) => r.heatId === h.id && r.timer === event.online.me).length })}`}
                  {h.status === 'running' ? ` · ${t('running')}` : h.status === 'done' ? ` · ${t('done')}` : ''}
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
          placeholder={t('Event name')}
          aria-label={t('Event name')}
        />
        <div className="row">
          <div className="grow">
            <label className="label">{t('Date')}</label>
            <input type="date" value={event.date} onChange={(e) => updateEvent(eventId, { date: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">{t('Event')}</label>
          <EventFormatEditor value={formatOf(event)} onSave={changeFormat} />
        </div>
      </div>
      )}

      {/* A shared race's start list and heats live in Race admin (admin) or
          are not a timer's concern: this part is for events on this phone. */}
      {!online && <>
      {/* --- Start list --- */}
      <div className="row" style={{ marginTop: 28, marginBottom: 12, alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          {t('Start list')} <span className="muted">· {runners.length}</span>
        </h2>
        <div className="spacer" />
        {runners.length > 0 && (
          <button className="btn ghost sm" onClick={() => setListOpen(!showList)} aria-expanded={showList}>
            {showList ? t('Hide') : t('Show all {n}', { n: runners.length })}
          </button>
        )}
      </div>

      {!online && runners.length === 0 && (
        <div className="card stack center" style={{ padding: 22, marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 20 }}>{t('Add your runners')}</div>
          <div className="muted" style={{ fontSize: 15 }}>
            {t('Import the start list from Excel or a CSV file, or paste it. You can also add runners one by one below.')}
          </div>
          <button className="btn primary block" onClick={() => setShowImport(true)}>
            {t('Import start list')}
          </button>
        </div>
      )}

      {!online && showList && <>
      <form className="row" onSubmit={quickAdd}>
        <input id="bibInput" style={{ width: 92 }} inputMode="numeric" placeholder={t('Bib')}
          value={bib} onChange={(e) => { setBib(e.target.value); setAddError('') }} />
        <input className="grow" placeholder={t('Name')} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className={`btn${runners.length ? ' primary' : ''}`}>{t('Add')}</button>
      </form>
      {addError && <div className="form-error" style={{ marginTop: 6 }}>{addError}</div>}

      {runners.length > 0 && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn ghost grow" onClick={() => setShowImport(true)}>
            {t('Import from file')}
          </button>
          <button className="btn ghost grow" onClick={() => setShowBibs(!showBibs)} aria-expanded={showBibs}>
            {t('Assign bibs')}
          </button>
        </div>
      )}
      {showBibs && runners.length > 0 && (
        <BibAssign eventId={eventId} runners={runners} onClose={() => setShowBibs(false)}
          onApply={(changes) => {
            const snap = assignBibs(eventId, changes)
            setShowBibs(false)
            offerUndo(t('New bibs for {n}', { n: plural(changes.length, 'runner') }), () => restoreEvent(snap))
          }} />
      )}
      </>}

      {importReport && (
        <div className="card stack" style={{ marginTop: 10 }}>
          <div>
            <strong>
              {t('Imported {n}.', { n: plural(importReport.added.length, 'runner') })}
            </strong>
            {importReport.duplicates.length > 0 && (
              <div className="form-error" style={{ marginTop: 6 }}>
                {t('Skipped {n} with a bib already in the list', { n: importReport.duplicates.length })}
                {' '}({importReport.duplicates.slice(0, 6).map((d) => d.bib).join(', ')}
                {importReport.duplicates.length > 6 ? '…' : ''}).
              </div>
            )}
            {importReport.missingBib.length > 0 && (
              <div className="form-error" style={{ marginTop: 6 }}>
                {t('Skipped {n} with no bib number.', { n: plural(importReport.missingBib.length, 'row') })}
              </div>
            )}
          </div>
          <button className="btn sm" onClick={() => setImportReport(null)}>{t('Dismiss')}</button>
        </div>
      )}

      {showImport && (
        <ImportDialog
          eventId={eventId}
          existingCount={runners.length}
          onClose={() => setShowImport(false)}
          onDone={(report) => {
            setImportReport(report)
            offerUndo(t('Imported {n}', { n: plural(report.added.length, 'runner') }), () => { restoreEvent(report.snap); setImportReport(null) })
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
              placeholder={t('Name')}
              aria-label={t('Name for bib {bib}', { bib: r.bib })}
            />
            {/* The heat is editable right here — picking one moves the runner.
                Previously this was read-only text, so an empty heat could never
                be filled and the only way to assign was a full re-split. */}
            <select
              className={`heat-select${r.heatId ? '' : ' unassigned'}`}
              value={r.heatId ?? ''}
              onChange={(e) => moveRunner(r, e.target.value || null)}
              disabled={online}
              aria-label={t('Heat for bib {bib}', { bib: r.bib })}
            >
              <option value="">{t('Unassigned')}</option>
              {heats.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            {!online && <button className="btn ghost danger row-remove" onClick={() => askRemove(r)} aria-label={t('Remove bib {bib}', { bib: r.bib })}>✕</button>}
          </div>
          {rowError?.id === r.id && <div className="row-error">{rowError.msg}</div>}
          </div>
        ))}
      </div>
      )}

      {/* --- Heats --- */}
      {(runners.length > 0 || heats.length > 0) && <>
      <h2 style={{ marginTop: 28, marginBottom: 4, fontSize: 16 }}>{t('Heats')}</h2>
      <p className="muted tiny" style={{ marginTop: 0 }}>
        {t('{a}/{n} runners assigned.', { a: assignedCount, n: runners.length })}{' '}
        {online
          ? t('Heats are set by the organiser.')
          : t('Auto-split spreads runners evenly over as few heats as fit, in bib order. Or set each runner’s heat in the start list. Tap a heat’s name to rename it.')}
      </p>

      {!online && (
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div style={{ width: 130 }}>
          <label className="label">{t('Runners / heat')}</label>
          <NumberField value={heatSize} min={1} max={60} onCommit={(n) => { setHeatSize(n); return true }} label={t('Runners per heat')} />
        </div>
        <button className={`btn${heats.length ? '' : ' primary'}`} onClick={split}>
          {heats.length ? t('Re-split') : t('Auto-split')}
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
        <button className="btn ghost block add-heat" onClick={() => createHeat(eventId)}>{t('+ Add a heat')}</button>
      )}
      {heats.length === 0 && (
        <div className="empty">
          <div className="display">{t('No heats yet')}</div>
          {t('Auto-split to create them automatically, or add an empty heat and assign runners to it from the start list.')}
        </div>
      )}
      </>}
      </>}

      {confirmNode}
      {undoNode}
      <div style={{ height: 24 }} />
    </div>
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
    if (!b) { onDone(t('Every runner needs a bib, so {bib} was kept.', { bib: runner.bib })); return }
    const owner = bibOwner(getState(), eventId, b, runner.id)
    if (owner) { onDone(t('Bib {bib} already belongs to {name}, so {old} was kept.', { bib: b, name: owner.name || t('another runner'), old: runner.bib })); return }
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
      aria-label={t('Bib for {name}', { name: runner.name || t('runner') })}
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
          aria-label={t('Heat name')}
        />
        <span className={`pill ${state}`}>{t(heat.status)}</span>
      </div>
      <div className="muted tiny" style={{ marginTop: -4 }}>
        {inHeat.length === 0
          ? t('No runners yet: assign them in the start list above.')
          : `${plural(inHeat.length, 'runner')} · ${plural(crossings, 'crossing')}`}
      </div>
      {inHeat.length > 0 && (
        <div className="heat-bibs">{inHeat.map((r) => r.bib).join(' · ')}</div>
      )}
      <button className="btn primary block" onClick={onTime} disabled={inHeat.length === 0}>
        {heat.status === 'pending' ? t('Open timing') : heat.status === 'running' ? t('Resume timing') : t('Review timing')}
      </button>
      {/* Deliberately low-weight: destructive, and sits on every heat card. */}
      {!online && (
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          className="btn ghost danger sm"
          onClick={() =>
            askConfirm({
              title: t('Delete {name}?', { name: heat.name }),
              body: crossings
                ? t('Its runners become unassigned and the {n} recorded in it are cleared. You can undo it straight after.', { n: plural(crossings, 'lap') })
                : t('Its runners become unassigned. You can undo it straight after.'),
              confirmLabel: t('Delete heat'),
              danger: true,
              onConfirm: () => {
                const snap = deleteHeat(heat.id)
                offerUndo(t('Deleted {name}', { name: heat.name }), () => restoreEvent(snap))
              },
            })
          }
        >
          {t('Delete heat')}
        </button>
      </div>
      )}
    </div>
  )
}

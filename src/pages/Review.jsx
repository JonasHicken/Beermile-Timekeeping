import { useState } from 'react'
import TimeInput from '../components/TimeInput.jsx'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  useStore, getEvent, getHeat, runnersInHeat, allCrossingsInHeat,
  setCrossingVoid, reassignCrossing, setCrossingTime, dedupeCrossings, roleOf, canTime,
} from '../lib/store.js'
import { useOnlineSync } from '../lib/online.js'
import { fmt } from '../lib/time.js'

// Chronological crossing log for one heat. This is the accuracy backstop:
// Undo only reaches the newest crossing, but a mistap spotted ten minutes
// later has to be fixable too — here you can void, restore, reassign to the
// right runner, or correct the timestamp.
const REJECTED = {
  'too-soon': 'too soon to be a lap',
  duplicate: 'second tap within 15 s',
  finished: 'after the runner finished',
  'other-timer': 'already tapped by another timer',
}

export default function Review() {
  const { eventId, heatId } = useParams()
  const nav = useNavigate()
  const event = useStore((s) => getEvent(s, eventId))
  const heat = useStore((s) => getHeat(s, heatId))
  const runners = useStore((s) => runnersInHeat(s, heatId))
  const crossings = useStore((s) => allCrossingsInHeat(s, heatId))
  const [editing, setEditing] = useState(null)
  useOnlineSync(eventId, Boolean(event?.online))

  if (!event || !heat) {
    return (
      <div className="app">
        <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>
        <div className="empty">Heat not found.</div>
      </div>
    )
  }

  const runnerById = Object.fromEntries(runners.map((r) => [r.id, r]))
  // A timer on a shared race corrects only their own runners' laps: the
  // server ignores a timer's change to anyone else's, so offering it would
  // only show a correction that quietly springs back.
  const timer = roleOf(event) === 'timer' && Boolean(event.online?.role)
  const mine = (runnerId) => !timer || (runnerById[runnerId] && canTime(event, runnerById[runnerId]))
  const editable = runners.filter((r) => mine(r.id))

  // Lap ordinals are derived here, not read from the stored `lap`, so voiding
  // a crossing renumbers everything after it for that runner.
  // A second tap for the same runner within the duplicate window (two phones
  // tapping the same crossing) is shown, but does not count as a lap.
  const counted = new Set(dedupeCrossings(crossings.filter((c) => !c.void)).map((c) => c.id))
  const ordinals = {}
  const counters = {}
  for (const c of crossings) {
    if (!counted.has(c.id)) continue
    counters[c.runnerId] = (counters[c.runnerId] || 0) + 1
    ordinals[c.id] = counters[c.runnerId]
  }

  const liveCount = counted.size

  return (
    <div className="app">
      <div className="topbar">
        <Link to={`/event/${eventId}/heat/${heatId}`} className="backlink">← Timing</Link>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => nav(`/event/${eventId}/live`)}>Results</button>
      </div>

      <h1 style={{ margin: 0, fontSize: 26 }}>Review · {heat.name}</h1>
      <div className="muted tiny" style={{ textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 6 }}>
        {liveCount} crossings · tap a row to correct it
      </div>

      {crossings.length === 0 && (
        <div className="empty">
          <div className="display">Nothing logged yet</div>
          Crossings recorded in this heat will appear here.
        </div>
      )}

      <div className="list" style={{ marginTop: 18 }}>
        {crossings.map((c) => {
          const runner = runnerById[c.runnerId]
          const isEditing = editing === c.id && mine(c.runnerId)
          return (
            <div className={`log-row${c.void ? ' voided' : ''}`} key={c.id}>
              <div className="row" onClick={() => mine(c.runnerId) && setEditing(isEditing ? null : c.id)} style={{ cursor: mine(c.runnerId) ? 'pointer' : 'default' }}>
                <span className="log-time">{fmt(c.capturedAt - heat.startedAt)}</span>
                <span className="bib">{runner?.bib ?? '?'}</span>
                <span className="grow">
                  <span className="log-name">{runner?.name || '—'}</span>
                  {!c.void && (counted.has(c.id)
                    ? <span className="muted tiny"> · lap {ordinals[c.id]}</span>
                    : <span className="muted tiny"> · duplicate, not counted</span>)}
                  {c.void && c.rejected && (
                    <span className="muted tiny">
                      {' · '}{REJECTED[c.rejected] ?? 'held back'}, not counted
                    </span>
                  )}
                </span>
                <span className={`src src-${c.source}`}>{c.source}</span>
              </div>

              {isEditing && (
                <div className="log-edit stack">
                  <div>
                    <span className="label">Belongs to</span>
                    <select
                      value={c.runnerId}
                      onChange={(e) => reassignCrossing(c.id, e.target.value)}
                    >
                      {editable.map((r) => (
                        <option key={r.id} value={r.id}>{r.bib} · {r.name || '—'}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="label">Time since the start</span>
                    <TimeInput
                      key={c.capturedAt}
                      initialMs={c.capturedAt - heat.startedAt}
                      onSubmit={(ms) => setCrossingTime(c.id, heat.startedAt + ms)}
                    />
                  </div>
                  <div className="row">
                    {c.void ? (
                      <button className="btn grow" onClick={() => setCrossingVoid(c.id, false)}>
                        {c.rejected ? 'Count this tap' : 'Restore crossing'}
                      </button>
                    ) : (
                      <button className="btn danger grow" onClick={() => setCrossingVoid(c.id, true)}>
                        Void crossing
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => setEditing(null)}>Done</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ height: 24 }} />
    </div>
  )
}

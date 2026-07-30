import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  useStore, getEvent, getHeat, runnersInHeat, crossingsInHeat,
  startHeat, finishHeat, resetHeat, recordCrossing, undoLastCrossing,
} from '../lib/store.js'
import { fmt } from '../lib/time.js'

export default function Timing() {
  const { eventId, heatId } = useParams()
  const nav = useNavigate()
  const event = useStore((s) => getEvent(s, eventId))
  const heat = useStore((s) => getHeat(s, heatId))
  const runners = useStore((s) => runnersInHeat(s, heatId))
  const crossings = useStore((s) => crossingsInHeat(s, heatId))

  const [flashId, setFlashId] = useState(null)
  const [toast, setToast] = useState(null)
  const wakeRef = useRef(null)

  const running = heat?.status === 'running'

  // Keep the screen awake while timing.
  useEffect(() => {
    if (!running) return
    let released = false
    async function acquire() {
      try {
        wakeRef.current = await navigator.wakeLock?.request('screen')
      } catch { /* not supported / denied — fine */ }
    }
    acquire()
    const onVis = () => { if (document.visibilityState === 'visible' && !released) acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVis)
      wakeRef.current?.release?.().catch(() => {})
      wakeRef.current = null
    }
  }, [running])

  if (!event || !heat) {
    return (
      <div className="app">
        <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>
        <div className="empty">Heat not found.</div>
      </div>
    )
  }

  // lapsDone per runner
  const counts = {}
  for (const c of crossings) counts[c.runnerId] = (counts[c.runnerId] || 0) + 1
  const finishedCount = runners.filter((r) => (counts[r.id] || 0) >= event.numLaps).length

  function showToast(msg) {
    setToast(msg)
    clearTimeout(showToast._t)
    showToast._t = setTimeout(() => setToast(null), 1400)
  }

  function tap(runner) {
    if (!running) return
    const done = counts[runner.id] || 0
    if (done >= event.numLaps) { showToast(`${runner.bib} already finished`); return }
    const c = recordCrossing(heatId, runner.id, 'tap')
    if (!c) return
    setFlashId(runner.id)
    setTimeout(() => setFlashId((id) => (id === runner.id ? null : id)), 220)
    if (navigator.vibrate) navigator.vibrate(15)
    const nowDone = done + 1
    showToast(nowDone >= event.numLaps ? `${runner.bib} FINISHED` : `${runner.bib} · lap ${nowDone}`)
  }

  function undo() {
    const last = undoLastCrossing(heatId)
    if (last) { showToast(`Undo ${last.bib} · lap ${last.lap}`); if (navigator.vibrate) navigator.vibrate([10, 40, 10]) }
    else showToast('Nothing to undo')
  }

  return (
    <div className="app">
      <div className="topbar">
        <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => nav(`/event/${eventId}/live`)}>Results</button>
      </div>

      <div className="row" style={{ alignItems: 'baseline' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{heat.name}</h1>
        <span className="muted">· {finishedCount}/{runners.length} done</span>
        <div className="spacer" />
        {running && <HeatClock startedAt={heat.startedAt} />}
      </div>

      {runners.length === 0 && (
        <div className="empty">No runners in this heat. Assign some in Setup.</div>
      )}

      {heat.status === 'pending' && runners.length > 0 && (
        <div className="card stack center" style={{ marginTop: 24 }}>
          <div className="muted">Mass start — tap when the gun goes.</div>
          <button className="btn primary lg block" onClick={() => startHeat(heatId)}>
            ▶ START HEAT
          </button>
        </div>
      )}

      {(running || heat.status === 'done') && (
        <>
          <div className="grid" style={{ marginTop: 16 }}>
            {runners.map((r) => {
              const done = counts[r.id] || 0
              const finished = done >= event.numLaps
              return (
                <RunnerTile
                  key={r.id}
                  runner={r}
                  done={done}
                  laps={event.numLaps}
                  finished={finished}
                  flash={flashId === r.id}
                  elapsed={finished ? finishElapsed(crossings, r.id, event.numLaps, heat.startedAt) : null}
                  disabled={!running}
                  onTap={() => tap(r)}
                />
              )
            })}
          </div>

          {running && (
            <div className="actionbar">
              <button className="btn danger grow lg" onClick={undo}>↶ Undo</button>
              <button className="btn grow lg"
                onClick={() => { if (confirm('Finish this heat? You can still review and edit results.')) finishHeat(heatId) }}>
                Finish heat
              </button>
            </div>
          )}

          {heat.status === 'done' && (
            <div className="actionbar">
              <button className="btn ghost grow" onClick={() => { if (confirm('Reset this heat? Clears all timing for it.')) resetHeat(heatId) }}>
                Reset heat
              </button>
              <button className="btn primary grow" onClick={() => nav(`/event/${eventId}/live`)}>
                View results
              </button>
            </div>
          )}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function finishElapsed(crossings, runnerId, numLaps, startedAt) {
  const cs = crossings.filter((c) => c.runnerId === runnerId).sort((a, b) => a.capturedAt - b.capturedAt)
  if (cs.length < numLaps || startedAt == null) return null
  return cs[numLaps - 1].capturedAt - startedAt
}

function HeatClock({ startedAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])
  return <span className="clock" style={{ fontSize: 22 }}>{fmt(now - startedAt)}</span>
}

function RunnerTile({ runner, done, laps, finished, flash, elapsed, disabled, onTap }) {
  return (
    <button
      className={`tile${flash ? ' flash' : ''}${finished ? ' done' : ''}`}
      onClick={onTap}
      disabled={disabled && !finished}
    >
      {finished && <span className="t-time">{fmt(elapsed)}</span>}
      <div>
        <div className="t-bib">{runner.bib}</div>
        <div className="t-name">{runner.name || ' '}</div>
      </div>
      <div className="t-laps">
        {Array.from({ length: laps }).map((_, i) => (
          <span key={i} className={`lap-dot${i < done ? ' on' : ''}`} />
        ))}
      </div>
    </button>
  )
}

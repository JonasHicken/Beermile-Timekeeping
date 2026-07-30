import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  useStore, getEvent, getHeat, runnersInHeat, crossingsInHeat, heatsInEvent,
  startHeat, finishHeat, resetHeat, recordCrossing, undoLastCrossing,
  requiredLaps, statusOf,
} from '../lib/store.js'
import { fmt } from '../lib/time.js'
import RunnerSheet from '../components/RunnerSheet.jsx'

export default function Timing() {
  const { eventId, heatId } = useParams()
  const nav = useNavigate()
  const event = useStore((s) => getEvent(s, eventId))
  const heat = useStore((s) => getHeat(s, heatId))
  const heats = useStore((s) => heatsInEvent(s, eventId))
  const runners = useStore((s) => runnersInHeat(s, heatId))
  const crossings = useStore((s) => crossingsInHeat(s, heatId))

  const [flashId, setFlashId] = useState(null)
  const [toast, setToast] = useState(null)
  const [sheetRunner, setSheetRunner] = useState(null)
  const [hideFinished, setHideFinished] = useState(false)
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

  const counts = {}
  for (const c of crossings) counts[c.runnerId] = (counts[c.runnerId] || 0) + 1

  const rows = runners.map((r) => {
    const need = requiredLaps(event, r)
    const done = counts[r.id] || 0
    const st = statusOf(r)
    return {
      runner: r,
      need,
      done,
      status: st,
      finished: st === 'ok' && done >= need,
      out: st !== 'ok',
    }
  })
  const finishedCount = rows.filter((x) => x.finished).length
  const visible = hideFinished ? rows.filter((x) => !x.finished && !x.out) : rows

  function showToast(msg) {
    setToast(msg)
    clearTimeout(showToast._t)
    showToast._t = setTimeout(() => setToast(null), 1400)
  }

  function tap(row) {
    if (!running) return
    if (row.out) { showToast(`${row.runner.bib} is ${row.status.toUpperCase()}`); return }
    if (row.done >= row.need) { showToast(`${row.runner.bib} already finished`); return }
    const c = recordCrossing(heatId, row.runner.id, 'tap')
    if (!c) return
    setFlashId(row.runner.id)
    setTimeout(() => setFlashId((id) => (id === row.runner.id ? null : id)), 220)
    if (navigator.vibrate) navigator.vibrate(15)
    const nowDone = row.done + 1
    showToast(nowDone >= row.need ? `${row.runner.bib} FINISHED` : `${row.runner.bib} · lap ${nowDone}`)
  }

  function undo() {
    const last = undoLastCrossing(heatId)
    if (last) {
      showToast(`Undo ${last.bib} · lap ${last.lap}`)
      if (navigator.vibrate) navigator.vibrate([10, 40, 10])
    } else showToast('Nothing to undo')
  }

  return (
    <div className="app">
      <div className="topbar">
        <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => nav(`/event/${eventId}/heat/${heatId}/review`)}>Review</button>
        <button className="btn ghost" onClick={() => nav(`/event/${eventId}/live`)}>Results</button>
      </div>

      {/* heat switcher — jump between heats without going back to Setup */}
      {heats.length > 1 && (
        <div className="chips">
          {heats.map((h) => (
            <button
              key={h.id}
              className={`chip${h.id === heatId ? ' on' : ''}`}
              onClick={() => nav(`/event/${eventId}/heat/${h.id}`)}
            >
              {h.name}
              {h.status === 'running' && <span className="chip-dot" />}
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ alignItems: 'baseline', marginTop: 4 }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>{heat.name}</h1>
        <span className="muted tiny">{finishedCount}/{runners.length} done</span>
        <div className="spacer" />
        {running && <HeatClock startedAt={heat.startedAt} />}
      </div>

      {runners.length === 0 && (
        <div className="empty">
          <div className="display">Empty heat</div>
          Assign runners to it in Setup.
        </div>
      )}

      {heat.status === 'pending' && runners.length > 0 && (
        <div className="card stack center" style={{ marginTop: 24, padding: 28 }}>
          <div className="display" style={{ fontSize: 22 }}>{runners.length} on the line</div>
          <div className="muted">Mass start — tap when the gun goes.</div>
          <button className="btn primary lg block" onClick={() => startHeat(heatId)}>
            ▶ Start heat
          </button>
        </div>
      )}

      {(running || heat.status === 'done') && (
        <>
          {finishedCount > 0 && (
            <button className="toggle" onClick={() => setHideFinished((v) => !v)}>
              <span className={`toggle-box${hideFinished ? ' on' : ''}`} />
              Hide finished ({finishedCount})
            </button>
          )}

          <div className="grid" style={{ marginTop: 14 }}>
            {visible.map((row) => (
              <RunnerTile
                key={row.runner.id}
                row={row}
                flash={flashId === row.runner.id}
                elapsed={row.finished ? finishElapsed(crossings, row.runner.id, row.need, heat.startedAt) : null}
                disabled={!running}
                onTap={() => tap(row)}
                onDetail={() => setSheetRunner(row.runner.id)}
              />
            ))}
          </div>

          {running && (
            <div className="actionbar">
              <button className="btn danger grow lg" onClick={undo}>↶ Undo</button>
              <button
                className="btn grow lg"
                onClick={() => { if (confirm('Finish this heat? You can still review and correct it.')) finishHeat(heatId) }}
              >
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

      {sheetRunner && (
        <RunnerSheet
          eventId={eventId}
          heatId={heatId}
          runnerId={sheetRunner}
          onClose={() => setSheetRunner(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function finishElapsed(crossings, runnerId, need, startedAt) {
  const cs = crossings.filter((c) => c.runnerId === runnerId).sort((a, b) => a.capturedAt - b.capturedAt)
  if (cs.length < need || startedAt == null) return null
  return cs[need - 1].capturedAt - startedAt
}

function HeatClock({ startedAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])
  return <span className="clock" style={{ fontSize: 26 }}>{fmt(now - startedAt)}</span>
}

function RunnerTile({ row, flash, elapsed, disabled, onTap, onDetail }) {
  const { runner, need, done, finished, out, status } = row
  return (
    <div
      className={`tile${flash ? ' flash' : ''}${finished ? ' done' : ''}${out ? ' out' : ''}`}
      onClick={onTap}
      role="button"
      tabIndex={disabled && !finished ? -1 : 0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap() } }}
      aria-disabled={disabled && !finished}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
        <span className="t-bib grow">{runner.bib}</span>
        <button
          className="t-more"
          onClick={(e) => { e.stopPropagation(); onDetail() }}
          aria-label={`Options for ${runner.bib}`}
        >
          ⋯
        </button>
      </div>
      <div className="t-name">{runner.name || ' '}</div>

      {out ? (
        <div className="t-status">{status.toUpperCase()}</div>
      ) : finished ? (
        <div className="t-final">{fmt(elapsed)}</div>
      ) : (
        <div className="t-laps">
          {Array.from({ length: need }).map((_, i) => (
            <span key={i} className={`lap-dot${i < done ? ' on' : ''}`} />
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect } from 'react'
import {
  useStore, runnerResult, getEvent, getHeat, getRunner,
  STATUSES, statusOf, penaltyOf,
  setRunnerStatus, setPenaltyLaps, setCrossingVoid, recordCrossing,
} from '../lib/store.js'
import { fmt, fmtShort } from '../lib/time.js'

// Bottom sheet for one runner: fix their laps, mark a status, add a penalty.
// Opened from the tile's "⋯" button, which stops propagation so opening it can
// never be mistaken for a crossing tap.
export default function RunnerSheet({ eventId, heatId, runnerId, onClose }) {
  const event = useStore((s) => getEvent(s, eventId))
  const heat = useStore((s) => getHeat(s, heatId))
  const runner = useStore((s) => getRunner(s, runnerId))
  const result = useStore((s) =>
    event && heat && runner ? runnerResult(s, event, heat, runner) : null,
  )

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!runner || !result) return null

  const status = statusOf(runner)
  const penalty = penaltyOf(runner)

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={`Runner ${runner.bib}`}>
        <div className="sheet-grip" />

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="display" style={{ fontSize: 30 }}>
              <span style={{ color: 'var(--amber)' }}>{runner.bib}</span> {runner.name}
            </div>
            <div className="muted tiny" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>
              {heat.name} · {result.lapsDone}/{result.requiredLaps} laps
              {result.finished && ` · ${fmt(result.elapsed)}`}
            </div>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* status */}
        <div style={{ marginTop: 18 }}>
          <span className="label">Status</span>
          <div className="seg">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                className={`seg-btn${status === s.key ? ' on' : ''}`}
                onClick={() => setRunnerStatus(runner.id, s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* penalty laps */}
        <div style={{ marginTop: 16 }}>
          <span className="label">Penalty laps</span>
          <div className="row">
            <button className="btn" onClick={() => setPenaltyLaps(runner.id, penalty - 1)} disabled={penalty === 0}>−</button>
            <div className="grow center">
              <div className="display" style={{ fontSize: 26 }}>{penalty}</div>
              <div className="muted tiny">
                {penalty === 0 ? 'None' : `Must run ${result.requiredLaps} laps total`}
              </div>
            </div>
            <button className="btn" onClick={() => setPenaltyLaps(runner.id, penalty + 1)}>+</button>
          </div>
        </div>

        {/* laps */}
        <div style={{ marginTop: 18 }}>
          <span className="label">Laps</span>
          {result.laps.length === 0 && <div className="muted tiny">No crossings recorded yet.</div>}
          <div className="list">
            {result.laps.map((l) => (
              <div className="item" key={l.id}>
                <span className="bib">L{l.lap}</span>
                <span className="grow">
                  <strong>{fmtShort(l.split)}</strong>
                  <span className="muted tiny"> split · {fmt(l.at - heat.startedAt)} elapsed</span>
                </span>
                <button
                  className="btn ghost danger"
                  onClick={() => setCrossingVoid(l.id, true)}
                  aria-label={`Remove lap ${l.lap}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {heat.startedAt != null && result.lapsDone < result.requiredLaps && (
            <button
              className="btn block"
              style={{ marginTop: 10 }}
              onClick={() => recordCrossing(heatId, runner.id, 'manual')}
            >
              + Add lap at current time
            </button>
          )}
        </div>

        <div style={{ height: 8 }} />
      </div>
    </>
  )
}

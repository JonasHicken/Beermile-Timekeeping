import { t } from '../lib/i18n.js'
import { formatOf } from '../lib/eventFormat.js'
import { useEffect, useState } from 'react'
import {
  useStore, runnerResult, getEvent, getHeat, getRunner,
  STATUSES, statusOf, penaltyOf, roleOf,
  setRunnerStatus, setPenaltyLaps, setCrossingVoid, recordCrossing, addLapAt,
} from '../lib/store.js'
import { fmt, fmtShort } from '../lib/time.js'
import TimeInput from './TimeInput.jsx'

// Bottom sheet for one runner: fix their laps, mark a status, add a penalty.
// Opened from the tile's "⋯" button, which stops propagation so opening it can
// never be mistaken for a crossing tap.
export default function RunnerSheet({ eventId, heatId, runnerId, onClose, offerUndo }) {
  const [addingAt, setAddingAt] = useState(false)
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
  // A timer at a timing point taps everyone, but a runner's status and penalty
  // laps belong to the admin and the runner's own timer (the server refuses
  // anyone else), so they are not offered here.
  const canChange = roleOf(event) !== 'timer' || (Boolean(runner.timer) && runner.timer === event.online?.me)

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={`${t('Runner')} ${runner.bib}`}>
        <div className="sheet-grip" />

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="display" style={{ fontSize: 30 }}>
              <span style={{ color: 'var(--amber)' }}>{runner.bib}</span> {runner.name}
            </div>
            <div className="muted tiny" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>
              {heat.name} · {result.lapsDone}/{result.requiredLaps} {t('laps')}
              {result.finished && ` · ${fmt(result.elapsed)}`}
            </div>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label={t('Close')}>✕</button>
        </div>

        {!canChange && <div className="muted tiny" style={{ marginTop: 14 }}>{t('Status and penalty laps are set by the admin or this runner’s own timer.')}</div>}

        {/* status */}
        {canChange && <div style={{ marginTop: 18 }}>
          <span className="label">{t('Status')}</span>
          <div className="seg">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                className={`seg-btn${status === s.key ? ' on' : ''}`}
                onClick={() => setRunnerStatus(runner.id, s.key)}
              >
                {t(s.label)}
              </button>
            ))}
          </div>
        </div>}

        {/* penalty laps: a beer mile's, not a track race's */}
        {canChange && formatOf(event).penalties && <div style={{ marginTop: 16 }}>
          <span className="label">{t('Penalty laps')}</span>
          <div className="row">
            <button className="btn" onClick={() => setPenaltyLaps(runner.id, penalty - 1)} disabled={penalty === 0}>−</button>
            <div className="grow center">
              <div className="display" style={{ fontSize: 26 }}>{penalty}</div>
              <div className="muted tiny">
                {penalty === 0 ? t('None') : t('Must run {n} laps total', { n: result.requiredLaps })}
              </div>
            </div>
            <button className="btn" onClick={() => setPenaltyLaps(runner.id, penalty + 1)}>+</button>
          </div>
        </div>}

        {/* laps */}
        <div style={{ marginTop: 18 }}>
          <span className="label">{t('Laps')}</span>
          {result.laps.length === 0 && <div className="muted tiny">{t('No crossings recorded yet.')}</div>}
          <div className="list">
            {result.laps.map((l) => (
              <div className="item" key={l.id}>
                <span className="bib">L{l.lap}</span>
                <span className="grow">
                  <strong>{fmtShort(l.split)}</strong>
                  <span className="muted tiny"> {t('split')} · {fmt(l.at - heat.startedAt)} {t('elapsed')}</span>
                </span>
                <button
                  className="btn ghost danger"
                  onClick={() => {
                    setCrossingVoid(l.id, true)
                    offerUndo?.(t('Removed lap {lap} for {bib}', { lap: l.lap, bib: runner.bib }), () => setCrossingVoid(l.id, false))
                  }}
                  aria-label={t('Remove lap {lap}', { lap: l.lap })}
                >
                  {t('Remove')}
                </button>
              </div>
            ))}
          </div>
          {/* "Now" only makes sense while the heat is running: on a finished
              heat it stamped whatever time it was pressed, maybe half an hour
              after the race. A missed lap is added at the time it happened. */}
          {heat.startedAt != null && result.lapsDone < result.requiredLaps && (
            <div className="stack" style={{ marginTop: 10, gap: 8 }}>
              {heat.status === 'running' && (
                <button
                  className="btn block"
                  onClick={() => recordCrossing(heatId, runner.id, 'manual', undefined, { force: true })}
                >
                  {t('+ Add lap now')}
                </button>
              )}
              {addingAt ? (
                <div>
                  <span className="label">Missed lap at (time since the start)</span>
                  <TimeInput
                    submitLabel="Add"
                    onSubmit={(ms) => {
                      const r = addLapAt(heatId, runner.id, heat.startedAt + ms)
                      if (r.error) return r.error
                      setAddingAt(false)
                    }}
                  />
                </div>
              ) : (
                <button className="btn ghost block" onClick={() => setAddingAt(true)}>
                  {t('+ Add a missed lap at a time…')}
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ height: 8 }} />
      </div>
    </>
  )
}

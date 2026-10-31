import { useState } from 'react'
import { planTimers } from '../lib/heats.js'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Giving the runners to timers in one go: pick which timers take part and the
// most runners one timer can watch, and every heat that has not started is
// shared between them (lib/heats.js planTimers). The preview is exactly what
// Assign saves. Remembered per race on this phone.
const KEY = (eventId) => `bmtk:timerplan:${eventId}`
function load(eventId) {
  try { return JSON.parse(localStorage.getItem(KEY(eventId)) || 'null') } catch { return null }
}

// heats: [{ id, name, runners }] for the heats that have not started.
// onApply(runners, assignment, label) saves it and offers Undo.
export default function TimerAutoAssign({ eventId, timers, heats, busy, onApply }) {
  const saved = load(eventId)
  const [off, setOff] = useState(() => new Set(saved?.off ?? [])) // timers left out
  const [max, setMax] = useState(saved?.max ?? 8)
  const chosen = timers.filter((t) => !off.has(t))
  const plan = chosen.length ? planTimers(heats, chosen, max) : []
  const left = plan.reduce((n, p) => n + p.left, 0)

  function remember(next) {
    try { localStorage.setItem(KEY(eventId), JSON.stringify({ off: [...(next.off ?? off)], max: next.max ?? max })) } catch { /* not remembered */ }
  }
  function toggle(t) {
    const next = new Set(off)
    if (next.has(t)) next.delete(t); else next.add(t)
    setOff(next); remember({ off: next })
  }

  function apply() {
    const all = heats.flatMap((h) => h.runners)
    const assignment = plan.flatMap((p) => p.split.map((x) => ({ runner_id: x.runner.id, tidtaker: x.timer })))
    onApply(all, assignment, `Timers for ${plural(heats.length, 'heat')}`)
  }

  if (!heats.length) return null
  return (
    <div className="card stack" style={{ gap: 10, marginTop: 10 }}>
      <strong>Give runners to timers automatically</strong>
      <div className="muted tiny">Tap the timers who take part. Each heat that has not started is shared between them.</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {timers.map((t) => (
          <button key={t} type="button" className={`chip${off.has(t) ? '' : ' on'}`} aria-pressed={!off.has(t)} onClick={() => toggle(t)}>{t}</button>
        ))}
      </div>
      <label className="row" style={{ gap: 8 }}>
        Max runners per timer
        <input type="number" min="1" max="40" inputMode="numeric" value={max} style={{ width: 70 }}
          onChange={(e) => { setMax(e.target.value); remember({ max: e.target.value }) }} />
      </label>

      {chosen.length === 0 ? (
        <div className="form-error">Choose at least one timer.</div>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          {plan.map((p, i) => {
            const counts = chosen.map((t) => [t, p.split.filter((x) => x.timer === t).length]).filter(([, n]) => n)
            return (
              <div key={p.id} className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                <strong style={{ minWidth: 64 }}>{heats[i].name}</strong>
                <span className="muted grow">
                  {counts.map(([t, n]) => `${t} ${n}`).join(' · ') || 'no runners'}
                  {p.left > 0 && <span style={{ color: 'var(--red)' }}> · {p.left} without a timer</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {left > 0 && (
        <div className="muted tiny" style={{ color: 'var(--red)' }}>
          {plural(left, 'runner')} would have no timer, so only you could time them. Choose more timers or raise the max.
        </div>
      )}
      <button className="btn primary" disabled={busy || chosen.length === 0} onClick={apply}>
        Assign to {plural(heats.length, 'heat')}
      </button>
      <div className="muted tiny">Heats that have started keep their timers. You can still change one runner’s timer in the start list.</div>
    </div>
  )
}

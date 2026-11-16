import { t, plural } from '../lib/i18n.js'
import { useState } from 'react'
import { planTimers } from '../lib/heats.js'


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
  const chosen = timers.filter((name) => !off.has(name))
  const plan = chosen.length ? planTimers(heats, chosen, max) : []
  const left = plan.reduce((n, p) => n + p.left, 0)

  function remember(next) {
    try { localStorage.setItem(KEY(eventId), JSON.stringify({ off: [...(next.off ?? off)], max: next.max ?? max })) } catch { /* not remembered */ }
  }
  function toggle(name) {
    const next = new Set(off)
    if (next.has(name)) next.delete(name); else next.add(name)
    setOff(next); remember({ off: next })
  }

  function apply() {
    const all = heats.flatMap((h) => h.runners)
    const assignment = plan.flatMap((p) => p.split.map((x) => ({ runner_id: x.runner.id, tidtaker: x.timer })))
    onApply(all, assignment, t('Timers for {heats}', { heats: plural(heats.length, 'heat') }))
  }

  if (!heats.length) return null
  return (
    <div className="card stack" style={{ gap: 10, marginTop: 10 }}>
      <strong>{t('Give runners to timers automatically')}</strong>
      <div className="muted tiny">{t('Tap the timers who take part. Each heat that has not started is shared between them.')}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {timers.map((name) => (
          <button key={name} type="button" className={`chip${off.has(name) ? '' : ' on'}`} aria-pressed={!off.has(name)} onClick={() => toggle(name)}>{name}</button>
        ))}
      </div>
      <label className="row" style={{ gap: 8 }}>
        {t('Max runners per timer')}
        <input type="number" min="1" max="40" inputMode="numeric" value={max} style={{ width: 70 }}
          onChange={(e) => { setMax(e.target.value); remember({ max: e.target.value }) }} />
      </label>

      {chosen.length === 0 ? (
        <div className="form-error">{t('Choose at least one timer.')}</div>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          {plan.map((p, i) => {
            const counts = chosen.map((name) => [name, p.split.filter((x) => x.timer === name).length]).filter(([, n]) => n)
            return (
              <div key={p.id} className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                <strong style={{ minWidth: 64 }}>{heats[i].name}</strong>
                <span className="muted grow">
                  {counts.map(([nm, n]) => `${nm} ${n}`).join(' · ') || t('no runners')}
                  {p.left > 0 && <span style={{ color: 'var(--red)' }}> · {t('{n} without a timer', { n: p.left })}</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {left > 0 && (
        <div className="muted tiny" style={{ color: 'var(--red)' }}>
          {t('{n} would have no timer, so only you could time them. Choose more timers or raise the max.', { n: plural(left, 'runner') })}
        </div>
      )}
      <button className="btn primary" disabled={busy || chosen.length === 0} onClick={apply}>
        {t('Assign to {n}', { n: plural(heats.length, 'heat') })}
      </button>
      <div className="muted tiny">{t('Heats that have started keep their timers. You can still change one runner’s timer in the start list.')}</div>
    </div>
  )
}

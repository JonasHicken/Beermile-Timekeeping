import { t } from '../lib/i18n.js'
import { useEffect, useState } from 'react'
import { KINDS, presetFormat, normalise, parsePoints, describe, isBeermile, sameFormat } from '../lib/eventFormat.js'

// Choosing what is timed. A preset fills in the timing points for its
// distance (a tap each time past the line on a 400 m track); everything can
// then be changed: the distance, the lap length, finish only, or the exact
// points. Nothing is saved until Save, so a half-made change never reaches
// the timers.
//   value    the race's format now
//   onSave   (format) -> saves; may return false to keep the editor open
//   compact  no Save button: every change goes straight to onSave (new race form)
export default function EventFormatEditor({ value, onSave, busy, compact = false }) {
  const [draft, setDraft] = useState(value)
  const [pointsText, setPointsText] = useState(value.points.join(', '))
  const [error, setError] = useState('')
  useEffect(() => { setDraft(value); setPointsText(value.points.join(', ')); setError('') }, [value])

  function change(next) {
    const f = normalise(next)
    // The boxes keep what is typed (an empty box while retyping a number);
    // the points are worked out from the numbers it makes.
    setDraft(next.mode === 'points' ? f : { ...f, distance: next.distance, lapLength: next.lapLength })
    setPointsText(f.points.join(', '))
    setError('')
    if (compact) onSave(f)
  }
  function pick(kind) { change(presetFormat(kind)) }
  function setPoints(text) {
    setPointsText(text)
    const res = parsePoints(text)
    if (res.error) { setError(res.error); return }
    setError('')
    const f = normalise({ ...draft, mode: 'points', points: res.points })
    setDraft(f)
    if (compact) onSave(f)
  }

  const beermile = isBeermile(draft)
  const changed = !sameFormat(draft, value)

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="chips" style={{ flexWrap: 'wrap' }} role="radiogroup" aria-label={t('Event')}>
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={draft.kind === k.id}
            className={`chip${draft.kind === k.id ? ' on' : ''}`} disabled={busy} onClick={() => pick(k.id)}>
            {t(k.label)}
          </button>
        ))}
      </div>

      {beermile ? (
        <label className="row" style={{ gap: 10 }}>
          <span className="grow">{t('Laps of {m} m', { m: draft.lapLength })}</span>
          <input type="number" inputMode="numeric" min="1" max="40" style={{ width: 80 }} disabled={busy}
            value={draft.points.length}
            onChange={(e) => change({ ...draft, mode: 'laps', distance: Math.max(1, Number(e.target.value) || 1) * draft.lapLength })} />
        </label>
      ) : (
        <>
          <div className="row" style={{ gap: 10 }}>
            <label className="stack grow" style={{ gap: 4 }}>
              <span className="label">{t('Distance (m)')}</span>
              <input type="number" inputMode="numeric" min="1" disabled={busy || draft.mode === 'points'} value={draft.distance}
                onChange={(e) => change({ ...draft, kind: kindFor(draft.kind, e.target.value), distance: e.target.value })} />
            </label>
            <label className="stack grow" style={{ gap: 4 }}>
              <span className="label">{t('Lap length (m)')}</span>
              <input type="number" inputMode="numeric" min="1" disabled={busy || draft.mode !== 'laps'} value={draft.lapLength}
                onChange={(e) => change({ ...draft, lapLength: e.target.value })} />
            </label>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">{t('Timed')}</span>
            <div className="chips" style={{ flexWrap: 'wrap' }} role="radiogroup" aria-label={t('Timed')}>
              {[['laps', t('Every lap')], ['finish', t('Finish only')], ['points', t('My own points')]].map(([m, label]) => (
                <button key={m} type="button" role="radio" aria-checked={draft.mode === m}
                  className={`chip${draft.mode === m ? ' on' : ''}`} disabled={busy}
                  onClick={() => change({ ...draft, mode: m, points: m === 'points' ? draft.points : undefined })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Only "My own points" is typed by hand; the other modes work the
              points out, and the line under the form lists them. */}
          {draft.mode === 'points' && (
            <label className="stack" style={{ gap: 4 }}>
              <span className="label">{t('Timing points (m from the start)')}</span>
              <textarea rows={2} value={pointsText} disabled={busy} onChange={(e) => setPoints(e.target.value)}
                placeholder="1500, 3000, 5000" style={{ resize: 'vertical' }} />
            </label>
          )}
        </>
      )}

      {error ? <div className="form-error">{error}</div> : (
        <div className="muted tiny">
          {describe(draft)}{beermile ? `. ${t('Penalty laps can be added per runner while timing.')}`
            : draft.mode === 'points' ? '.' : `: ${t('a tap at {points} m.', { points: draft.points.join(', ') })}`}
        </div>
      )}

      {!compact && (changed || error) && (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost grow" disabled={busy} onClick={() => { setDraft(value); setPointsText(value.points.join(', ')); setError('') }}>{t('Cancel')}</button>
          <button className="btn primary grow" disabled={busy || Boolean(error) || !changed} onClick={() => onSave(normalise(draft))}>{t('Save')}</button>
        </div>
      )}
    </div>
  )
}

// A preset distance changed by hand is a custom race.
function kindFor(kind, distance) {
  const preset = KINDS.find((k) => k.id === kind)
  return preset && kind !== 'custom' && kind !== 'beermile' && Number(distance) !== preset.distance ? 'custom' : kind
}

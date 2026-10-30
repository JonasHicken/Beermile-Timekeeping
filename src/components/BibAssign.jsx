import { useMemo, useState } from 'react'
import { parseNumbers, planBibs, classesOf } from '../lib/bibs.js'

// Renumbering the whole start list in blocks per class (lib/bibs.js). Nothing
// changes until Apply, and the preview shows exactly what Apply will do.
// Remembered per event on this phone: the numbers you have and the order.
const KEY = (eventId) => `bmtk:bibs:${eventId}`
function load(eventId) {
  try { return JSON.parse(localStorage.getItem(KEY(eventId)) || 'null') } catch { return null }
}
function save(eventId, v) {
  try { localStorage.setItem(KEY(eventId), JSON.stringify(v)) } catch { /* not remembered */ }
}

export default function BibAssign({ eventId, runners, onApply, onClose }) {
  const entries = useMemo(() => runners.map((r) => ({ key: r.id, bib: r.bib, category: r.category || '' })), [runners])
  const saved = load(eventId)
  const [numbers, setNumbers] = useState(saved?.numbers ?? `1-${Math.max(99, runners.length)}`)
  const [order, setOrder] = useState(saved?.order ?? classesOf(entries))
  const [starts, setStarts] = useState(saved?.starts ?? {})
  const [tens, setTens] = useState(saved?.tens ?? true)

  const parsed = parseNumbers(numbers)
  const plan = planBibs(entries, { available: parsed.numbers, order, starts, tens })
  const classes = plan.groups.map((g) => g.category)

  function move(i, step) {
    const next = [...classes]
    ;[next[i], next[i + step]] = [next[i + step], next[i]]
    setOrder(next)
  }

  function apply() {
    save(eventId, { numbers, order: classes, starts, tens })
    onApply(plan.changes)
  }

  const blocked = Boolean(parsed.error) || plan.missing > 0 || plan.changes.length === 0

  return (
    <div className="card stack" style={{ marginTop: 10 }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <strong>Assign bibs by class</strong>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      <div className="muted tiny">
        Every class gets numbers that follow each other. Laps stay with the runner, so this is safe after timing has started.
      </div>

      <label className="stack" style={{ gap: 4 }}>
        <span className="muted tiny">Bib numbers you have, e.g. 1-60, 100-150</span>
        <input value={numbers} onChange={(e) => setNumbers(e.target.value)} inputMode="text" />
      </label>
      {parsed.error && <div className="form-error">{parsed.error}</div>}

      <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="checkbox" checked={tens} onChange={(e) => setTens(e.target.checked)}
          style={{ width: 20, height: 20, flex: 'none', margin: 0, accentColor: 'var(--amber)' }} />
        <span>Start each class on a new ten (1–17, then 20…)</span>
      </label>

      <div className="stack" style={{ gap: 6 }}>
        {plan.groups.map((g, i) => (
          <div key={g.category} style={{ display: 'grid', gridTemplateColumns: `${classes.length > 1 ? 'auto ' : ''}minmax(0, 1fr) 64px`, gap: 8, alignItems: 'center' }}>
            {classes.length > 1 && (
              <span className="row" style={{ gap: 2 }}>
                <button className="btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${g.category || 'no class'} earlier`}>▲</button>
                <button className="btn ghost sm" disabled={i === classes.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${g.category || 'no class'} later`}>▼</button>
              </span>
            )}
            <span style={{ minWidth: 0 }}>
              <strong>{g.category || 'No class'}</strong>
              <span className="muted"> · {g.items.length} → </span>
              <span>{g.first == null ? 'no numbers left' : g.first === g.last ? `${g.first}` : `${g.first}–${g.last}`}{g.gaps ? ' (with gaps)' : ''}</span>
            </span>
            <input style={{ width: '100%' }} inputMode="numeric" placeholder="from"
              value={starts[g.category] ?? ''} aria-label={`First bib for ${g.category || 'no class'}`}
              onChange={(e) => setStarts({ ...starts, [g.category]: e.target.value.replace(/\D/g, '') })} />
          </div>
        ))}
      </div>

      {plan.missing > 0 && (
        <div className="form-error">Not enough numbers: {plan.missing} runner{plan.missing === 1 ? '' : 's'} would get none. Add more numbers or lower a start.</div>
      )}
      <button className="btn primary block" disabled={blocked} onClick={apply}>
        {plan.changes.length ? `Apply · ${plan.changes.length} bib${plan.changes.length === 1 ? '' : 's'} change` : 'Bibs already match'}
      </button>
    </div>
  )
}

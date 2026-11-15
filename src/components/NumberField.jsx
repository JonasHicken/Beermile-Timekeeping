import { t } from '../lib/i18n.js'
import { useState } from 'react'

// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// A number box that commits when you leave it (or press Enter), not on every
// keystroke. Committing per keystroke meant clearing "4" to type "5" turned
// the value into 1 and you got "15". An empty or unusable entry goes back to
// the old value; out-of-range entries are clamped and say so. onCommit(n) may
// return false to keep the old value on screen (e.g. while a confirmation is
// open; the new value lands if it is confirmed).
export default function NumberField({ value, min, max, onCommit, label }) {
  const [draft, setDraft] = useState(null)
  const [note, setNote] = useState(null) // { for: clamped value, text }

  function commit() {
    if (draft == null) return
    const n = parseInt(draft, 10)
    setDraft(null)
    if (!Number.isFinite(n)) { setNote(null); return }
    const clamped = Math.min(max, Math.max(min, n))
    setNote(clamped !== n ? { for: clamped, text: t('{label}: {min}–{max}, so {n}.', { label, min, max, n: clamped }) } : null)
    onCommit(clamped)
  }

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        aria-label={label}
      />
      {/* Only while the clamped value is the one showing (not after a cancel). */}
      {note && note.for === value && <div className="field-note">{note.text}</div>}
    </>
  )
}


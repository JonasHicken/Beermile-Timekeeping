import { useState } from 'react'

// A race time as two boxes, minutes and seconds, instead of one "m:ss.d" field.
// iPhone's number keypads have no ":" key, so a single field either opened a
// keypad that could not type the time, or the full keyboard. Two boxes each
// get a keypad: whole minutes, and seconds with a decimal (the comma a
// Norwegian keypad shows is accepted too).
//
// onSubmit(ms) may return an error string to show; anything else clears it.
export default function TimeInput({ initialMs = null, submitLabel = 'Set', onSubmit }) {
  const [mins, setMins] = useState(initialMs != null ? String(Math.floor(initialMs / 60000)) : '')
  const [secs, setSecs] = useState(initialMs != null ? secsText(initialMs) : '')
  const [error, setError] = useState('')

  function submit() {
    const m = mins.trim() === '' ? 0 : Number(mins)
    const s = Number(secs.trim().replace(',', '.'))
    if (secs.trim() === '' || !Number.isInteger(m) || m < 0 || !Number.isFinite(s) || s < 0 || s >= 60) {
      setError('Enter whole minutes, and seconds under 60 — for example 7 and 06.8.')
      return
    }
    const msg = onSubmit(Math.round(m * 60000 + s * 1000))
    setError(typeof msg === 'string' ? msg : '')
  }

  const onKey = (e) => { if (e.key === 'Enter') submit() }

  return (
    <div>
      <div className="time-input row">
        <input
          className="t-min"
          value={mins}
          onChange={(e) => { setMins(e.target.value.replace(/\D/g, '')); setError('') }}
          onKeyDown={onKey}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="min"
          aria-label="Minutes"
        />
        <span className="t-colon">:</span>
        <input
          className="t-sec grow"
          value={secs}
          onChange={(e) => { setSecs(e.target.value.replace(/[^\d.,]/g, '')); setError('') }}
          onKeyDown={onKey}
          inputMode="decimal"
          placeholder="ss.d"
          aria-label="Seconds"
        />
        <button type="button" className="btn" onClick={submit}>{submitLabel}</button>
      </div>
      {error && <div className="form-error" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  )
}

// 65400 -> "05.4": tenths truncated, like the time shown everywhere else.
function secsText(ms) {
  const tenths = Math.floor((ms % 60000) / 100)
  const whole = Math.floor(tenths / 10)
  return `${String(whole).padStart(2, '0')}.${tenths % 10}`
}

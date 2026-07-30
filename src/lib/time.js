// Time formatting + elapsed helpers. All timestamps in the app are absolute
// epoch-milliseconds (Date.now()), so they survive a page reload mid-race —
// which matters far more here than immunity to a wall-clock adjustment during
// a 10-minute heat. Elapsed = capturedAt - heat.startedAt.

// mm:ss.d  (one decimal) — the readable race format
export function fmt(ms) {
  if (ms == null || Number.isNaN(ms)) return '—'
  const neg = ms < 0
  let s = Math.abs(ms) / 1000
  const m = Math.floor(s / 60)
  s -= m * 60
  const whole = Math.floor(s)
  const tenth = Math.floor((s - whole) * 10)
  const out = `${m}:${String(whole).padStart(2, '0')}.${tenth}`
  return neg ? `-${out}` : out
}

// mm:ss (no decimal) for compact split display
export function fmtShort(ms) {
  if (ms == null || Number.isNaN(ms)) return '—'
  let s = Math.round(Math.abs(ms) / 1000)
  const m = Math.floor(s / 60)
  s -= m * 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function nowMs() {
  return Date.now()
}

// Parse "m:ss.d" / "m:ss" / "ss" back into milliseconds. Returns null if the
// string isn't a usable time, so callers can reject the edit rather than
// silently writing NaN into a crossing.
export function parseElapsed(str) {
  const t = String(str).trim()
  if (!t) return null
  const m = t.match(/^(?:(\d+):)?(\d{1,2})(?:[.,](\d{1,3}))?$/)
  if (!m) return null
  const mins = m[1] ? Number(m[1]) : 0
  const secs = Number(m[2])
  if (secs > 59 && m[1]) return null
  const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0
  return mins * 60000 + secs * 1000 + frac
}

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

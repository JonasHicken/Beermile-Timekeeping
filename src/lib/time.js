// Time formatting + elapsed helpers. All timestamps in the app are absolute
// epoch-milliseconds (Date.now()), so they survive a page reload mid-race —
// which matters far more here than immunity to a wall-clock adjustment during
// a 10-minute heat. Elapsed = capturedAt - heat.startedAt.

// mm:ss.d  (one decimal) — the readable race format. Worked in whole tenths:
// in floating point 194.7 - 180 is 14.6999…, so a time typed as 3:14.7 used
// to come back as 3:14.6.
export function fmt(ms) {
  if (ms == null || Number.isNaN(ms)) return '—'
  const neg = ms < 0
  const tenths = Math.floor(Math.abs(ms) / 100)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  const out = `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`
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

// Several phones timing one race must agree on the time: a heat started on one
// phone and a lap tapped on another are subtracted from each other. So each
// phone measures how far its own clock is from the server's (see online.js)
// and every timestamp the app makes is on the server's clock. Kept across a
// reload, because a reload mid-race must not move the clock. Zero, i.e. the
// phone's own clock, until the phone has been online once.
const OFFSET_KEY = 'bmtk:klokke'
let clock = { offset: 0, rtt: Infinity, at: 0 }
try {
  const saved = JSON.parse(localStorage.getItem(OFFSET_KEY) || 'null')
  if (saved && Number.isFinite(saved.offset)) clock = saved
} catch { /* private mode: start from the phone's own clock */ }

export function nowMs() {
  return Date.now() + clock.offset
}

export const clockInfo = () => clock

// One measurement: the server said `serverMs` somewhere between `sentAt` and
// `receivedAt` (phone clock). The middle of that window is the best guess, and
// its error is at most half the round trip, so the quickest round trip is the
// one to trust. A newer one replaces it only if it is about as quick, or the
// saved one is more than ten minutes old (clocks drift).
export function noteServerTime(serverMs, sentAt, receivedAt) {
  const rtt = receivedAt - sentAt
  if (!Number.isFinite(serverMs) || rtt < 0 || rtt > 10000) return
  const stale = Date.now() - clock.at > 10 * 60 * 1000
  if (rtt <= clock.rtt * 1.25 || stale) {
    clock = { offset: Math.round(serverMs - (sentAt + receivedAt) / 2), rtt, at: Date.now() }
    try { localStorage.setItem(OFFSET_KEY, JSON.stringify(clock)) } catch { /* see above */ }
  }
}

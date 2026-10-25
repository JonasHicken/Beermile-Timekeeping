// ---------------------------------------------------------------------------
// Local-first data store for Beermile Timekeeping.
//
// The browser is the source of truth DURING a race: every tap writes to
// localStorage synchronously, so timing never depends on the network. Supabase
// (see sync.js) is a downstream publisher for the public live page, not the
// system of record.
//
// The crossings log is append-only and carries a `source` field
// ('tap' | 'rfid' | 'manual'). That is the whole RFID-readiness story: an RFID
// bridge later writes crossings with source:'rfid' into this exact shape and
// every screen already understands them. Corrections set `void:true` rather
// than deleting, so the log stays auditable and reconcilable against chip data.
//
// Lap ORDINALS are always derived from chronological order at read time, never
// from the stored `lap` field — voiding a mid-race crossing must renumber the
// ones after it. The stored `lap` records what it was at capture, for audit.
//
// ONLINE EVENTS (opened from a timing link, see online.js) are shared by
// several phones. Their start list and heats come from the admin portal and
// are read-only here; what a phone changes at the track (laps, heat start and
// finish, runner status) is stamped with `endretMs` and queued in `outbox`
// until the server has it. The newest change wins, so stamping is the whole
// conflict story.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react'
import { nowMs } from './time.js'

const KEY = 'bmtk:v1'

const empty = () => ({
  events: [], runners: [], heats: [], crossings: [],
  outbox: { crossings: [], heats: [], runners: [] },
})

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const data = JSON.parse(raw)
    return { ...empty(), ...data, outbox: { ...empty().outbox, ...data.outbox } }
  } catch {
    return empty()
  }
}

let state = load()
const listeners = new Set()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* quota / private mode — in-memory state still works for the session */
  }
}

// Every mutation replaces `state` with a new object (new reference) so
// useSyncExternalStore's getSnapshot sees a change and re-renders subscribers.
function commit(next) {
  state = next
  persist()
  listeners.forEach((l) => l())
}

function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function getSnapshot() {
  return state
}

// For code outside React (the sync loop) that needs the current state.
export const getState = () => state

// Cross-tab sync: another tab writing the same key updates us.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      state = load()
      listeners.forEach((l) => l())
    }
  })
}

// The server's ids are uuids, so the fallback is shaped like one too.
const uid = () =>
  crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 3) | 8).toString(16)
  })

// Which phone made a crossing. Lets Undo take back this phone's own last tap,
// not another timer's.
export const DEVICE_ID = (() => {
  try {
    let id = localStorage.getItem('bmtk:enhet')
    if (!id) { id = uid(); localStorage.setItem('bmtk:enhet', id) }
    return id
  } catch { return uid() }
})()

export const isOnline = (s, eventId) => Boolean(getEvent(s, eventId)?.online)

// Stamps changed rows of an online event and queues them for the server.
// Offline events pass straight through.
function stamp(next, kind, ids) {
  const byId = new Set(ids)
  const online = new Set(next.events.filter((e) => e.online).map((e) => e.id))
  const queued = []
  const at = nowMs()
  const rows = next[kind].map((row) => {
    if (!byId.has(row.id) || !online.has(row.eventId)) return row
    queued.push(row.id)
    return { ...row, endretMs: Math.max(at, (row.endretMs ?? 0) + 1) }
  })
  if (!queued.length) return next
  const box = new Set([...next.outbox[kind], ...queued])
  return { ...next, [kind]: rows, outbox: { ...next.outbox, [kind]: [...box] } }
}

// ---- React hooks -----------------------------------------------------------

// getSnapshot returns the raw `state`, whose reference is stable between
// commits, so useSyncExternalStore never loops. The selector (which may build
// fresh derived arrays) runs AFTER, on each render — cheap at this data scale.
export function useStore(selector) {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  return selector(snap)
}

// ---- runner status ---------------------------------------------------------

export const STATUSES = [
  { key: 'ok', label: 'Racing' },
  { key: 'dnf', label: 'DNF' },
  { key: 'dns', label: 'DNS' },
  { key: 'dq', label: 'DQ' },
]

export const statusOf = (r) => r?.status ?? 'ok'
export const penaltyOf = (r) => r?.penaltyLaps ?? 0

// A beer mile penalty lap (e.g. for vomiting) means this runner must complete
// an extra lap, so their required count differs from the event default.
export const requiredLaps = (event, runner) =>
  (event?.numLaps ?? 4) + penaltyOf(runner)

// ---- selectors (pure) ------------------------------------------------------

export const listEvents = (s = state) =>
  [...s.events].sort((a, b) => b.createdAt - a.createdAt)

export const getEvent = (s, id) => s.events.find((e) => e.id === id) || null

export const runnersInEvent = (s, eventId) =>
  s.runners
    .filter((r) => r.eventId === eventId)
    .sort((a, b) => bibNum(a.bib) - bibNum(b.bib))

export const runnersInHeat = (s, heatId) =>
  s.runners
    .filter((r) => r.heatId === heatId)
    .sort((a, b) => bibNum(a.bib) - bibNum(b.bib))

export const heatsInEvent = (s, eventId) =>
  s.heats.filter((h) => h.eventId === eventId).sort((a, b) => a.order - b.order)

export const getHeat = (s, id) => s.heats.find((h) => h.id === id) || null

export const getRunner = (s, id) => s.runners.find((r) => r.id === id) || null

// Who in this event already has `bib` (ignoring `exceptId`), or null. Bibs are
// the identity on the timing screen, so two runners can never share one.
export const bibOwner = (s, eventId, bib, exceptId = null) => {
  const b = String(bib ?? '').trim()
  if (!b) return null
  return s.runners.find((r) => r.eventId === eventId && r.id !== exceptId && String(r.bib).trim() === b) || null
}

// Two taps for the same runner within this long are one crossing: no lap of a
// beer mile is that quick, and with several phones timing one heat, two people
// will sometimes tap the same runner. The first tap counts.
export const DUPLICATE_MS = 15000

// No one runs a beer-mile lap, beer included, in under 40 seconds (world
// record pace is over a minute a lap). A tap sooner than that after the start
// or the runner's previous lap is almost certainly a bumped tile, so it is
// held back for the timer to confirm rather than counted.
export const MIN_LAP_MS = 40000

export function dedupeCrossings(sorted) {
  const last = {}
  return sorted.filter((c) => {
    const prev = last[c.runnerId]
    if (prev != null && c.capturedAt - prev < DUPLICATE_MS) return false
    last[c.runnerId] = c.capturedAt
    return true
  })
}

export const crossingsInHeat = (s, heatId) =>
  dedupeCrossings(
    s.crossings
      .filter((c) => c.heatId === heatId && !c.void)
      .sort((a, b) => a.capturedAt - b.capturedAt),
  )

// Includes voided rows — for the review log, where they show struck through.
export const allCrossingsInHeat = (s, heatId) =>
  s.crossings
    .filter((c) => c.heatId === heatId)
    .sort((a, b) => a.capturedAt - b.capturedAt)

export const crossingsForRunner = (s, heatId, runnerId) =>
  crossingsInHeat(s, heatId).filter((c) => c.runnerId === runnerId)

export const lapCount = (s, heatId, runnerId) =>
  crossingsForRunner(s, heatId, runnerId).length

function bibNum(b) {
  const n = parseInt(String(b).replace(/\D/g, ''), 10)
  return Number.isNaN(n) ? 1e9 : n
}

// Per-runner computed result within their heat.
export function runnerResult(s, event, heat, runner) {
  const cs = crossingsForRunner(s, heat.id, runner.id)
  const need = requiredLaps(event, runner)
  const laps = []
  let prev = heat.startedAt
  for (const c of cs) {
    if (prev != null) laps.push({ id: c.id, lap: laps.length + 1, at: c.capturedAt, split: c.capturedAt - prev })
    prev = c.capturedAt
  }
  const status = statusOf(runner)
  const finished = status === 'ok' && cs.length >= need
  const finishAt = finished ? cs[need - 1].capturedAt : null
  const elapsed = finished && heat.startedAt != null ? finishAt - heat.startedAt : null
  return {
    runner,
    heat,
    status,
    requiredLaps: need,
    lapsDone: cs.length,
    laps,
    finished,
    finishAt,
    elapsed, // ms, or null if not finished
  }
}

// Full event standings: finishers ranked by elapsed, then in-progress, then
// non-finishers (DNF/DNS/DQ), then not started.
export function standings(s, eventId) {
  const event = getEvent(s, eventId)
  if (!event) return { finishers: [], inProgress: [], didNotFinish: [], notStarted: [] }
  const heats = heatsInEvent(s, eventId)
  const heatById = Object.fromEntries(heats.map((h) => [h.id, h]))
  const rows = runnersInEvent(s, eventId).map((r) => {
    const heat = r.heatId ? heatById[r.heatId] : null
    if (!heat) {
      return {
        runner: r, heat: null, status: statusOf(r), requiredLaps: requiredLaps(event, r),
        lapsDone: 0, laps: [], finished: false, elapsed: null,
      }
    }
    return runnerResult(s, event, heat, r)
  })

  const finishers = rows
    .filter((r) => r.finished)
    .sort((a, b) => a.elapsed - b.elapsed)
    .map((r, i) => ({ ...r, rank: i + 1 }))
  const didNotFinish = rows.filter((r) => r.status !== 'ok')
  const inProgress = rows
    .filter((r) => r.status === 'ok' && !r.finished && r.heat?.startedAt != null && r.lapsDone > 0)
    .sort((a, b) => b.lapsDone - a.lapsDone)
  const notStarted = rows.filter(
    (r) => r.status === 'ok' && !r.finished && (r.heat?.startedAt == null || r.lapsDone === 0),
  )
  return { event, finishers, inProgress, didNotFinish, notStarted }
}

// ---- mutations -------------------------------------------------------------

export function createEvent({ name, date, numLaps = 4 }) {
  const ev = {
    id: uid(),
    name: name?.trim() || 'Beermile',
    date: date || new Date().toISOString().slice(0, 10),
    numLaps: Number(numLaps) || 4,
    createdAt: nowMs(),
  }
  commit({ ...state, events: [...state.events, ev] })
  return ev
}

export function updateEvent(id, patch) {
  commit({
    ...state,
    events: state.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  })
}

export function deleteEvent(id) {
  const snap = snapshotEvent(id)
  commit({
    ...state,
    events: state.events.filter((e) => e.id !== id),
    runners: state.runners.filter((r) => r.eventId !== id),
    heats: state.heats.filter((h) => h.eventId !== id),
    crossings: state.crossings.filter((c) => c.eventId !== id),
  })
  return snap
}

const newRunner = (eventId, { bib, name, category = '', club = '', email = '' }) => ({
  id: uid(),
  eventId,
  bib: String(bib).trim(),
  name: (name || '').trim(),
  category: (category || '').trim(),
  club: (club || '').trim(),
  // Carried so a published result can later be matched to a beermilenorge.no
  // profile (result claims / public runner pages). Never displayed on the
  // timing screens, and never published with the public results.
  email: (email || '').trim(),
  heatId: null,
  status: 'ok',
  penaltyLaps: 0,
  epc: null, // reserved for RFID tag mapping
})

export function addRunner(eventId, fields) {
  const r = newRunner(eventId, fields)
  commit({ ...state, runners: [...state.runners, r] })
  return r
}

export function updateRunner(id, patch) {
  commit(stamp({
    ...state,
    runners: state.runners.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }, 'runners', [id]))
}

export function setRunnerStatus(id, status) {
  updateRunner(id, { status })
}

export function setPenaltyLaps(id, n) {
  updateRunner(id, { penaltyLaps: Math.max(0, Math.min(9, n)) })
}

export function removeRunner(id) {
  const r = getRunner(state, id)
  const snap = r ? snapshotEvent(r.eventId) : null
  commit({
    ...state,
    runners: state.runners.filter((r) => r.id !== id),
    crossings: state.crossings.filter((c) => c.runnerId !== id),
  })
  return snap
}

// Paste-import: one runner per line, "bib, name, category" or "bib name".
export function importRunners(eventId, text) {
  const added = []
  const next = [...state.runners]
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let bib, name = '', category = ''
    if (t.includes(',')) {
      const parts = t.split(',').map((x) => x.trim())
      bib = parts[0]
      name = parts[1] || ''
      category = parts[2] || ''
    } else {
      const m = t.match(/^(\S+)\s+(.*)$/)
      if (m) { bib = m[1]; name = m[2] } else { bib = t }
    }
    if (!bib) continue
    const r = newRunner(eventId, { bib, name, category })
    next.push(r)
    added.push(r)
  }
  commit({ ...state, runners: next })
  return added
}

// Bulk import from a parsed file. Reports what it skipped rather than silently
// dropping rows — a start list that quietly loses three runners is worse than
// one that refuses to import.
//
// classifyImport is the pure half, so the import dialog can show exactly what
// will be skipped before anything is written. `takenBibs` is the bibs already
// in the event (empty when replacing).
export function classifyImport(rows, takenBibs = []) {
  const taken = new Set([...takenBibs].map(String))
  const ok = []
  const duplicates = []
  const missingBib = []
  for (const row of rows) {
    const bib = String(row.bib ?? '').trim()
    if (!bib) { missingBib.push(row); continue }
    if (taken.has(bib)) { duplicates.push(row); continue }
    taken.add(bib)
    ok.push(row)
  }
  return { ok, duplicates, missingBib }
}

export function importRunnerRows(eventId, rows, { replace = false } = {}) {
  const snap = snapshotEvent(eventId)
  const existing = replace ? [] : runnersInEvent(state, eventId)
  const { ok, duplicates, missingBib } = classifyImport(rows, existing.map((r) => r.bib))
  const added = ok.map((row) => newRunner(eventId, row))

  const others = replace
    ? state.runners.filter((r) => r.eventId !== eventId)
    : state.runners
  const next = {
    ...state,
    runners: [...others, ...added],
  }
  // Replacing the field invalidates any heats and timing built on the old one.
  if (replace) {
    next.heats = state.heats.filter((h) => h.eventId !== eventId)
    next.crossings = state.crossings.filter((c) => c.eventId !== eventId)
  }
  commit(next)
  return { added, duplicates, missingBib, snap }
}

export function createHeat(eventId, name) {
  const existing = heatsInEvent(state, eventId)
  const h = {
    id: uid(),
    eventId,
    name: name || `Heat ${existing.length + 1}`,
    order: existing.length,
    status: 'pending',
    startedAt: null,
  }
  commit({ ...state, heats: [...state.heats, h] })
  return h
}

export function updateHeat(id, patch) {
  commit(stamp({
    ...state,
    heats: state.heats.map((h) => (h.id === id ? { ...h, ...patch } : h)),
  }, 'heats', [id]))
}

export function deleteHeat(id) {
  const heat = getHeat(state, id)
  const snap = heat ? snapshotEvent(heat.eventId) : null
  commit({
    ...state,
    heats: state.heats.filter((h) => h.id !== id),
    runners: state.runners.map((r) => (r.heatId === id ? { ...r, heatId: null } : r)),
    crossings: state.crossings.filter((c) => c.heatId !== id),
  })
  return snap
}

export function assignRunner(runnerId, heatId) {
  updateRunner(runnerId, { heatId })
}

// Split all runners into heats of at most `size`, in bib order. The field is
// spread evenly rather than filled heat by heat: 28 runners at 12 per heat is
// 10/9/9, not 12/12/4, which would send four people round on their own.
export function autoSplitHeats(eventId, size = 12) {
  const snap = snapshotEvent(eventId)
  const runners = runnersInEvent(state, eventId)
  const heatCount = Math.max(1, Math.ceil(runners.length / size))
  const heats = state.heats.filter((h) => h.eventId !== eventId)
  const newHeats = []
  for (let i = 0; i < heatCount; i++) {
    newHeats.push({
      id: uid(),
      eventId,
      name: `Heat ${i + 1}`,
      order: i,
      status: 'pending',
      startedAt: null,
    })
  }
  const assignment = {}
  const base = Math.floor(runners.length / heatCount)
  const extra = runners.length % heatCount // the first `extra` heats take one more
  let i = 0
  newHeats.forEach((h, k) => {
    const n = base + (k < extra ? 1 : 0)
    for (let j = 0; j < n; j++) assignment[runners[i++].id] = h.id
  })
  commit({
    ...state,
    heats: [...heats, ...newHeats],
    runners: state.runners.map((r) =>
      r.eventId === eventId ? { ...r, heatId: assignment[r.id] ?? null } : r,
    ),
    crossings: state.crossings.filter((c) => c.eventId !== eventId),
  })
  return Object.assign(newHeats, { snap })
}

export function startHeat(heatId) {
  updateHeat(heatId, { status: 'running', startedAt: nowMs() })
}

export function finishHeat(heatId) {
  updateHeat(heatId, { status: 'done' })
}

// Undo a finish. Keeps the start time and every crossing — the counterpart to
// resetHeat(), which throws the timing away. Without this, finishing a heat by
// mistake could only be undone by destroying the heat's data.
export function reopenHeat(heatId) {
  updateHeat(heatId, { status: 'running' })
}

export function resetHeat(heatId) {
  const heat = getHeat(state, heatId)
  const prev = heat ? { status: heat.status, startedAt: heat.startedAt } : null
  const heats = state.heats.map((h) =>
    h.id === heatId ? { ...h, status: 'pending', startedAt: null } : h,
  )
  // Shared with other phones: the crossings are voided, not deleted, so the
  // reset reaches them too (a deleted row would just come back from the server).
  if (heat && isOnline(state, heat.eventId)) {
    const ids = state.crossings.filter((c) => c.heatId === heatId && !c.void).map((c) => c.id)
    const next = { ...state, heats, crossings: state.crossings.map((c) => (ids.includes(c.id) ? { ...c, void: true } : c)) }
    commit(stamp(stamp(next, 'heats', [heatId]), 'crossings', ids))
    return { online: true, heatId, prev, ids }
  }
  const snap = heat ? snapshotEvent(heat.eventId) : null
  commit({
    ...state,
    heats,
    crossings: state.crossings.filter((c) => c.heatId !== heatId),
  })
  return { online: false, snap }
}

// Undo a reset. A shared heat's laps were voided (deleting would not reach the
// other phones), so they are restored the same way, stamped for the server.
export function undoReset(info) {
  if (!info) return
  if (!info.online) { restoreEvent(info.snap); return }
  commit(stamp(stamp({
    ...state,
    heats: state.heats.map((h) => (h.id === info.heatId ? { ...h, ...info.prev } : h)),
    crossings: state.crossings.map((c) => (info.ids.includes(c.id) ? { ...c, void: false } : c)),
  }, 'heats', [info.heatId]), 'crossings', info.ids))
}

// Record a crossing. Auto-computes the next lap from how many non-void
// crossings the runner already has. Returns null if they've completed all laps.
//
// A tap that can't be a real lap is never thrown away: it is recorded as a
// void crossing with `rejected` saying why, and returned so the timing screen
// can offer to count it. Throwing it away lost data in exactly the case it
// mattered: tap 8 when 9 crosses, and 8's real crossing ten seconds later used
// to vanish as "already has this lap".
//   rejected: 'duplicate'  within DUPLICATE_MS of the runner's previous lap
//   rejected: 'too-soon'   under MIN_LAP_MS since that lap (or the start)
//   rejected: 'finished'   the runner already has all their laps. The case
//                          that matters most: a mis-tap on someone's last lap
//                          finished them early, and this tap is their real
//                          finish. Kept, so it can replace the early one.
//   rejected: 'other-timer' the runner's last lap was tapped on another phone
//                          under MIN_LAP_MS ago: two timers saw the same
//                          crossing. Not offered as a swap: the earlier
//                          timer's tap stands, and Review can still fix it.
// A 'duplicate' or 'finished' row points at the lap it collided with (dupOf),
// which acceptRejectedTap voids in exchange.
// `force` skips the too-soon check (the timer confirmed it, or a manual add).
export function recordCrossing(heatId, runnerId, source = 'tap', at = nowMs(), { force = false } = {}) {
  const heat = state.heats.find((h) => h.id === heatId)
  const event = state.events.find((e) => e.id === heat?.eventId)
  const runner = state.runners.find((r) => r.id === runnerId)
  const kept = crossingsForRunner(state, heatId, runnerId)
  const done = kept.length
  const prev = kept[kept.length - 1]
  const since = prev ? at - prev.capturedAt : heat?.startedAt != null ? at - heat.startedAt : null
  const finished = Boolean(event) && done >= requiredLaps(event, runner)

  const otherPhone = Boolean(prev?.enhet) && prev.enhet !== DEVICE_ID

  let rejected = null
  if (prev && otherPhone && since < MIN_LAP_MS) rejected = 'other-timer'
  else if (finished) rejected = prev ? 'finished' : null
  else if (prev && since < DUPLICATE_MS) rejected = 'duplicate'
  else if (!force && since != null && since < MIN_LAP_MS) rejected = 'too-soon'
  if (finished && !rejected) return null

  const c = {
    id: uid(),
    eventId: event?.id ?? null,
    heatId,
    runnerId,
    bib: runner?.bib ?? null,
    lap: finished ? done : done + 1,
    capturedAt: at,
    source, // 'tap' | 'rfid' | 'manual'
    rssi: null, // reserved for RFID
    void: Boolean(rejected),
    ...(rejected ? { rejected } : {}),
    ...(rejected === 'duplicate' || rejected === 'finished' || rejected === 'other-timer' ? { dupOf: prev.id } : {}),
    enhet: DEVICE_ID,
  }
  commit(stamp({ ...state, crossings: [...state.crossings, c] }, 'crossings', [c.id]))
  if (rejected === 'other-timer') return { ...c, otherTimer: true, prevId: prev.id, sinceMs: since }
  if (rejected === 'finished') return { ...c, afterFinish: true, prevId: prev.id, sinceMs: since }
  if (rejected === 'duplicate') return { ...c, duplicate: true, prevId: prev.id, sinceMs: since }
  if (rejected === 'too-soon') return { ...c, tooSoon: true, sinceMs: since }
  return c
}

// The rejected tap was the real one: count it, and (for a duplicate) void the
// lap it collided with. One step, so a mis-tap followed by the right runner's
// crossing is fixed from the toast instead of a trip to Review.
export function acceptRejectedTap(id) {
  const c = state.crossings.find((x) => x.id === id)
  if (!c) return
  const ids = c.dupOf ? [id, c.dupOf] : [id]
  commit(stamp({
    ...state,
    crossings: state.crossings.map((x) => {
      if (x.id === id) {
        const { rejected, ...rest } = x
        return { ...rest, void: false }
      }
      if (x.id === c.dupOf) return { ...x, void: true }
      return x
    }),
  }, 'crossings', ids))
}

// Add a lap at a given time, for a crossing nobody tapped. Unlike a tap it can
// land between existing laps (ordinals are derived from time order), so it is
// checked against every lap, not just the last. Returns the crossing, or
// { error } explaining why not.
export function addLapAt(heatId, runnerId, at) {
  const heat = getHeat(state, heatId)
  const event = getEvent(state, heat?.eventId)
  const runner = getRunner(state, runnerId)
  if (!heat || heat.startedAt == null) return { error: 'The heat has not started.' }
  if (at < heat.startedAt) return { error: 'That is before the start.' }
  const kept = crossingsForRunner(state, heatId, runnerId)
  if (event && kept.length >= requiredLaps(event, runner)) {
    return { error: 'All laps are already recorded. Remove the wrong one first.' }
  }
  if (kept.some((c) => Math.abs(c.capturedAt - at) < DUPLICATE_MS)) {
    return { error: 'There is already a lap within 15 seconds of that time.' }
  }
  const c = {
    id: uid(), eventId: event?.id ?? null, heatId, runnerId, bib: runner?.bib ?? null,
    lap: kept.filter((k) => k.capturedAt < at).length + 1, capturedAt: at,
    source: 'manual', rssi: null, void: false, enhet: DEVICE_ID,
  }
  commit(stamp({ ...state, crossings: [...state.crossings, c] }, 'crossings', [c.id]))
  return c
}

// Undo the most recent non-void crossing in a heat (or for one runner). In a
// shared heat, only this phone's own taps: Undo must never take back a lap
// another timer recorded.
export function undoLastCrossing(heatId, runnerId = null) {
  const heat = getHeat(state, heatId)
  const ownOnly = heat && isOnline(state, heat.eventId)
  const pool = state.crossings
    .filter((c) => c.heatId === heatId && !c.void && (!runnerId || c.runnerId === runnerId))
    .filter((c) => !ownOnly || c.enhet === DEVICE_ID)
    .sort((a, b) => b.capturedAt - a.capturedAt)
  const last = pool[0]
  if (!last) return null
  commit(stamp({
    ...state,
    crossings: state.crossings.map((c) => (c.id === last.id ? { ...c, void: true } : c)),
  }, 'crossings', [last.id]))
  return last
}

// ---- targeted corrections (the review screen) ------------------------------

export function setCrossingVoid(id, isVoid) {
  commit(stamp({
    ...state,
    crossings: state.crossings.map((c) => (c.id === id ? { ...c, void: isVoid } : c)),
  }, 'crossings', [id]))
}

// Fix a mistap: move this crossing to a different runner.
export function reassignCrossing(id, runnerId) {
  const runner = state.runners.find((r) => r.id === runnerId)
  commit(stamp({
    ...state,
    crossings: state.crossings.map((c) =>
      c.id === id ? { ...c, runnerId, bib: runner?.bib ?? null, source: 'manual' } : c,
    ),
  }, 'crossings', [id]))
}

export function setCrossingTime(id, capturedAt) {
  commit(stamp({
    ...state,
    crossings: state.crossings.map((c) =>
      c.id === id ? { ...c, capturedAt, source: 'manual' } : c,
    ),
  }, 'crossings', [id]))
}

// ---- undo for destructive actions ------------------------------------------
//
// Every destructive action (remove a runner, delete a heat or the event,
// reset, re-split, import) takes a snapshot of the event first, and the screen
// offers Undo. Restoring puts the event's rows back as they were, but keeps
// laps tapped in the meantime for runners that still exist, so undoing a setup
// change can't eat a live heat's timing.
export function snapshotEvent(eventId) {
  return {
    eventId,
    event: getEvent(state, eventId),
    runners: state.runners.filter((r) => r.eventId === eventId),
    heats: state.heats.filter((h) => h.eventId === eventId),
    crossings: state.crossings.filter((c) => c.eventId === eventId),
  }
}

export function restoreEvent(snap) {
  if (!snap) return
  const id = snap.eventId
  const others = (kind) => state[kind].filter((x) => x.eventId !== id)
  const runnerIds = new Set(snap.runners.map((r) => r.id))
  const had = new Set(snap.crossings.map((c) => c.id))
  const since = state.crossings.filter((c) => c.eventId === id && !had.has(c.id) && runnerIds.has(c.runnerId))
  commit({
    ...state,
    events: snap.event ? [...state.events.filter((e) => e.id !== id), snap.event] : state.events,
    runners: [...others('runners'), ...snap.runners],
    heats: [...others('heats'), ...snap.heats],
    crossings: [...others('crossings'), ...snap.crossings, ...since],
  })
}

export function exportEvent(eventId) {
  return {
    event: getEvent(state, eventId),
    runners: runnersInEvent(state, eventId),
    heats: heatsInEvent(state, eventId),
    crossings: state.crossings.filter((c) => c.eventId === eventId),
  }
}

// ---- online events (shared by several phones) ------------------------------

const fromServerRunner = (eventId, r) => ({
  id: r.id, eventId, bib: String(r.bib), name: r.name || '', category: r.category || '',
  club: '', email: '', heatId: r.heat_id ?? null,
  status: r.status || 'ok', penaltyLaps: r.straffe ?? 0, epc: null, endretMs: r.endret_ms ?? 0,
})
const fromServerHeat = (eventId, h) => ({
  id: h.id, eventId, name: h.name, order: h.order ?? 0,
  status: h.status || 'pending', startedAt: h.started_at ?? null, endretMs: h.endret_ms ?? 0,
})
const fromServerCrossing = (eventId, c) => ({
  id: c.id, eventId, heatId: c.heat_id, runnerId: c.runner_id, bib: c.bib ?? null,
  lap: c.lap, capturedAt: c.captured_at, source: c.source || 'tap', rssi: null,
  void: !!c.void, enhet: c.enhet ?? null, endretMs: c.endret_ms ?? 0,
})

// What a phone holds that the server does not have yet.
export function pendingFor(s, eventId) {
  const pick = (kind) => s[kind].filter((x) => x.eventId === eventId && s.outbox[kind].includes(x.id))
  return { crossings: pick('crossings'), heats: pick('heats'), runners: pick('runners') }
}

export const pendingCount = (s, eventId) => {
  const p = pendingFor(s, eventId)
  return p.crossings.length + p.heats.length + p.runners.length
}

// The server has these rows as of the given stamps. A row changed again while
// the request was in flight has a newer stamp and stays queued.
export function ackSent(sent) {
  const outbox = { ...state.outbox }
  for (const kind of ['crossings', 'heats', 'runners']) {
    const stamps = Object.fromEntries(sent[kind].map((x) => [x.id, x.endretMs]))
    outbox[kind] = outbox[kind].filter((id) => {
      if (!(id in stamps)) return true
      const now = state[kind].find((x) => x.id === id)
      return Boolean(now) && (now.endretMs ?? 0) > stamps[id]
    })
  }
  commit({ ...state, outbox })
}

// Opening a timing link: the event as the server has it, plus the token.
export function adoptOnlineEvent(data, token) {
  const id = data.event.id
  const ev = {
    id, name: data.event.name, date: data.event.date ?? '', numLaps: data.event.num_laps ?? 4,
    createdAt: getEvent(state, id)?.createdAt ?? nowMs(),
    online: { token },
  }
  commit({ ...state, events: [...state.events.filter((e) => e.id !== id), ev] })
  mergeServer(id, data)
  return ev
}

// Folds what the server sent into the local store. The start list and the
// heats' names and order belong to the desk, so the server's version always
// wins there. Anything this phone changed and has not sent yet (still in the
// outbox, with a stamp at least as new) keeps the local version: it is about
// to be sent, and the server takes it if it is newer.
export function mergeServer(eventId, data) {
  let changed = false
  if (!getEvent(state, eventId)) return
  const events = state.events.map((e) => {
    if (e.id !== eventId || !data.event) return e
    const next = { ...e, name: data.event.name, date: data.event.date ?? '', numLaps: data.event.num_laps ?? 4 }
    if (next.name !== e.name || next.date !== e.date || next.numLaps !== e.numLaps) { changed = true; return next }
    return e
  })

  const keepLocal = (kind, local, remote) =>
    Boolean(local) && state.outbox[kind].includes(local.id) && (local.endretMs ?? 0) >= (remote.endret_ms ?? 0)
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  // Runners and heats arrive in full each time, so anything missing was removed.
  function mergeList(kind, remoteRows, fromServer, deskFields) {
    const local = Object.fromEntries(state[kind].filter((x) => x.eventId === eventId).map((x) => [x.id, x]))
    const merged = remoteRows.map((r) => {
      const l = local[r.id]
      const server = fromServer(eventId, r)
      let next = server
      if (keepLocal(kind, l, r)) {
        next = { ...l }
        for (const f of deskFields) next[f] = server[f]
      }
      if (!l || !same(l, next)) changed = true
      return l && same(l, next) ? l : next
    })
    if (Object.keys(local).length !== remoteRows.length) changed = true
    return [...state[kind].filter((x) => x.eventId !== eventId), ...merged]
  }

  const runners = data.runners
    ? mergeList('runners', data.runners, fromServerRunner, ['bib', 'name', 'category', 'heatId'])
    : state.runners
  const heats = data.heats
    ? mergeList('heats', data.heats, fromServerHeat, ['name', 'order'])
    : state.heats

  // Crossings arrive as changes since last time, so nothing is removed here.
  let crossings = state.crossings
  if (data.crossings?.length) {
    const index = new Map(crossings.map((c, i) => [c.id, i]))
    crossings = [...crossings]
    for (const r of data.crossings) {
      const i = index.get(r.id)
      const l = i == null ? null : crossings[i]
      if (keepLocal('crossings', l, r)) continue
      const next = fromServerCrossing(eventId, r)
      if (l && same(l, next)) continue
      changed = true
      if (i == null) { index.set(r.id, crossings.length); crossings.push(next) } else crossings[i] = next
    }
  }

  if (changed) commit({ ...state, events, runners, heats, crossings })
}

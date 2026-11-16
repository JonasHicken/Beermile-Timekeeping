import { t } from './i18n.js'
// ---------------------------------------------------------------------------
// Local-first data store for Beermile Timekeeping.
//
// The browser is the source of truth DURING a race: every tap writes to
// localStorage synchronously, so timing never depends on the network. A shared
// race also syncs with the server (online.js), which every phone timing it
// shares; this phone's copy keeps working without signal.
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
// several phones. Their start list and heats are set at the desk (sign-ups on
// beermilenorge.no, race-day changes in Race admin through the server) and
// are never edited in this store; what a phone changes at the track (laps, heat start and
// finish, runner status) is stamped with `endretMs` and queued in `outbox`
// until the server has it. The newest change wins, so stamping is the whole
// conflict story.
//
// An online event is opened as ADMIN (the organiser's link: starts and
// finishes heats, names the timers and gives them runners) or as a TIMER
// (records laps for their own runners). `online.role` comes from the server,
// which also enforces it. A timer gets in by typing their name, which works as
// a code: `online.me` is that name as the admin wrote it. A timer never gets
// the list of names: a runner's `timer` is their own name or nothing.
// ---------------------------------------------------------------------------

import { formatOf, normalise, describe } from './eventFormat.js'
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

// 'local' for an event that lives only on this phone, else 'admin' or 'timer'.
export const roleOf = (event) => (!event?.online ? 'local' : event.online.role === 'admin' ? 'admin' : 'timer')

// Whether this phone may record laps for a runner: always on its own events
// and for the admin; a timer at a timing point for everyone passing it; any
// other timer only for the runners the admin gave them.
export const canTime = (event, runner) =>
  roleOf(event) !== 'timer' || stationOf(event) != null || (Boolean(runner.timer) && runner.timer === event.online.me)

// The timing point (index from 0) this phone's timer stands at, or null.
export const stationOf = (event) => (roleOf(event) === 'timer' ? event.online.station ?? null : null)

// The heat a timer belongs on: of the heats with their runners, the one
// running, else the next that has not started, else the last one. Null when
// the admin has not given them any runners yet.
export function timerHeat(s, event) {
  const mine = new Set(s.runners.filter((r) => r.eventId === event.id && canTime(event, r) && r.heatId).map((r) => r.heatId))
  const hs = heatsInEvent(s, event.id).filter((h) => mine.has(h.id))
  return (hs.find((h) => h.status === 'running') ?? hs.find((h) => h.status === 'pending') ?? hs[hs.length - 1])?.id ?? null
}

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

// A runner needs a tap at every timing point of the race (eventFormat.js).
// In a beer mile a penalty lap (e.g. for vomiting) is one more on top.
export const requiredLaps = (event, runner) => {
  const f = formatOf(event)
  return f.points.length + (f.penalties ? penaltyOf(runner) : 0)
}

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

// A runner's laps in course order, one slot per timing point: slots[i] is
// the crossing at point i, or empty. A tap made at a timing point (point set)
// goes to that point, so a missed tap at 1500 m leaves 1500 m empty instead
// of moving 3000 m into its place. Taps without a point (one phone, or the
// admin) fill the empty slots in time order. `cs` is in time order.
export function slotCrossings(cs) {
  if (!cs.some((c) => c.point != null)) return [...cs]
  const slots = []
  for (const c of cs) if (c.point != null && slots[c.point] == null) slots[c.point] = c
  for (const c of cs) {
    if (c.point != null) continue
    // The first empty slot that keeps the slots in time order.
    let before = null
    for (let i = 0; i <= slots.length; i++) {
      if (slots[i]) { before = slots[i]; continue }
      const after = slots.slice(i + 1).find(Boolean)
      if ((!before || before.capturedAt < c.capturedAt) && (!after || after.capturedAt > c.capturedAt)) {
        slots[i] = c
        break
      }
    }
  }
  return slots
}

// How far a runner has got: points passed (the furthest one counts) and the
// finishing crossing once the `need`th point has one.
export function progressOf(cs, need) {
  const slots = slotCrossings(cs)
  return { slots, done: slots.length, finish: slots[need - 1] ?? null }
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
  const { slots, done, finish } = progressOf(cs, need)
  // `lap` is the timing point (from 1); a point nobody tapped is left out, and
  // the next split runs from the point before it.
  const laps = []
  let prev = heat.startedAt
  slots.forEach((c, i) => {
    if (!c) return
    if (prev != null) laps.push({ id: c.id, lap: i + 1, at: c.capturedAt, split: c.capturedAt - prev })
    prev = c.capturedAt
  })
  const status = statusOf(runner)
  const finished = status === 'ok' && Boolean(finish)
  const finishAt = finished ? finish.capturedAt : null
  const elapsed = finished && heat.startedAt != null ? finishAt - heat.startedAt : null
  return {
    runner,
    heat,
    status,
    requiredLaps: need,
    lapsDone: done,
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

export function createEvent({ name, date, numLaps = 4, format = null }) {
  const f = format ? normalise(format) : null
  const ev = {
    id: uid(),
    name: name?.trim() || (f ? describe(f).split(' · ')[0] : 'Beermile'),
    date: date || new Date().toISOString().slice(0, 10),
    numLaps: f ? f.points.length : Number(numLaps) || 4,
    ...(f ? { format: f } : {}),
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

// New bibs for many runners at once (lib/bibs.js planBibs). One commit, so the
// list never passes through a state where two runners share a number, and one
// snapshot, so a single Undo puts every bib back. Laps belong to the runner,
// not the number, so nothing timed is touched.
export function assignBibs(eventId, changes) {
  const snap = snapshotEvent(eventId)
  const to = new Map(changes.map((c) => [c.key, String(c.to)]))
  commit(stamp({
    ...state,
    runners: state.runners.map((r) => (r.eventId === eventId && to.has(r.id) ? { ...r, bib: to.get(r.id) } : r)),
  }, 'runners', [...to.keys()]))
  return snap
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
export function recordCrossing(heatId, runnerId, source = 'tap', at = nowMs(), { force = false, point = null } = {}) {
  const heat = state.heats.find((h) => h.id === heatId)
  const event = state.events.find((e) => e.id === heat?.eventId)
  const runner = state.runners.find((r) => r.id === runnerId)
  const kept = crossingsForRunner(state, heatId, runnerId)
  const done = kept.length
  let prev = kept[kept.length - 1]
  let since = prev ? at - prev.capturedAt : heat?.startedAt != null ? at - heat.startedAt : null
  const finished = point == null && Boolean(event) && progressOf(kept, requiredLaps(event, runner)).finish != null

  let rejected = null
  if (point != null) {
    // At a timing point the question is only whether this point already has
    // the runner: then it is the same passing, tapped twice.
    const here = kept.find((c) => c.point === point)
    if (here) {
      prev = here
      since = at - here.capturedAt
      rejected = here.enhet && here.enhet !== DEVICE_ID ? 'other-timer' : 'duplicate'
    }
  } else {
    const otherPhone = Boolean(prev?.enhet) && prev.enhet !== DEVICE_ID
    if (prev && otherPhone && since < MIN_LAP_MS) rejected = 'other-timer'
    else if (finished) rejected = prev ? 'finished' : null
    else if (prev && since < DUPLICATE_MS) rejected = 'duplicate'
    else if (!force && since != null && since < MIN_LAP_MS) rejected = 'too-soon'
    if (finished && !rejected) return null
  }

  const c = {
    id: uid(),
    eventId: event?.id ?? null,
    heatId,
    runnerId,
    bib: runner?.bib ?? null,
    lap: point != null ? point + 1 : finished ? done : done + 1,
    point,
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
  if (!heat || heat.startedAt == null) return { error: t('The heat has not started.') }
  if (at < heat.startedAt) return { error: t('That is before the start.') }
  const kept = crossingsForRunner(state, heatId, runnerId)
  if (event && kept.length >= requiredLaps(event, runner)) {
    return { error: t('All laps are already recorded. Remove the wrong one first.') }
  }
  if (kept.some((c) => Math.abs(c.capturedAt - at) < DUPLICATE_MS)) {
    return { error: t('There is already a lap within 15 seconds of that time.') }
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
  timer: r.tidtaker ?? null,
})
const fromServerHeat = (eventId, h) => ({
  id: h.id, eventId, name: h.name, order: h.order ?? 0,
  status: h.status || 'pending', startedAt: h.started_at ?? null, endretMs: h.endret_ms ?? 0,
})
const fromServerCrossing = (eventId, c) => ({
  id: c.id, eventId, heatId: c.heat_id, runnerId: c.runner_id, bib: c.bib ?? null,
  lap: c.lap, point: c.punkt ?? null, capturedAt: c.captured_at, source: c.source || 'tap', rssi: null,
  void: !!c.void, enhet: c.enhet ?? null, endretMs: c.endret_ms ?? 0,
})

// Role, the timer's own name, and for the admin the list of timers and the
// timer link's token, as the server sent them.
function onlineFields(data) {
  const f = {}
  if (data.rolle) f.role = data.rolle
  if (data.rolle === 'timer' && data.meg) f.me = data.meg
  if (Array.isArray(data.tidtakere)) f.timers = data.tidtakere
  // Timing points: the admin gets everyone's, a timer their own (or null).
  if (data.stasjoner && typeof data.stasjoner === 'object') f.stations = data.stasjoner
  if (data.rolle === 'timer' && 'stasjon' in data) f.station = data.stasjon ?? null
  // The names are the timers' codes. A phone that joined as a timer before
  // they were codes may still hold the list: a timer link never keeps it.
  if (data.rolle === 'timer') f.timers = []
  // Only in a full answer: a short one (nothing changed) leaves these out.
  if (data.rolle && 'tidtakertoken' in data) f.timerToken = data.tidtakertoken ?? null
  // Where results can be sent, set by a website the race is linked to (admin only).
  if (data.event && 'eksport' in data.event) f.eksport = data.event.eksport ?? null
  return f
}

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
// The timer's name comes back from the server once it has accepted it.
export function adoptOnlineEvent(data, token) {
  const id = data.event.id
  const before = getEvent(state, id)?.online
  const ev = {
    id, name: data.event.name, date: data.event.date ?? '', numLaps: data.event.num_laps ?? 4,
    ...serverFormat(data.event),
    createdAt: getEvent(state, id)?.createdAt ?? nowMs(),
    online: { token, me: before?.token === token ? before.me ?? null : null, ...onlineFields(data) },
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
// The format as the server keeps it; none (an older race) means a beer mile
// with the server's lap count, so a stale local one must not linger.
function serverFormat(ev) {
  return { format: ev.oppsett?.points?.length ? normalise(ev.oppsett) : undefined }
}

export function mergeServer(eventId, data) {
  let changed = false
  if (!getEvent(state, eventId)) return
  const events = state.events.map((e) => {
    if (e.id !== eventId || !data.event) return e
    const next = {
      ...e, name: data.event.name, date: data.event.date ?? '', numLaps: data.event.num_laps ?? 4,
      ...serverFormat(data.event),
      online: { ...e.online, ...onlineFields(data) },
    }
    if (JSON.stringify(next) !== JSON.stringify(e)) { changed = true; return next }
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
    ? mergeList('runners', data.runners, fromServerRunner, ['bib', 'name', 'category', 'heatId', 'timer'])
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

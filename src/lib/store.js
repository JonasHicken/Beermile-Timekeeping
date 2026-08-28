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
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react'
import { nowMs } from './time.js'

const KEY = 'bmtk:v1'

const empty = () => ({ events: [], runners: [], heats: [], crossings: [] })

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const data = JSON.parse(raw)
    return { ...empty(), ...data }
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

// Cross-tab sync: another tab writing the same key updates us.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      state = load()
      listeners.forEach((l) => l())
    }
  })
}

const uid = () =>
  (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

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

export const crossingsInHeat = (s, heatId) =>
  s.crossings
    .filter((c) => c.heatId === heatId && !c.void)
    .sort((a, b) => a.capturedAt - b.capturedAt)

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
  commit({
    ...state,
    events: state.events.filter((e) => e.id !== id),
    runners: state.runners.filter((r) => r.eventId !== id),
    heats: state.heats.filter((h) => h.eventId !== id),
    crossings: state.crossings.filter((c) => c.eventId !== id),
  })
}

const newRunner = (eventId, { bib, name, category = '' }) => ({
  id: uid(),
  eventId,
  bib: String(bib).trim(),
  name: (name || '').trim(),
  category: (category || '').trim(),
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
  commit({
    ...state,
    runners: state.runners.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  })
}

export function setRunnerStatus(id, status) {
  updateRunner(id, { status })
}

export function setPenaltyLaps(id, n) {
  updateRunner(id, { penaltyLaps: Math.max(0, Math.min(9, n)) })
}

export function removeRunner(id) {
  commit({
    ...state,
    runners: state.runners.filter((r) => r.id !== id),
    crossings: state.crossings.filter((c) => c.runnerId !== id),
  })
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
  commit({
    ...state,
    heats: state.heats.map((h) => (h.id === id ? { ...h, ...patch } : h)),
  })
}

export function deleteHeat(id) {
  commit({
    ...state,
    heats: state.heats.filter((h) => h.id !== id),
    runners: state.runners.map((r) => (r.heatId === id ? { ...r, heatId: null } : r)),
    crossings: state.crossings.filter((c) => c.heatId !== id),
  })
}

export function assignRunner(runnerId, heatId) {
  updateRunner(runnerId, { heatId })
}

// Split all runners into heats of `size`, in bib order.
export function autoSplitHeats(eventId, size = 12) {
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
  runners.forEach((r, i) => {
    assignment[r.id] = newHeats[Math.floor(i / size)].id
  })
  commit({
    ...state,
    heats: [...heats, ...newHeats],
    runners: state.runners.map((r) =>
      r.eventId === eventId ? { ...r, heatId: assignment[r.id] ?? null } : r,
    ),
    crossings: state.crossings.filter((c) => c.eventId !== eventId),
  })
  return newHeats
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
  commit({
    ...state,
    heats: state.heats.map((h) =>
      h.id === heatId ? { ...h, status: 'pending', startedAt: null } : h,
    ),
    crossings: state.crossings.filter((c) => c.heatId !== heatId),
  })
}

// Record a crossing. Auto-computes the next lap from how many non-void
// crossings the runner already has. Returns null if they've completed all laps.
export function recordCrossing(heatId, runnerId, source = 'tap', at = nowMs()) {
  const heat = state.heats.find((h) => h.id === heatId)
  const event = state.events.find((e) => e.id === heat?.eventId)
  const runner = state.runners.find((r) => r.id === runnerId)
  const done = lapCount(state, heatId, runnerId)
  if (event && done >= requiredLaps(event, runner)) return null
  const c = {
    id: uid(),
    eventId: event?.id ?? null,
    heatId,
    runnerId,
    bib: runner?.bib ?? null,
    lap: done + 1,
    capturedAt: at,
    source, // 'tap' | 'rfid' | 'manual'
    rssi: null, // reserved for RFID
    void: false,
  }
  commit({ ...state, crossings: [...state.crossings, c] })
  return c
}

// Undo the most recent non-void crossing in a heat (or for one runner).
export function undoLastCrossing(heatId, runnerId = null) {
  const pool = state.crossings
    .filter((c) => c.heatId === heatId && !c.void && (!runnerId || c.runnerId === runnerId))
    .sort((a, b) => b.capturedAt - a.capturedAt)
  const last = pool[0]
  if (!last) return null
  commit({
    ...state,
    crossings: state.crossings.map((c) => (c.id === last.id ? { ...c, void: true } : c)),
  })
  return last
}

// ---- targeted corrections (the review screen) ------------------------------

export function setCrossingVoid(id, isVoid) {
  commit({
    ...state,
    crossings: state.crossings.map((c) => (c.id === id ? { ...c, void: isVoid } : c)),
  })
}

// Fix a mistap: move this crossing to a different runner.
export function reassignCrossing(id, runnerId) {
  const runner = state.runners.find((r) => r.id === runnerId)
  commit({
    ...state,
    crossings: state.crossings.map((c) =>
      c.id === id ? { ...c, runnerId, bib: runner?.bib ?? null, source: 'manual' } : c,
    ),
  })
}

export function setCrossingTime(id, capturedAt) {
  commit({
    ...state,
    crossings: state.crossings.map((c) =>
      c.id === id ? { ...c, capturedAt, source: 'manual' } : c,
    ),
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

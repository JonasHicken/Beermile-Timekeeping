// ---------------------------------------------------------------------------
// Keeping an online event in step with the server, and so with the other
// phones timing it.
//
// Every two seconds while an online event is open: send what this phone has
// queued (store.outbox), then fetch what changed. Both calls also tell us the
// server's time, which sets this phone's clock (time.js). Without a signal the
// loop just fails quietly and tries again; taps keep landing in the local store
// either way, so timing never waits for the network.
//
// Laps are fetched as "changed since rev N". Two phones' writes can commit in
// a different order from the revs they were given, so each fetch looks back a
// little, and every 30 seconds the phone fetches the whole log to be sure.
// The schema side is PART 18 of the main site's supabase/schema.sql.
// ---------------------------------------------------------------------------

import { useEffect, useSyncExternalStore } from 'react'
import { getSupabase } from './supabase.js'
import { noteServerTime } from './time.js'
import {
  getEvent, getState, pendingFor, ackSent, mergeServer, adoptOnlineEvent, DEVICE_ID,
} from './store.js'

const POLL_MS = 2000
const FULL_EVERY_MS = 30000
const LOOKBACK = 200

const revs = {} // eventId -> highest crossing rev seen
const lastFull = {}

// ---- status, for the little sync indicator ---------------------------------

let status = {} // eventId -> { ok: bool, at: ms, error: string|null, denied: bool }
const statusListeners = new Set()
function setStatus(eventId, patch) {
  status = { ...status, [eventId]: { ...status[eventId], ...patch } }
  statusListeners.forEach((l) => l())
}
export function useSyncStatus(eventId) {
  const all = useSyncExternalStore(
    (cb) => { statusListeners.add(cb); return () => statusListeners.delete(cb) },
    () => status,
  )
  return all[eventId] ?? null
}

// ---- calls -----------------------------------------------------------------

class TilgangFeil extends Error {}

async function rpc(name, args) {
  const sb = await getSupabase()
  if (!sb) throw new Error('supabase-not-configured')
  const sentAt = Date.now()
  const { data, error } = await sb.rpc(name, args)
  const receivedAt = Date.now()
  if (error) {
    if (error.hint === 'ingen_tilgang') throw new TilgangFeil(error.message)
    // The hint says what kind of refusal it was (e.g. 'opptatt': the bib is
    // taken, with the holder's name in detail), for the screen to act on.
    throw Object.assign(new Error(error.message), { hint: error.hint ?? null, detail: error.details ?? null })
  }
  if (data?.naa) noteServerTime(Number(data.naa), sentAt, receivedAt)
  return data
}

const toServerCrossing = (c) => ({
  id: c.id, heat_id: c.heatId, runner_id: c.runnerId, lap: c.lap,
  captured_at: Math.round(c.capturedAt), source: c.source, void: !!c.void, endret_ms: c.endretMs ?? 0,
})
const toServerHeat = (h) => ({
  id: h.id, status: h.status, started_at: h.startedAt == null ? null : Math.round(h.startedAt), endret_ms: h.endretMs ?? 0,
})
const toServerRunner = (r) => ({
  id: r.id, status: r.status ?? 'ok', straffe: r.penaltyLaps ?? 0, endret_ms: r.endretMs ?? 0,
})

// Opening a timing link. Throws TilgangFeil for a wrong or replaced link.
export async function joinWithLink(eventId, token) {
  const data = await rpc('tk_hent', { p_event: eventId, p_token: token, p_siden: 0 })
  if (!data?.event) throw new Error('not-found')
  revs[eventId] = maxRev(data.crossings, 0)
  lastFull[eventId] = Date.now()
  return adoptOnlineEvent(data, token)
}
export const isAccessError = (e) => e instanceof TilgangFeil

function maxRev(rows, start) {
  let m = start
  for (const r of rows || []) if (r.rev > m) m = r.rev
  return m
}

async function syncOnce(eventId) {
  const s = getState()
  const ev = getEvent(s, eventId)
  if (!ev?.online) return
  const token = ev.online.token

  const pending = pendingFor(s, eventId)
  if (pending.crossings.length || pending.heats.length || pending.runners.length) {
    await rpc('tk_send', {
      p_event: eventId, p_token: token, p_enhet: DEVICE_ID,
      p_crossings: pending.crossings.slice(0, 500).map(toServerCrossing),
      p_heats: pending.heats.map(toServerHeat),
      p_runners: pending.runners.map(toServerRunner),
      // Only to a server that knows about roles (it said so with `rolle`); an
      // older one would not recognise the parameter and refuse the call.
      ...(ev.online.role ? { p_tidtaker: ev.online.me ?? null } : {}),
    })
    ackSent({
      crossings: pending.crossings.slice(0, 500), heats: pending.heats, runners: pending.runners,
    })
  }

  const full = !revs[eventId] || Date.now() - (lastFull[eventId] ?? 0) > FULL_EVERY_MS
  const since = full ? 0 : Math.max(0, revs[eventId] - LOOKBACK)
  const data = await rpc('tk_hent', { p_event: eventId, p_token: token, p_siden: since })
  if (full) lastFull[eventId] = Date.now()
  revs[eventId] = maxRev(data.crossings, revs[eventId] ?? 0)
  mergeServer(eventId, data)
}

// The admin naming the timers and giving them runners. `names` (or null to
// keep the list) replaces the list; `assignment` is [{ runnerId, timer }].
// Needs a signal: it is desk work, and saying "not saved" beats a silent
// queue. The event is fetched in full afterwards so every screen shows it.
export class NotAdminError extends Error {}
export function saveTimers(eventId, { names = null, assignment = [] }) {
  return adminCall(eventId, 'tk_admin_tidtakere', {
    p_tidtakere: names,
    p_tildeling: assignment.map((a) => ({ runner_id: a.runnerId, tidtaker: a.timer ?? null })),
  })
}

// One of the admin link's race-day calls (tk_admin_* in PART 18): heats, late
// runners, bibs, timers. The server checks the admin token and does the work
// in the same functions the site uses; then the whole event is fetched, so the
// change shows here straight away (and on the other phones within seconds).
// Returns what the call returned. Needs a signal.
export async function adminCall(eventId, fn, args) {
  const ev = getEvent(getState(), eventId)
  if (!ev?.online) throw new Error('not-online')
  let result
  try {
    result = await rpc(fn, { p_event: eventId, p_token: ev.online.token, ...args })
  } catch (e) {
    if (e.hint === 'ikke_admin') throw new NotAdminError(e.message)
    throw e
  }
  await refresh(eventId)
  return result
}

async function refresh(eventId) {
  const ev = getEvent(getState(), eventId)
  const data = await rpc('tk_hent', { p_event: eventId, p_token: ev.online.token, p_siden: 0 })
  lastFull[eventId] = Date.now()
  revs[eventId] = maxRev(data.crossings, revs[eventId] ?? 0)
  mergeServer(eventId, data)
}

// The link to send to the timers, for the admin.
export function timerLink(event) {
  const t = event?.online?.timerToken
  return t ? `${window.location.origin}/join/${event.id}#${t}` : null
}

// ---- the loop --------------------------------------------------------------

const running = {} // eventId -> number of screens wanting it

function startLoop(eventId) {
  running[eventId] = (running[eventId] ?? 0) + 1
  if (running[eventId] > 1) return
  let timer = null
  let busy = false
  async function tick() {
    if (!running[eventId]) return
    if (!busy && document.visibilityState === 'visible') {
      busy = true
      try {
        await syncOnce(eventId)
        setStatus(eventId, { ok: true, at: Date.now(), error: null, denied: false })
      } catch (e) {
        setStatus(eventId, { ok: false, error: e.message, denied: e instanceof TilgangFeil })
      } finally {
        busy = false
      }
    }
    timer = setTimeout(tick, POLL_MS)
  }
  tick()
  // Straight away when the signal comes back or the screen is turned on,
  // rather than waiting out the interval.
  const kick = () => { clearTimeout(timer); tick() }
  window.addEventListener('online', kick)
  document.addEventListener('visibilitychange', kick)
  running[`${eventId}:stop`] = () => {
    clearTimeout(timer)
    window.removeEventListener('online', kick)
    document.removeEventListener('visibilitychange', kick)
  }
}

function stopLoop(eventId) {
  running[eventId] = (running[eventId] ?? 1) - 1
  if (running[eventId] > 0) return
  running[`${eventId}:stop`]?.()
  delete running[eventId]
  delete running[`${eventId}:stop`]
}

// Keeps the event in sync while the calling screen is mounted. A no-op for an
// event that only lives on this phone.
export function useOnlineSync(eventId, online) {
  useEffect(() => {
    if (!online) return undefined
    startLoop(eventId)
    return () => stopLoop(eventId)
  }, [eventId, online])
}

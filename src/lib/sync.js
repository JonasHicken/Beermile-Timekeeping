// ---------------------------------------------------------------------------
// Supabase sync — publishes the local timing snapshot up to Supabase so the
// public live page (on beermilenorge.no) can read it. This is a downstream
// MIRROR of the local-first store, never the system of record: the race runs
// entirely offline and syncs opportunistically.
//
// STATUS: publish path is written but gated on write access. The schema grants
// anon READ only (so the public page works with the publishable key), and no
// anon WRITE — exactly like the main site. To actually publish you need either:
//   (a) a service-role context (a tiny serverless publish step / the future
//       RFID bridge), or
//   (b) Supabase Auth in the app + operator-scoped write policies in schema.sql.
// Until then `publishSnapshot` will no-op-with-error against the anon key, which
// is the safe default. The READ + realtime helpers below work today.
// ---------------------------------------------------------------------------

import { getSupabase } from './supabase.js'

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString())

function mapEvent(e) {
  return { id: e.id, name: e.name, date: e.date, num_laps: e.numLaps, published: true, updated_at: new Date().toISOString() }
}
function mapRunner(r) {
  return { id: r.id, event_id: r.eventId, bib: r.bib, name: r.name, category: r.category, heat_id: r.heatId, epc: r.epc }
}
function mapHeat(h) {
  return { id: h.id, event_id: h.eventId, name: h.name, order: h.order, status: h.status, started_at: iso(h.startedAt) }
}
function mapCrossing(c) {
  return {
    id: c.id, event_id: c.eventId, heat_id: c.heatId, runner_id: c.runnerId,
    bib: c.bib, lap: c.lap, captured_at: iso(c.capturedAt), source: c.source,
    rssi: c.rssi ?? null, void: c.void,
  }
}

// Upsert a full event snapshot (from store.exportEvent). Idempotent — safe to
// call repeatedly while a heat runs to keep the public page fresh.
export async function publishSnapshot(snapshot) {
  const sb = await getSupabase()
  if (!sb) return { ok: false, error: 'supabase-not-configured' }
  try {
    const { event, runners, heats, crossings } = snapshot
    let r
    r = await sb.from('tk_events').upsert(mapEvent(event)); if (r.error) throw r.error
    if (runners.length) { r = await sb.from('tk_runners').upsert(runners.map(mapRunner)); if (r.error) throw r.error }
    if (heats.length) { r = await sb.from('tk_heats').upsert(heats.map(mapHeat)); if (r.error) throw r.error }
    if (crossings.length) { r = await sb.from('tk_crossings').upsert(crossings.map(mapCrossing)); if (r.error) throw r.error }
    return { ok: true }
  } catch (error) {
    // Most likely an RLS denial with the anon key — expected until write access
    // is wired up (see header). Surface it rather than pretending success.
    return { ok: false, error: error?.message || String(error) }
  }
}

// Public live page: read a published event's current state (works with anon key).
export async function fetchPublicEvent(eventId) {
  const sb = await getSupabase()
  if (!sb) return null
  const [ev, runners, heats, crossings] = await Promise.all([
    sb.from('tk_events').select('*').eq('id', eventId).maybeSingle(),
    sb.from('tk_runners').select('*').eq('event_id', eventId),
    sb.from('tk_heats').select('*').eq('event_id', eventId),
    sb.from('tk_crossings').select('*').eq('event_id', eventId).eq('void', false),
  ])
  if (ev.error || !ev.data) return null
  return { event: ev.data, runners: runners.data || [], heats: heats.data || [], crossings: crossings.data || [] }
}

// Public live page: subscribe to live changes (new crossings / heat starts).
export async function subscribeToEvent(eventId, onChange) {
  const sb = await getSupabase()
  if (!sb) return () => {}
  const channel = sb
    .channel(`tk-event-${eventId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tk_crossings', filter: `event_id=eq.${eventId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tk_heats', filter: `event_id=eq.${eventId}` }, onChange)
    .subscribe()
  return () => { sb.removeChannel(channel) }
}

import { t, plural } from '../lib/i18n.js'
import { useRef, useState } from 'react'
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useStore, getEvent, getState, runnersInEvent, heatsInEvent, roleOf, standings } from '../lib/store.js'
import { adminCall, useOnlineSync, NotAdminError } from '../lib/online.js'
import { DEFAULT_SETTINGS, GROUPS, groupOf, leastFull, planHeats, splitBetween } from '../lib/heats.js'
import { useConfirm } from '../components/Confirm.jsx'
import { useUndo } from '../components/Undo.jsx'
import BibAssign from '../components/BibAssign.jsx'
import TimerAssign from '../components/TimerAssign.jsx'
import SyncBadge from '../components/SyncBadge.jsx'
import RaceResults from '../components/RaceResults.jsx'
import TimerAutoAssign from '../components/TimerAutoAssign.jsx'
import RaceImport from '../components/RaceImport.jsx'
import { formatOf, describe, formatChangeWarning, splitLabel } from '../lib/eventFormat.js'
import RaceDetails from '../components/RaceDetails.jsx'

// Race day for a shared race, on the admin link: late runners, heats, bibs and
// timers. The race itself (sign-ups, links, results on the race page) is run
// from the race website; this is what happens at the start line. Every change
// is saved on the server at once (tk_admin_* in the site's schema, PART 18),
// reaches the timers' phones within seconds, and can be undone.


const TABS = [
  { id: 'setup', label: 'Setup' },
  { id: 'race', label: 'Race' },
  { id: 'timers', label: 'Timers' },
  { id: 'live', label: 'Live' },
  { id: 'results', label: 'Results' },
]
const GROUP_NAME = { women: 'Women', men: 'Men', relay: 'Relay teams', all: 'Everyone' }
const KINDS = [['kvinne', 'Woman'], ['mann', 'Man'], ['stafett', 'Relay team']]
const CATEGORY = { kvinne: 'Kvinner', mann: 'Menn', stafett: 'Stafett' }

const SETTINGS_KEY = (id) => `bmtk:heatplan:${id}`
function loadSettings(id) {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY(id)) || '{}') } } catch { return DEFAULT_SETTINGS }
}

export default function RaceAdmin() {
  const { eventId } = useParams()
  const event = useStore((s) => getEvent(s, eventId))
  const runners = useStore((s) => runnersInEvent(s, eventId))
  const heats = useStore((s) => heatsInEvent(s, eventId))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // { text, error }
  const [showBibs, setShowBibs] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editing, setEditing] = useState(null) // runner id
  // The tab is in the address (?tab=live), so coming back from timing a heat
  // lands where you were. With none given: Results once every heat is done,
  // Live while one is running, else Setup.
  const [search, setSearch] = useSearchParams()
  const asked = search.get('tab')
  const tab = TABS.some((t) => t.id === asked) ? asked : (() => {
    const hs = heatsInEvent(getState(), eventId)
    if (hs.length > 0 && hs.every((h) => h.status === 'done')) return 'results'
    if (hs.some((h) => h.status === 'running')) return 'live'
    return 'setup'
  })()
  const setTab = (id) => { setSearch({ tab: id }, { replace: true }); window.scrollTo(0, 0) }
  const [settings, setSettingsState] = useState(() => loadSettings(eventId))
  const [confirmNode, askConfirm] = useConfirm()
  const [undoNode, offerUndo] = useUndo()
  const noteTimer = useRef(null)
  useOnlineSync(eventId, Boolean(event?.online))

  if (!event || roleOf(event) !== 'admin') {
    return (
      <div className="app">
        <Link to={`/event/${eventId}/setup`} className="backlink">{t('← Setup')}</Link>
        <div className="empty">
          <div className="display">{t('Admin only')}</div>
          {t('Race admin opens with the race’s admin link, from the race website.')}
        </div>
      </div>
    )
  }

  function say(text, error = false) {
    setNote({ text, error })
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setNote(null), error ? 6000 : 2500)
  }
  function setSettings(change) {
    setSettingsState((s) => {
      const next = { ...s, ...change }
      try { localStorage.setItem(SETTINGS_KEY(eventId), JSON.stringify(next)) } catch { /* not remembered */ }
      return next
    })
  }

  // Runs a server call; returns its result, or undefined after saying why not.
  async function call(fn, args) {
    setBusy(true)
    try { return await adminCall(eventId, fn, args) }
    catch (e) {
      say(e instanceof NotAdminError ? t('Only the admin link can do this.')
        : /fetch|network|Failed/i.test(e.message) ? t('Not saved: no signal. Try again.') : e.message, true)
      return undefined
    } finally { setBusy(false) }
  }
  const undoable = (label, fn) => offerUndo(label, async () => { await fn() })

  // ---- the heats as they are ----
  const per = Math.max(1, Number(settings.perHeat) || 8)
  const heatOf = (r) => heats.find((h) => h.id === r.heatId) ?? null
  const nrOf = (r) => { const h = heatOf(r); return h ? h.order + 1 : null }
  const locked = (r) => { const h = heatOf(r); return Boolean(h) && h.status !== 'pending' }
  const countIn = (h) => runners.filter((r) => r.heatId === h.id).length
  const openHeats = heats.filter((h) => h.status === 'pending')
  const newNr = (heats.length ? Math.max(...heats.map((h) => h.order)) + 1 : 0) + 1
  const noHeat = runners.filter((r) => !r.heatId)
  const groupOfHeat = (h) => {
    const g = new Set(runners.filter((r) => r.heatId === h.id).map((r) => groupOf(r.category, settings)))
    return g.size === 1 ? [...g][0] : null
  }
  const countsNow = () => Object.fromEntries(openHeats.map((h) => [h.order + 1, { n: countIn(h), group: groupOfHeat(h) }]))
  const suggestFor = (category) => (heats.length ? leastFull(countsNow(), groupOf(category, settings), per) ?? newNr : null)
  const where = (nr) => (nr ? `${t('heat')} ${nr}` : t('no heat'))

  // [{ runner_id, heat }]; undo puts the same runners back where they were.
  async function place(assignment, label) {
    const before = assignment.map((a) => ({ runner_id: a.runner_id, heat: nrOf(runners.find((r) => r.id === a.runner_id)) }))
    if (await call('tk_admin_fordel_heat', { p_fordeling: assignment }) === undefined) return
    undoable(label, () => call('tk_admin_fordel_heat', { p_fordeling: before }))
  }

  const move = (r, nr) => place([{ runner_id: r.id, heat: nr }], `${r.bib} ${r.name} → ${where(nr)}`)

  function placeWithoutHeat() {
    const counts = countsNow()
    let next = newNr
    const assignment = noHeat.map((r) => {
      const g = groupOf(r.category, settings)
      const nr = leastFull(counts, g, per) ?? next++
      counts[nr] = { n: (counts[nr]?.n ?? 0) + 1, group: g }
      return { runner_id: r.id, heat: nr }
    })
    place(assignment, t('Placed {n}', { n: plural(assignment.length, 'runner') }))
  }

  // The builder: everyone not in a started heat, numbered after the last
  // heat that has started. The preview is exactly what is saved.
  const free = runners.filter((r) => !locked(r))
  const first = heats.filter((h) => h.status !== 'pending').reduce((m, h) => Math.max(m, h.order + 1), 0) + 1
  const plan = planHeats(free, settings, per, first)
  const planGroups = plan.reduce((a, h) => (a.includes(h.group) ? a : [...a, h.group]), [])
  function moveGroup(g, step) {
    const order = [...planGroups]
    const i = order.indexOf(g)
    ;[order[i], order[i + step]] = [order[i + step], order[i]]
    setSettings({ order: [...order, ...GROUPS.filter((x) => !order.includes(x))] })
  }
  function makeHeats() {
    const run = () => place(plan.flatMap((h) => h.runners.map((r) => ({ runner_id: r.id, heat: h.nr }))),
      t('{n} in {h}', { n: plural(free.length, 'runner'), h: plural(plan.length, 'heat') }))
    if (!heats.some((h) => h.status === 'pending' && countIn(h))) { run(); return }
    askConfirm({
      title: t('Make {n}?', { n: plural(plan.length, 'heat') }),
      body: t('Replaces the heats that have not started with this plan. Heats that have started stay as they are. You can undo it straight after.'),
      confirmLabel: t('Make heats'),
      onConfirm: run,
    })
  }

  // ---- runners ----
  async function add(f) {
    const res = await call('tk_admin_legg_til_loper', {
      p_klasse: f.kind === 'stafett' ? 'stafett' : 'individuell', p_navn: f.name,
      p_kjonn: f.kind === 'stafett' ? null : f.kind, p_lagnavn: f.team || null, p_partner_navn: f.partner || null,
      p_heat: f.heat || null,
      p_startnummer: f.bib ? Number(f.bib) : null,
    })
    if (res === undefined) return false
    const bib = String(res.ny_bib ?? '')
    // The server falls back to the next free bib when the one asked for turned
    // out to be taken (by a sign-up not in the start list yet, say): say so.
    if (f.bib && bib !== String(Number(f.bib))) say(t('Bib {bib} was taken, so they got {got}. Tap the bib in the start list to change it.', { bib: f.bib, got: bib }), true)
    undoable(`${t('Added')} ${bib} ${f.kind === 'stafett' ? f.team : f.name} · ${where(f.heat)}`, async () => {
      // Looked up when undone: the list has been fetched again since.
      const r = runnersInEvent(getState(), eventId).find((x) => x.bib === bib)
      if (r) await call('tk_admin_fjern_loper', { p_runner_id: r.id })
    })
    return true
  }

  async function remove(r) {
    const res = await call('tk_admin_fjern_loper', { p_runner_id: r.id })
    if (res === undefined) return
    const p = res.fjernet
    if (!p) return
    undoable(`${t('Removed')} ${r.bib} ${r.name}`, async () => {
      const back = {
        p_klasse: p.klasse, p_navn: p.navn, p_kjonn: p.kjonn, p_lagnavn: p.lagnavn, p_partner_navn: p.partner_navn,
        p_startnummer: p.startnummer,
      }
      // Back in the same heat if it still has not started, else without one.
      if (await call('tk_admin_legg_til_loper', { ...back, p_heat: res.fjernet_heat ?? null }) === undefined) {
        await call('tk_admin_legg_til_loper', { ...back, p_heat: null })
      }
    })
  }
  const askRemove = (r) => askConfirm({
    title: t('Remove {name}?', { name: r.name || `${t('bib')} ${r.bib}` }),
    body: t('Takes them off the start list and the sign-ups. Someone who has run a lap can’t be removed: mark them DNS or DNF instead. You can undo it straight after.'),
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: () => remove(r),
  })

  // A start list from a file: every row in one call, each added like
  // "Add a runner". Undo removes the ones added, by bib.
  async function importRows(list) {
    const res = await call('tk_admin_importer_lopere', { p_rader: list.map((x) => x.signup) })
    if (res === undefined) return
    setShowImport(false)
    const added = res.lagt_til ?? []
    const skipped = res.hoppet_over ?? []
    const moved = added.filter((a) => {
      const asked = list[a.rad - 1]?.signup.startnummer
      return asked != null && String(asked) !== String(a.bib)
    }).length
    say([
      t('Added {n}.', { n: plural(added.length, 'runner') }),
      skipped.length ? t('{n} not added: {why}.', { n: skipped.length, why: [...new Set(skipped.map((x) => (/allerede påmeldt/.test(x.grunn) ? t('name already in the race') : x.grunn)))].slice(0, 2).join('; ') }) : '',
      moved ? t('{n} got another bib than in the file.', { n: moved }) : '',
    ].filter(Boolean).join(' '), skipped.length > 0)
    if (!added.length) return
    undoable(t('Imported {n}', { n: plural(added.length, 'runner') }), async () => {
      const r = await call('tk_admin_fjern_lopere', { p_bibs: added.map((a) => String(a.bib)) })
      if (r?.beholdt) say(t('{n} kept: they have run a lap since.', { n: r.beholdt }), true)
    })
  }

  // ---- the event: what is timed, and where ----
  // Every result is worked out from the timing points, so once laps are
  // recorded a change in how many there are moves every result: it asks
  // first. Every change can be undone.
  function changeFormat(f) {
    const was = formatOf(event)
    const save = async () => {
      if (await call('tk_admin_sett_format', { p_oppsett: f }) === undefined) return false
      undoable(`${t('Event')}: ${describe(f)}`, () => call('tk_admin_sett_format', { p_oppsett: was }))
      return true
    }
    const timed = getState().crossings.some((c) => c.eventId === eventId && !c.void)
    if (!timed || f.points.length === was.points.length) return save()
    askConfirm({
      title: t('Change to {n}?', { n: plural(f.points.length, 'timing point') }),
      body: formatChangeWarning(was.points.length, f.points.length, standings(getState(), eventId).finishers.length) +
        ' ' + t('Every phone and the race page change with it.'),
      confirmLabel: t('Change'),
      danger: true,
      onConfirm: save,
    })
    return false
  }

  // ---- a runner's name and class ----
  async function rename(r, to) {
    const from = r.name
    if (!to || to === from) return true
    if (await call('tk_admin_rett_loper', { p_runner_id: r.id, p_navn: to }) === undefined) return false
    undoable(`${t('Name')}: ${to}`, () => call('tk_admin_rett_loper', { p_runner_id: r.id, p_navn: from }))
    return true
  }
  async function reclass(r, kjonn) {
    const from = r.category === 'Kvinner' ? 'kvinne' : 'mann'
    if (kjonn === from) return true
    if (await call('tk_admin_rett_loper', { p_runner_id: r.id, p_kjonn: kjonn }) === undefined) return false
    undoable(`${r.name}: ${kjonn === 'kvinne' ? t('Women') : t('Men')}`, () => call('tk_admin_rett_loper', { p_runner_id: r.id, p_kjonn: from }))
    return true
  }

  // ---- bibs ----
  async function changeBib(r) {
    const input = window.prompt(t('New bib for {name}:', { name: r.name || r.bib }), r.bib)
    if (input == null) return
    const to = Number(String(input).trim())
    const from = Number(r.bib)
    if (!Number.isInteger(to) || to < 1 || to > 9999) { say(t('A bib is a number from 1 to 9999.'), true); return }
    if (to === from) return
    const set = async (swap) => {
      setBusy(true)
      try {
        await adminCall(eventId, 'tk_admin_sett_startnummer', { p_fra: from, p_til: to, p_bytt: swap })
        undoable(`${r.name}: ${from} → ${to}${swap ? ` (${t('swapped')})` : ''}`,
          () => call('tk_admin_sett_startnummer', { p_fra: to, p_til: from, p_bytt: swap }))
      } catch (e) {
        if (e.hint === 'opptatt' && !swap) {
          askConfirm({
            title: t('Bib {bib} is taken', { bib: to }),
            body: t('{name} has {to}. Swap, so they get {from}?', { name: e.detail || t('Someone else'), to, from }),
            confirmLabel: 'Swap',
            onConfirm: () => set(true),
          })
        } else say(e.message, true)
      } finally { setBusy(false) }
    }
    set(false)
  }

  async function applyBibs(changes) {
    const mapping = changes.map((c) => ({ fra: Number(c.from), til: Number(c.to) }))
    if (await call('tk_admin_tildel_startnummer', { p_tildeling: mapping }) === undefined) return
    setShowBibs(false)
    undoable(t('New bibs for {n}', { n: plural(mapping.length, 'runner') }),
      () => call('tk_admin_tildel_startnummer', { p_tildeling: mapping.map((m) => ({ fra: m.til, til: m.fra })) }))
  }

  // ---- timers: who times whom, per runner ----
  const timerNames = event.online.timers ?? []
  async function giveTimer(list, assignment, label) {
    const before = list.map((r) => ({ runner_id: r.id, tidtaker: r.timer ?? null }))
    if (await call('tk_admin_tidtakere', { p_tildeling: assignment }) === undefined) return
    undoable(label, () => call('tk_admin_tidtakere', { p_tildeling: before }))
  }
  const setTimer = (r, timer) => giveTimer([r], [{ runner_id: r.id, tidtaker: timer || null }], `${r.bib} → ${timer || t('no timer')}`)
  function splitTimers(title, list) {
    if (!timerNames.length || !list.length) return
    const assignment = splitBetween(list, timerNames).map((x) => ({ runner_id: x.runner.id, tidtaker: x.timer }))
    giveTimer(list, assignment, t('{what} split between {n}', { what: title, n: plural(timerNames.length, 'timer') }))
  }

  const sections = [
    ...(noHeat.length ? [{ key: 'none', name: t('No heat'), title: `${t('No heat')} · ${noHeat.length}`, list: noHeat, warn: heats.length > 0 }] : []),
    ...heats.map((h) => ({
      key: h.id,
      name: h.name,
      title: [h.name, groupOfHeat(h) && t(GROUP_NAME[groupOfHeat(h)]), h.status === 'running' ? t('running') : h.status === 'done' ? t('done') : null, plural(countIn(h), 'runner')].filter(Boolean).join(' · '),
      list: runners.filter((r) => r.heatId === h.id),
      started: h.status !== 'pending',
    })),
  ]

  // What is left before the start, at a glance; each line jumps to its place.
  const noTimer = runners.filter((r) => r.heatId && !r.timer).length
  const todo = [
    { ok: runners.length > 0 && noHeat.length === 0, go: 'race',
      text: !runners.length ? t('No runners yet') : noHeat.length ? t('{n} without a heat', { n: plural(noHeat.length, 'runner') }) : t('Everyone is in a heat') },
    { ok: timerNames.length > 0, go: 'timers',
      text: timerNames.length ? `${plural(timerNames.length, 'timer')}: ${timerNames.join(', ')}` : t('No timers added yet') },
    { ok: timerNames.length > 0 && noTimer === 0, go: 'timers',
      text: noTimer ? t('{n} without a timer (only you can time them)', { n: plural(noTimer, 'runner') }) : t('Every runner has a timer') },
  ]

  return (
    <div className="app">
      <div className="topbar">
        <Link to={`/event/${eventId}/setup`} className="backlink">{t('← Setup')}</Link>
        <div className="spacer" />
        <SyncBadge eventId={eventId} />
      </div>
      <h1 style={{ margin: 0, fontSize: 26 }}>{t('Race admin')}</h1>
      <div className="muted tiny">{event.name} · {plural(runners.length, 'runner')} · {plural(heats.length, 'heat')}</div>

      <div className="chips admin-tabs" role="tablist" style={{ marginTop: 12 }}>
        {TABS.map((tb) => (
          <button key={tb.id} role="tab" aria-selected={tab === tb.id} className={`chip${tab === tb.id ? ' on' : ''}`} onClick={() => setTab(tb.id)}>
            {t(tb.label)}
            {tb.id === 'live' && heats.some((h) => h.status === 'running') && <span className="chip-dot" />}
          </button>
        ))}
      </div>

      {/* ---- Setup: the race itself and what is left before the start ---- */}
      {tab === 'setup' && <>
        <div className="card stack" style={{ marginTop: 14, gap: 6 }}>
          {todo.map((x) => (
            <button key={x.text} className="todo-row" onClick={() => setTab(x.go)}>
              <span className={`todo-mark${x.ok ? ' ok' : ''}`} aria-hidden>{x.ok ? '✓' : '!'}</span>
              <span className="grow">{x.text}</span>
              <span className="muted tiny">{t(TABS.find((tb) => tb.id === x.go)?.label ?? "")} ›</span>
            </button>
          ))}
        </div>
        <h2 className="admin-h">{t('Race')}</h2>
        <RaceDetails event={event} busy={busy} call={call} undoable={undoable} onFormat={changeFormat} />
      </>}

      {/* ---- Race: the start list, names, bibs and heats ---- */}
      {tab === 'race' && <>
        <h2 className="admin-h">{t('Heats')}</h2>
        {runners.length > 0 ? (
          <div className="card stack" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 14 }}>
              <label className="row" style={{ gap: 8 }}>
                {t('Max per heat')}
                <input type="number" min="1" max="40" inputMode="numeric" value={settings.perHeat}
                  onChange={(e) => setSettings({ perHeat: e.target.value })} style={{ width: 70 }} />
              </label>
              <Check checked={settings.byGender} onChange={(v) => setSettings({ byGender: v })}>{t('Women and men apart')}</Check>
              <Check checked={settings.relayApart} onChange={(v) => setSettings({ relayApart: v })}>{t('Relay teams apart')}</Check>
            </div>
            {plan.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                {planGroups.map((g, i) => {
                  const hs = plan.filter((h) => h.group === g)
                  return (
                    <div key={g} className="row" style={{ gap: 8 }}>
                      {planGroups.length > 1 && (
                        <span className="row" style={{ gap: 2 }}>
                          <button className="btn ghost sm" disabled={i === 0} onClick={() => moveGroup(g, -1)} aria-label={t('Move {name} earlier', { name: t(GROUP_NAME[g]) })}>▲</button>
                          <button className="btn ghost sm" disabled={i === planGroups.length - 1} onClick={() => moveGroup(g, 1)} aria-label={t('Move {name} later', { name: t(GROUP_NAME[g]) })}>▼</button>
                        </span>
                      )}
                      <strong style={{ minWidth: 90 }}>{t(GROUP_NAME[g])}</strong>
                      <span className="muted">
                        {hs.length === 1 ? `${t('heat')} ${hs[0].nr} · ${hs[0].runners.length}` : `${t('heats')} ${hs[0].nr}–${hs[hs.length - 1].nr} · ${hs.map((h) => h.runners.length).join(' + ')}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            <button className={`btn${heats.length ? '' : ' primary'}`} disabled={busy || !plan.length} onClick={makeHeats}>
              {heats.length ? t('Remake as {n}', { n: plural(plan.length, 'heat') }) : t('Make {n}', { n: plural(plan.length, 'heat') })}
            </button>
            {noHeat.length > 0 && heats.length > 0 && (
              <button className="btn primary" disabled={busy} onClick={placeWithoutHeat}>{t('Place {n} without a heat', { n: noHeat.length })}</button>
            )}
            <div className="muted tiny">{t('Heats that have started are left alone. A relay team takes one place.')}</div>
          </div>
        ) : (
          <div className="muted">{t('No runners yet. Import a list or add runners below, or fetch the sign-ups in Setup.')}</div>
        )}

        <div className="row" style={{ alignItems: 'baseline' }}>
          <h2 className="admin-h grow">{t('Start list')}</h2>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn ghost sm" disabled={busy} onClick={() => setShowImport(true)}>{t('Import')}</button>
            <button className="btn ghost sm" onClick={() => setShowBibs(!showBibs)} aria-expanded={showBibs}>{t('Assign bibs')}</button>
          </span>
        </div>
        {showBibs && <BibAssign eventId={eventId} runners={runners} onClose={() => setShowBibs(false)} onApply={applyBibs} />}
        <div className="muted tiny">{t('Tap a bib or a name to change it. Every change reaches the timers’ phones within seconds and can be undone.')}</div>

        <button className="btn block" style={{ marginTop: 10 }} onClick={() => setShowAdd(!showAdd)} aria-expanded={showAdd}>
          {showAdd ? t('Close') : t('+ Add a runner')}
        </button>
        {showAdd && <AddRunner busy={busy} openHeats={openHeats} countIn={countIn} newNr={newNr} suggestFor={suggestFor} onAdd={add}
          takenBibs={new Set(runners.map((r) => String(Number(r.bib))))} />}

        <div className="stack" style={{ marginTop: 14, gap: 18 }}>
          {sections.map((s) => (
            <div key={s.key}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: s.warn ? 'var(--red)' : s.started ? 'var(--muted)' : 'var(--amber)' }}>{s.title}</div>
              {s.warn && <div className="muted tiny">{t('Not timed until they are in a heat.')}</div>}
              {s.list.map((r) => (
                <div key={r.id} className="admin-row">
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn ghost sm" style={{ minWidth: 56, borderStyle: 'dashed' }} disabled={busy}
                      onClick={() => changeBib(r)} aria-label={t('Change bib {bib}', { bib: r.bib })}>{r.bib}</button>
                    <button className="runner-name grow" disabled={busy} onClick={() => setEditing(editing === r.id ? null : r.id)}
                      aria-expanded={editing === r.id} aria-label={t('Edit {name}', { name: r.name })}>
                      {r.name}<span className="muted tiny"> · {r.category}</span>
                    </button>
                    {/* A runner in a heat that has started stays: their laps belong to it. */}
                    {!locked(r) && (
                      <button className="t-more" disabled={busy} onClick={() => askRemove(r)} aria-label={t('Remove {name}', { name: r.name })}>✕</button>
                    )}
                  </div>
                  {editing === r.id && (
                    <RunnerEdit runner={r} busy={busy} onClose={() => setEditing(null)}
                      onSave={async (name, kjonn) => {
                        if (await rename(r, name) && (kjonn == null || await reclass(r, kjonn))) setEditing(null)
                      }} />
                  )}
                  {!locked(r) && (
                    <select style={{ marginTop: 6, width: '100%' }} value={nrOf(r) ?? ''} disabled={busy}
                      onChange={(e) => move(r, e.target.value ? Number(e.target.value) : null)} aria-label={t('Heat for {name}', { name: r.name })}>
                      <option value="">{t('No heat')}</option>
                      {openHeats.map((h) => <option key={h.id} value={h.order + 1}>{h.name} ({countIn(h)})</option>)}
                      <option value={newNr}>{t('New heat {n}', { n: newNr })}</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </>}

      {/* ---- Timers: who the timers are, and who times whom ---- */}
      {tab === 'timers' && <>
        <h2 className="admin-h">{t('Timers')}</h2>
        <TimerAssign event={event} runners={runners} offerUndo={offerUndo} />
        {formatOf(event).mode === 'points' && formatOf(event).points.length > 1 && timerNames.length > 0 && (
          <TimerStations event={event} names={timerNames} busy={busy} call={call} undoable={undoable} />
        )}
        {timerNames.length > 0 && (
          <TimerAutoAssign eventId={eventId} timers={timerNames} busy={busy} onApply={giveTimer}
            heats={openHeats.map((h) => ({ id: h.id, name: h.name, runners: runners.filter((r) => r.heatId === h.id) })).filter((h) => h.runners.length)} />
        )}
        <h2 className="admin-h">{t('Who times whom')}</h2>
        {!timerNames.length ? (
          <div className="muted">{t('Add timers above first. Until then only you can time the runners.')}</div>
        ) : !runners.length ? (
          <div className="muted">{t('No runners yet: add them in the Race tab.')}</div>
        ) : (
          <div className="stack" style={{ gap: 18 }}>
            {sections.map((s) => (
              <div key={s.key}>
                <div className="row" style={{ alignItems: 'baseline', marginBottom: 4 }}>
                  <div className="grow" style={{ fontWeight: 700, color: s.started ? 'var(--muted)' : 'var(--amber)' }}>{s.title}</div>
                  {/* Not on a heat under way: moving everyone at once would drop
                      taps the timers have not sent yet. One runner can still move. */}
                  {s.list.length > 0 && s.key !== 'none' && !s.started && (
                    <button className="btn ghost sm" disabled={busy} onClick={() => splitTimers(s.name, s.list)}>{t('Split between timers')}</button>
                  )}
                </div>
                {s.list.map((r) => (
                  <div key={r.id} className="admin-row row" style={{ gap: 8 }}>
                    <span style={{ minWidth: 44, fontWeight: 700 }}>{r.bib}</span>
                    <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <select className={r.timer ? '' : 'unset'} value={r.timer ?? ''} disabled={busy}
                      onChange={(e) => setTimer(r, e.target.value)} aria-label={t('Timer for {name}', { name: r.name })} style={{ flex: '0 0 130px' }}>
                      <option value="">{t('No timer')}</option>
                      {timerNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </>}

      {/* ---- Live: start the heats and time them ---- */}
      {tab === 'live' && <LiveTab eventId={eventId} heats={heats} runners={runners} timerNames={timerNames} />}

      {tab === 'results' && <RaceResults event={event} askConfirm={askConfirm} offerUndo={offerUndo} />}

      {showImport && <RaceImport runners={runners} busy={busy} onClose={() => setShowImport(false)} onImport={importRows} />}
      {confirmNode}
      {undoNode}
      {note && <div className="toast" role="status"><span>{note.text}</span></div>}
    </div>
  )
}

// A runner's name and class, edited in the start list. A relay team keeps its
// class; its name is written "Team (Runner og Runner)".
function RunnerEdit({ runner, busy, onSave, onClose }) {
  const relay = runner.category === 'Stafett'
  const [name, setName] = useState(runner.name)
  const [kjonn, setKjonn] = useState(runner.category === 'Kvinner' ? 'kvinne' : 'mann')
  const n = name.trim()
  return (
    <div className="stack" style={{ gap: 8, marginTop: 8, padding: '8px 0' }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="grow" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} aria-label={t('Name')} style={{ minWidth: 0 }} />
        {!relay && (
          <select value={kjonn} onChange={(e) => setKjonn(e.target.value)} aria-label={t('Class')} style={{ flex: '0 0 110px' }}>
            <option value="kvinne">{t('Women')}</option>
            <option value="mann">{t('Men')}</option>
          </select>
        )}
      </div>
      {relay && <div className="muted tiny">A relay team is written “Team (Runner og Runner)”.</div>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn ghost grow" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary grow" disabled={busy || !n} onClick={() => onSave(n, relay ? null : kjonn)}>{t('Save')}</button>
      </div>
    </div>
  )
}

// Live: every heat with its state and one button to start or time it. Timing
// itself is the full-screen timing view; its back link returns here.
function LiveTab({ eventId, heats, runners, timerNames }) {
  const nav = useNavigate()
  const running = heats.find((h) => h.status === 'running')
  const next = heats.find((h) => h.status === 'pending' && runners.some((r) => r.heatId === h.id))
  const go = running || next
  const STATE = { pending: 'Not started', running: 'Running', done: 'Finished' }
  return (
    <div className="stack" style={{ marginTop: 14, gap: 12 }}>
      {!heats.length ? (
        <div className="muted">{t('No heats yet: make them in the Race tab.')}</div>
      ) : (
        <>
          {go && (
            <button className="btn primary lg block" onClick={() => nav(`/event/${eventId}/heat/${go.id}`)}>
              {running ? t('Time {name}', { name: running.name }) : t('Open {name} to start it', { name: next.name })}
            </button>
          )}
          <div className="stack" style={{ gap: 0 }}>
            {heats.map((h) => {
              const list = runners.filter((r) => r.heatId === h.id)
              const noTimer = timerNames.length ? list.filter((r) => !r.timer).length : 0
              return (
                <button key={h.id} className="admin-row row live-heat" onClick={() => nav(`/event/${eventId}/heat/${h.id}`)}>
                  <strong style={{ minWidth: 70, textAlign: 'left' }}>{h.name}</strong>
                  <span className="grow muted tiny" style={{ textAlign: 'left' }}>
                    {plural(list.length, 'runner')}{noTimer ? ` · ${t('{n} without a timer', { n: noTimer })}` : ''}
                  </span>
                  <span className={`pill${h.status === 'running' ? ' live' : ''}`}>{t(STATE[h.status] ?? h.status)}</span>
                  <span className="muted" aria-hidden>›</span>
                </button>
              )
            })}
          </div>
          <div className="muted tiny">{t('Only you can start and finish a heat. Timers tap their own runners from their link.')}</div>
        </>
      )}
      <button className="btn ghost block" onClick={() => nav(`/event/${eventId}/live`)}>{t('Live results')}</button>
    </div>
  )
}

function Check({ checked, onChange, children }) {
  return (
    <label className="row" style={{ gap: 8 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, flex: 'none', margin: 0, accentColor: 'var(--amber)' }} />
      {children}
    </label>
  )
}

function AddRunner({ busy, openHeats, countIn, newNr, suggestFor, onAdd, takenBibs }) {
  const [kind, setKind] = useState('kvinne')
  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const [partner, setPartner] = useState('')
  const [heatChoice, setHeatChoice] = useState(null) // null = follow the suggestion
  const [bib, setBib] = useState('') // empty = the next free bib
  const relay = kind === 'stafett'
  const bibNr = bib ? Number(bib) : null
  const bibError = bibNr == null ? null
    : bibNr < 1 || bibNr > 9999 ? t('A bib is a number from 1 to 9999.')
      : takenBibs.has(String(bibNr)) ? t('Bib {bib} is already taken.', { bib: bibNr }) : null
  const heat = heatChoice === null ? suggestFor(CATEGORY[kind]) : heatChoice
  const ready = name.trim() && (!relay || (team.trim() && partner.trim())) && !bibError

  async function submit(e) {
    e.preventDefault()
    if (!ready || busy) return
    // Kept on failure, so a refused name can be corrected instead of retyped.
    if (await onAdd({ kind, name: name.trim(), team: team.trim(), partner: partner.trim(), heat: heat || null, bib: bibNr })) {
      setName(''); setTeam(''); setPartner(''); setHeatChoice(null); setBib('')
    }
  }

  return (
    <form className="card stack" style={{ marginTop: 10, gap: 10 }} onSubmit={submit}>
      <div className="muted tiny">{t('For someone who did not sign up. They get a sign-up on the race page too, and the next free bib unless you give one.')}</div>
      <div className="row wrap" style={{ gap: 6 }} role="radiogroup" aria-label={t('Class')}>
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{t(label)}</button>
        ))}
      </div>
      {relay && <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder={t('Team name')} aria-label={t('Team name')} maxLength={60} />}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={relay ? t('Runner 1') : t('Name')} aria-label={relay ? t('Runner 1') : t('Name')} maxLength={100} autoComplete="off" />
      {relay && <input value={partner} onChange={(e) => setPartner(e.target.value)} placeholder={t('Runner 2')} aria-label={t('Runner 2')} maxLength={100} autoComplete="off" />}
      <input value={bib} onChange={(e) => setBib(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric"
        placeholder={t('Bib (empty: the next free one)')} aria-label={t('Bib')} autoComplete="off" />
      {bibError && <div className="form-error">{bibError}</div>}
      <select value={heat || ''} onChange={(e) => setHeatChoice(e.target.value ? Number(e.target.value) : 0)} aria-label={t('Heat')}>
        <option value="">{t('No heat')}</option>
        {openHeats.map((h) => <option key={h.id} value={h.order + 1}>{h.name} ({countIn(h)})</option>)}
        <option value={newNr}>{t('New heat {n}', { n: newNr })}</option>
      </select>
      <button className="btn primary" type="submit" disabled={!ready || busy}>{t('Add')}</button>
    </form>
  )
}

// Timer teams at timing points, for a course timed at points of its own
// (5000 m with teams at 1500, 3000 and the finish). A timer placed at a point
// taps every runner passing it; one left on "Own runners" times the runners
// given to them below. Saved at once, with Undo.
function TimerStations({ event, names, busy, call, undoable }) {
  const format = formatOf(event)
  const map = event.online.stations ?? {}
  const label = (p) => (p == null ? t('Own runners') : splitLabel(format, p))
  async function set(name, value) {
    const was = map[name] ?? null
    const to = value === '' ? null : Number(value)
    const res = await call('tk_admin_sett_stasjoner', { p_stasjoner: { [name]: to } })
    if (res === undefined) return
    undoable(`${name}: ${label(to)}`, () => call('tk_admin_sett_stasjoner', { p_stasjoner: { [name]: was } }))
  }
  const unplaced = format.points.map((_, i) => i).filter((i) => !Object.values(map).includes(i))
  return (
    <>
      <h2 className="admin-h">{t('Timing points')}</h2>
      <div className="card stack" style={{ gap: 8 }}>
        <div className="muted tiny">{t('Place a timer at a timing point and they tap every runner passing it, there only. Several timers can share a point. A timer left on “Own runners” times the runners given to them below.')}</div>
        {names.map((n) => (
          <div key={n} className="admin-row row" style={{ gap: 8 }}>
            <span className="grow" style={{ fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n}</span>
            <select value={map[n] ?? ''} disabled={busy} onChange={(e) => set(n, e.target.value)}
              aria-label={t('Timing point for {name}', { name: n })} style={{ flex: '0 0 150px' }}>
              <option value="">{t('Own runners')}</option>
              {format.points.map((m, i) => <option key={i} value={i}>{splitLabel(format, i)}</option>)}
            </select>
          </div>
        ))}
        {Object.keys(map).length > 0 && unplaced.length > 0 && (
          <div className="muted tiny">{t('No timer at {points}: only taps from you or a timer’s own runners land there.', { points: unplaced.map((i) => splitLabel(format, i)).join(', ') })}</div>
        )}
      </div>
    </>
  )
}

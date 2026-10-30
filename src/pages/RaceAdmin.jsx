import { useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useStore, getEvent, getState, runnersInEvent, heatsInEvent, roleOf } from '../lib/store.js'
import { adminCall, useOnlineSync, NotAdminError } from '../lib/online.js'
import { DEFAULT_SETTINGS, GROUPS, groupOf, leastFull, planHeats, splitBetween } from '../lib/heats.js'
import { useConfirm } from '../components/Confirm.jsx'
import { useUndo } from '../components/Undo.jsx'
import BibAssign from '../components/BibAssign.jsx'
import TimerAssign from '../components/TimerAssign.jsx'
import SyncBadge from '../components/SyncBadge.jsx'

// Race day for a shared race, on the admin link: late runners, heats, bibs and
// timers. The race itself (sign-ups, links, results on the race page) is run
// from the race website; this is what happens at the start line. Every change
// is saved on the server at once (tk_admin_* in the site's schema, PART 18),
// reaches the timers' phones within seconds, and can be undone.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
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
  const [settings, setSettingsState] = useState(() => loadSettings(eventId))
  const [confirmNode, askConfirm] = useConfirm()
  const [undoNode, offerUndo] = useUndo()
  const noteTimer = useRef(null)
  useOnlineSync(eventId, Boolean(event?.online))

  if (!event || roleOf(event) !== 'admin') {
    return (
      <div className="app">
        <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>
        <div className="empty">
          <div className="display">Admin only</div>
          Race admin opens with the race’s admin link, from the race website.
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
      say(e instanceof NotAdminError ? 'Only the admin link can do this.'
        : /fetch|network|Failed/i.test(e.message) ? 'Not saved: no signal. Try again.' : e.message, true)
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
  const where = (nr) => (nr ? `heat ${nr}` : 'no heat')

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
    place(assignment, `Placed ${plural(assignment.length, 'runner')}`)
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
      `${plural(free.length, 'runner')} in ${plural(plan.length, 'heat')}`)
    if (!heats.some((h) => h.status === 'pending' && countIn(h))) { run(); return }
    askConfirm({
      title: `Make ${plural(plan.length, 'heat')}?`,
      body: 'Replaces the heats that have not started with this plan. Heats that have started stay as they are. You can undo it straight after.',
      confirmLabel: 'Make heats',
      onConfirm: run,
    })
  }

  // ---- runners ----
  async function add(f) {
    const res = await call('tk_admin_legg_til_loper', {
      p_klasse: f.kind === 'stafett' ? 'stafett' : 'individuell', p_navn: f.name,
      p_kjonn: f.kind === 'stafett' ? null : f.kind, p_lagnavn: f.team || null, p_partner_navn: f.partner || null,
      p_heat: f.heat || null,
    })
    if (res === undefined) return false
    const bib = String(res.ny_bib ?? '')
    undoable(`Added ${bib} ${f.kind === 'stafett' ? f.team : f.name} · ${where(f.heat)}`, async () => {
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
    undoable(`Removed ${r.bib} ${r.name}`, async () => {
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
    title: `Remove ${r.name || `bib ${r.bib}`}?`,
    body: 'Takes them off the start list and the sign-ups. Someone who has run a lap can’t be removed: mark them DNS or DNF instead. You can undo it straight after.',
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: () => remove(r),
  })

  // ---- bibs ----
  async function changeBib(r) {
    const input = window.prompt(`New bib for ${r.name || r.bib}:`, r.bib)
    if (input == null) return
    const to = Number(String(input).trim())
    const from = Number(r.bib)
    if (!Number.isInteger(to) || to < 1 || to > 9999) { say('A bib is a number from 1 to 9999.', true); return }
    if (to === from) return
    const set = async (swap) => {
      setBusy(true)
      try {
        await adminCall(eventId, 'tk_admin_sett_startnummer', { p_fra: from, p_til: to, p_bytt: swap })
        undoable(`${r.name}: ${from} → ${to}${swap ? ' (swapped)' : ''}`,
          () => call('tk_admin_sett_startnummer', { p_fra: to, p_til: from, p_bytt: swap }))
      } catch (e) {
        if (e.hint === 'opptatt' && !swap) {
          askConfirm({
            title: `Bib ${to} is taken`,
            body: `${e.detail || 'Someone else'} has ${to}. Swap, so they get ${from}?`,
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
    undoable(`New bibs for ${plural(mapping.length, 'runner')}`,
      () => call('tk_admin_tildel_startnummer', { p_tildeling: mapping.map((m) => ({ fra: m.til, til: m.fra })) }))
  }

  // ---- timers: who times whom, per runner ----
  const timerNames = event.online.timers ?? []
  async function giveTimer(list, assignment, label) {
    const before = list.map((r) => ({ runner_id: r.id, tidtaker: r.timer ?? null }))
    if (await call('tk_admin_tidtakere', { p_tildeling: assignment }) === undefined) return
    undoable(label, () => call('tk_admin_tidtakere', { p_tildeling: before }))
  }
  const setTimer = (r, timer) => giveTimer([r], [{ runner_id: r.id, tidtaker: timer || null }], `${r.bib} → ${timer || 'no timer'}`)
  function splitTimers(title, list) {
    if (!timerNames.length || !list.length) return
    const assignment = splitBetween(list, timerNames).map((x) => ({ runner_id: x.runner.id, tidtaker: x.timer }))
    giveTimer(list, assignment, `${title} split between ${plural(timerNames.length, 'timer')}`)
  }

  const sections = [
    ...(noHeat.length ? [{ key: 'none', name: 'No heat', title: `No heat · ${noHeat.length}`, list: noHeat, warn: heats.length > 0 }] : []),
    ...heats.map((h) => ({
      key: h.id,
      name: h.name,
      title: [h.name, groupOfHeat(h) && GROUP_NAME[groupOfHeat(h)], h.status === 'running' ? 'running' : h.status === 'done' ? 'done' : null, plural(countIn(h), 'runner')].filter(Boolean).join(' · '),
      list: runners.filter((r) => r.heatId === h.id),
      started: h.status !== 'pending',
    })),
  ]

  // What is left before the start, at a glance; each line jumps to its place.
  const noTimer = runners.filter((r) => r.heatId && !r.timer).length
  const todo = [
    { ok: runners.length > 0 && noHeat.length === 0, go: 'heats',
      text: !runners.length ? 'No runners yet' : noHeat.length ? `${plural(noHeat.length, 'runner')} without a heat` : 'Everyone is in a heat' },
    { ok: timerNames.length > 0, go: 'timers',
      text: timerNames.length ? `${plural(timerNames.length, 'timer')}: ${timerNames.join(', ')}` : 'No timers added yet' },
    { ok: timerNames.length > 0 && noTimer === 0, go: 'list',
      text: noTimer ? `${plural(noTimer, 'runner')} without a timer (only you can time them)` : 'Every runner has a timer' },
  ]
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="app">
      <div className="topbar">
        <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>
        <div className="spacer" />
        <SyncBadge eventId={eventId} />
      </div>
      <h1 style={{ margin: 0, fontSize: 26 }}>Race admin</h1>
      <div className="muted tiny">{event.name} · {plural(runners.length, 'runner')} · {plural(heats.length, 'heat')}</div>

      <div className="card stack" style={{ marginTop: 14, gap: 6 }}>
        {todo.map((x) => (
          <button key={x.go} className="todo-row" onClick={() => jump(x.go)}>
            <span className={`todo-mark${x.ok ? ' ok' : ''}`} aria-hidden>{x.ok ? '✓' : '!'}</span>
            <span className="grow">{x.text}</span>
          </button>
        ))}
      </div>

      <h2 id="heats" className="admin-h">Heats</h2>
      {runners.length > 0 ? (
        <div className="card stack" style={{ gap: 10 }}>
          <div className="row wrap" style={{ gap: 14 }}>
            <label className="row" style={{ gap: 8 }}>
              Max per heat
              <input type="number" min="1" max="40" inputMode="numeric" value={settings.perHeat}
                onChange={(e) => setSettings({ perHeat: e.target.value })} style={{ width: 70 }} />
            </label>
            <Check checked={settings.byGender} onChange={(v) => setSettings({ byGender: v })}>Women and men apart</Check>
            <Check checked={settings.relayApart} onChange={(v) => setSettings({ relayApart: v })}>Relay teams apart</Check>
          </div>
          {plan.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              {planGroups.map((g, i) => {
                const hs = plan.filter((h) => h.group === g)
                return (
                  <div key={g} className="row" style={{ gap: 8 }}>
                    {planGroups.length > 1 && (
                      <span className="row" style={{ gap: 2 }}>
                        <button className="btn ghost sm" disabled={i === 0} onClick={() => moveGroup(g, -1)} aria-label={`${GROUP_NAME[g]} earlier`}>▲</button>
                        <button className="btn ghost sm" disabled={i === planGroups.length - 1} onClick={() => moveGroup(g, 1)} aria-label={`${GROUP_NAME[g]} later`}>▼</button>
                      </span>
                    )}
                    <strong style={{ minWidth: 90 }}>{GROUP_NAME[g]}</strong>
                    <span className="muted">
                      {hs.length === 1 ? `heat ${hs[0].nr} · ${hs[0].runners.length}` : `heats ${hs[0].nr}–${hs[hs.length - 1].nr} · ${hs.map((h) => h.runners.length).join(' + ')}`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <button className={`btn${heats.length ? '' : ' primary'}`} disabled={busy || !plan.length} onClick={makeHeats}>
            {heats.length ? `Remake as ${plural(plan.length, 'heat')}` : `Make ${plural(plan.length, 'heat')}`}
          </button>
          {noHeat.length > 0 && heats.length > 0 && (
            <button className="btn primary" disabled={busy} onClick={placeWithoutHeat}>Place {noHeat.length} without a heat</button>
          )}
          <div className="muted tiny">Heats that have started are left alone. A relay team takes one place.</div>
        </div>
      ) : (
        <div className="muted">No runners yet. Bring in the sign-ups on the race website, or add runners in the start list below.</div>
      )}

      <h2 id="timers" className="admin-h">Timers</h2>
      <TimerAssign event={event} runners={runners} offerUndo={offerUndo} />

      <div className="row" style={{ alignItems: 'baseline' }}>
        <h2 id="list" className="admin-h grow">Start list</h2>
        <button className="btn ghost sm" onClick={() => setShowBibs(!showBibs)} aria-expanded={showBibs}>Assign bibs</button>
      </div>
      {showBibs && <BibAssign eventId={eventId} runners={runners} onClose={() => setShowBibs(false)} onApply={applyBibs} />}
      <div className="muted tiny">Tap a bib to change it. Every change reaches the timers’ phones within seconds and can be undone.</div>

      <button className="btn block" style={{ marginTop: 10 }} onClick={() => setShowAdd(!showAdd)} aria-expanded={showAdd}>
        {showAdd ? 'Close' : '+ Add a runner'}
      </button>
      {showAdd && <AddRunner busy={busy} openHeats={openHeats} countIn={countIn} newNr={newNr} suggestFor={suggestFor} onAdd={add} />}

      <div className="stack" style={{ marginTop: 14, gap: 18 }}>
        {sections.map((s) => (
          <div key={s.key}>
            <div className="row" style={{ alignItems: 'baseline', marginBottom: 4 }}>
              <div className="grow" style={{ fontWeight: 700, color: s.warn ? 'var(--red)' : s.started ? 'var(--muted)' : 'var(--amber)' }}>{s.title}</div>
              {/* Not on a heat under way: moving everyone at once would drop
                  taps the timers have not sent yet. One runner can still move. */}
              {timerNames.length > 0 && s.list.length > 0 && s.key !== 'none' && !s.started && (
                <button className="btn ghost sm" disabled={busy} onClick={() => splitTimers(s.name, s.list)}>Split between timers</button>
              )}
            </div>
            {s.warn && <div className="muted tiny">Not timed until they are in a heat.</div>}
            {s.list.map((r) => {
              const timerSelect = timerNames.length > 0 && (
                <select className={`grow${r.timer ? '' : ' unset'}`} value={r.timer ?? ''} disabled={busy}
                  onChange={(e) => setTimer(r, e.target.value)} aria-label={`Timer for ${r.name}`}
                  style={locked(r) ? { flex: '0 0 120px' } : undefined}>
                  <option value="">No timer</option>
                  {timerNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              )
              return (
                <div key={r.id} className="admin-row">
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn ghost sm" style={{ minWidth: 56, borderStyle: 'dashed' }} disabled={busy}
                      onClick={() => changeBib(r)} aria-label={`Change bib ${r.bib}`}>{r.bib}</button>
                    <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}<span className="muted tiny"> · {r.category}</span>
                    </span>
                    {/* In a heat that has started only the timer can change: the
                        heading already says it has started, and the runner stays. */}
                    {locked(r) ? timerSelect : (
                      <button className="t-more" disabled={busy} onClick={() => askRemove(r)} aria-label={`Remove ${r.name}`}>✕</button>
                    )}
                  </div>
                  {!locked(r) && (
                    <div className="row" style={{ gap: 8, marginTop: 6 }}>
                      <select className="grow" value={nrOf(r) ?? ''} disabled={busy}
                        onChange={(e) => move(r, e.target.value ? Number(e.target.value) : null)} aria-label={`Heat for ${r.name}`}>
                        <option value="">No heat</option>
                        {openHeats.map((h) => <option key={h.id} value={h.order + 1}>{h.name} ({countIn(h)})</option>)}
                        <option value={newNr}>New heat {newNr}</option>
                      </select>
                      {timerSelect}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {confirmNode}
      {undoNode}
      {note && <div className="toast" role="status"><span>{note.text}</span></div>}
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

function AddRunner({ busy, openHeats, countIn, newNr, suggestFor, onAdd }) {
  const [kind, setKind] = useState('kvinne')
  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const [partner, setPartner] = useState('')
  const [heatChoice, setHeatChoice] = useState(null) // null = follow the suggestion
  const relay = kind === 'stafett'
  const heat = heatChoice === null ? suggestFor(CATEGORY[kind]) : heatChoice
  const ready = name.trim() && (!relay || (team.trim() && partner.trim()))

  async function submit(e) {
    e.preventDefault()
    if (!ready || busy) return
    // Kept on failure, so a refused name can be corrected instead of retyped.
    if (await onAdd({ kind, name: name.trim(), team: team.trim(), partner: partner.trim(), heat: heat || null })) {
      setName(''); setTeam(''); setPartner(''); setHeatChoice(null)
    }
  }

  return (
    <form className="card stack" style={{ marginTop: 10, gap: 10 }} onSubmit={submit}>
      <div className="muted tiny">For someone who did not sign up. They get the next free bib and a sign-up on the race page too.</div>
      <div className="row wrap" style={{ gap: 6 }} role="radiogroup" aria-label="Class">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      {relay && <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team name" aria-label="Team name" maxLength={60} />}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={relay ? 'Runner 1' : 'Name'} aria-label={relay ? 'Runner 1' : 'Name'} maxLength={100} autoComplete="off" />
      {relay && <input value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="Runner 2" aria-label="Runner 2" maxLength={100} autoComplete="off" />}
      <select value={heat || ''} onChange={(e) => setHeatChoice(e.target.value ? Number(e.target.value) : 0)} aria-label="Heat">
        <option value="">No heat</option>
        {openHeats.map((h) => <option key={h.id} value={h.order + 1}>{h.name} ({countIn(h)})</option>)}
        <option value={newNr}>New heat {newNr}</option>
      </select>
      <button className="btn primary" type="submit" disabled={!ready || busy}>Add</button>
    </form>
  )
}

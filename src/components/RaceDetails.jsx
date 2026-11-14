import { useEffect, useState } from 'react'
import NumberField from './NumberField.jsx'

// Race admin's "Race" card: the race itself, as the race website shows it.
// Name and date reach the timing too; time and venue are on the race page.
// Every change is saved at once and can be undone.
//   call(fn, args)      -> the server's answer, or undefined after saying why not
//   undoable(label, fn) -> offers Undo
export default function RaceDetails({ event, runnerCount, busy, call, undoable, say, onLaps }) {
  const [info, setInfo] = useState(null) // { tittel, dato, tid, sted, aapen, vis_resultater }
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    call('tk_admin_lopsinfo', {}).then((res) => {
      if (!live) return
      if (res === undefined) setFailed(true)
      else setInfo(res)
    })
    return () => { live = false }
    // Once per race: the call itself refreshes the start list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id])

  async function save(change, label) {
    const before = Object.fromEntries(Object.keys(change).map((k) => [k, info?.[k] ?? null]))
    const res = await call('tk_admin_sett_lop', { p_endring: change })
    if (res === undefined) return false
    setInfo(res)
    undoable(label, async () => {
      const back = await call('tk_admin_sett_lop', { p_endring: before })
      if (back !== undefined) setInfo(back)
    })
    return true
  }

  async function fetchSignups() {
    const before = runnerCount
    const res = await call('tk_admin_hent_paameldinger', {})
    if (res === undefined) return
    const added = (res.antall ?? 0) - before
    say(added > 0 ? `${added} new from the sign-ups.` : 'The start list already has every sign-up.')
  }

  if (failed && !info) {
    return (
      <div className="card stack" style={{ marginTop: 14, gap: 8 }}>
        <div className="muted">The race’s details could not be loaded.</div>
        <LapsRow event={event} onLaps={onLaps} />
      </div>
    )
  }

  return (
    <div className="card stack" style={{ marginTop: 14, gap: 12 }}>
      {!info ? <div className="muted tiny">Loading the race…</div> : (
        <>
          <TextRow label="Name" value={info.tittel} max={120} busy={busy} required
            onSave={(v) => save({ tittel: v }, `Name: ${v}`)} />
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <label className="stack grow" style={{ gap: 4, minWidth: 0 }}>
              <span className="label">Date</span>
              <input type="date" value={info.dato ?? ''} disabled={busy}
                onChange={(e) => save({ dato: e.target.value || null }, `Date: ${e.target.value || 'none'}`)} />
            </label>
            <LapsRow event={event} onLaps={onLaps} />
          </div>
          <TextRow label="Start time" value={info.tid} max={60} busy={busy} placeholder="18:00, or meet at 17:30"
            onSave={(v) => save({ tid: v }, `Start time: ${v || 'none'}`)} />
          <TextRow label="Venue" value={info.sted} max={160} busy={busy}
            onSave={(v) => save({ sted: v }, `Venue: ${v || 'none'}`)} />

          <Switch on={info.aapen} busy={busy} label="Sign-up open"
            hint={info.aapen ? 'People can still sign up on the race page.' : 'The sign-up form is closed.'}
            onChange={(v) => save({ aapen: v }, v ? 'Sign-up opened' : 'Sign-up closed')} />
          <Switch on={info.vis_resultater} busy={busy} label="Results on the race page"
            hint={info.vis_resultater ? 'Everyone with the race link sees the live results.' : 'Hidden: only the timing phones see them.'}
            onChange={(v) => save({ vis_resultater: v }, v ? 'Results shown' : 'Results hidden')} />

          <div className="row" style={{ gap: 10 }}>
            <div className="grow muted tiny">New sign-ups on the race page are not in the start list until you fetch them.</div>
            <button className="btn sm" disabled={busy} onClick={fetchSignups}>Fetch new sign-ups</button>
          </div>
        </>
      )}
    </div>
  )
}

function LapsRow({ event, onLaps }) {
  return (
    <label className="stack" style={{ gap: 4, width: 80, flex: 'none' }}>
      <span className="label">Laps</span>
      <NumberField value={event.numLaps ?? 4} min={1} max={20} onCommit={onLaps} label="Laps" />
    </label>
  )
}

// A text field with its own Save, so a half-typed name is never sent.
function TextRow({ label, value, max, busy, required, placeholder, onSave }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  const v = draft.trim()
  const changed = v !== (value ?? '').trim()
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span className="label">{label}</span>
      <div className="row" style={{ gap: 8 }}>
        <input className="grow" value={draft} maxLength={max} placeholder={placeholder} style={{ minWidth: 0 }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && changed && (v || !required)) onSave(v) }} />
        {changed && <button className="btn" disabled={busy || (required && !v)} onClick={() => onSave(v)}>Save</button>}
      </div>
    </label>
  )
}

function Switch({ on, busy, label, hint, onChange }) {
  return (
    <label className="row" style={{ gap: 10 }}>
      <input type="checkbox" checked={Boolean(on)} disabled={busy} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, flex: 'none', margin: 0, accentColor: 'var(--amber)' }} />
      <span className="grow">
        <span>{label}</span>
        <span className="muted tiny" style={{ display: 'block' }}>{hint}</span>
      </span>
    </label>
  )
}

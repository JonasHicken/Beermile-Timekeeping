import { useState } from 'react'
import { getState, standings, setCrossingTime } from '../lib/store.js'
import { adminCall } from '../lib/online.js'
import { fmt } from '../lib/time.js'
import { classesIn, recordRows } from '../lib/raceResults.js'
import TimeInput from './TimeInput.jsx'

const OUT = { dnf: 'DNF', dns: 'DNS', dq: 'DQ' }

// The results, place by place in each class, with a way to correct a name, a
// bib or a finishing time after the race. Each change is one field, asks
// first (a result is a big deal once it is out) and can be undone.
//   name  -> the sign-up and start list (tk_admin_rett_resultat)
//   bib   -> the sign-up and start list (tk_admin_sett_startnummer, swaps)
//   time  -> moves the runner's finishing tap, like Review; it syncs as a lap
// A result already sent to the records list is corrected there too while it
// waits for approval; an approved record is public and is changed on the site.
export default function ResultCorrections({ event, finishers, out, askConfirm, offerUndo }) {
  const [open, setOpen] = useState(null) // runner id being edited
  const [note, setNote] = useState(null) // { text, error }

  const say = (text, error = false) => setNote({ text, error })
  const recordNote = (res) => (res?.rekord === 'godkjent'
    ? ' This result is already approved on the records list: change it there too, on the race website.'
    : '')
  // Resolves to the server's answer, or null after saying what went wrong.
  async function server(fn, args) {
    try { return await adminCall(event.id, fn, args) }
    catch (e) { say(`Not saved: ${e.message}`, true); return null }
  }

  function saveName(row, name) {
    const from = row.runner.name
    const to = name.trim()
    if (!to || to === from) return
    askConfirm({
      title: 'Change the name?',
      body: `“${from}” becomes “${to}” in the results, the start list and the sign-up, on every phone and on the race page.`,
      confirmLabel: 'Change name',
      danger: true,
      onConfirm: async () => {
        const res = await server('tk_admin_rett_resultat', { p_runner_id: row.runner.id, p_navn: to })
        if (res === null) return
        say(`Name changed.${recordNote(res)}`)
        offerUndo(`Name: ${to}`, () => server('tk_admin_rett_resultat', { p_runner_id: row.runner.id, p_navn: from }))
      },
    })
  }

  function saveBib(row, input) {
    const from = Number(row.runner.bib)
    const to = Number(String(input).trim())
    if (!Number.isInteger(to) || to < 1 || to > 9999) { say('A bib is a number from 1 to 9999.', true); return }
    if (to === from) return
    const set = async (swap) => {
      try {
        await adminCall(event.id, 'tk_admin_sett_startnummer', { p_fra: from, p_til: to, p_bytt: swap })
        say(`Bib changed${swap ? ' (swapped)' : ''}.`)
        offerUndo(`Bib ${from} → ${to}`, () => server('tk_admin_sett_startnummer', { p_fra: to, p_til: from, p_bytt: swap }))
      } catch (e) {
        if (e.hint === 'opptatt' && !swap) {
          askConfirm({
            title: `Bib ${to} is taken`,
            body: `${e.detail || 'Someone else'} has ${to}. Swap, so they get ${from}?`,
            confirmLabel: 'Swap',
            danger: true,
            onConfirm: () => set(true),
          })
        } else say(`Not saved: ${e.message}`, true)
      }
    }
    askConfirm({
      title: 'Change the bib?',
      body: `${row.runner.name} gets bib ${to} instead of ${from}, in the results, the start list and the sign-up, on every phone and on the race page.`,
      confirmLabel: 'Change bib',
      danger: true,
      onConfirm: () => set(false),
    })
  }

  // The new time is where the finishing tap moves to; it has to stay after the
  // runner's lap before it, or the laps would change order.
  function saveTime(row, ms) {
    const need = row.requiredLaps
    const finish = row.laps[need - 1]
    if (!finish || row.heat?.startedAt == null) return 'This result has no finishing tap to move.'
    const start = row.heat.startedAt
    const before = need > 1 ? row.laps[need - 2].at - start : 0
    if (ms <= before) return `It has to be after the previous lap (${fmt(before)}).`
    // The same time again: nothing to move, but the records list's copy is
    // sent once more (what to do when it could not be updated last time).
    if (ms === row.elapsed) {
      syncRecord(row.runner.id).then((res) => { if (res?.rekord) say(`Records list up to date.${recordNote(res)}`) })
      return undefined
    }
    const oldAt = finish.at
    askConfirm({
      title: 'Change the finishing time?',
      body: `${row.runner.name}: ${fmt(row.elapsed)} becomes ${fmt(ms)}. The places, the results and the race page change with it. The laps before stay as they are.`,
      confirmLabel: 'Change time',
      danger: true,
      onConfirm: async () => {
        // The tap moves on this phone at once and reaches the others with the
        // next sync; only the records list's copy needs the server right now.
        setCrossingTime(finish.id, start + ms)
        const res = await syncRecord(row.runner.id)
        if (res === null) say('Time changed in the results, but the records list could not be updated. Check the signal and save the time again.', true)
        else say(`Time changed.${recordNote(res)}`)
        offerUndo(`Time: ${fmt(ms)}`, async () => { setCrossingTime(finish.id, oldAt); await syncRecord(row.runner.id) })
      },
    })
    return undefined
  }

  // The records list's copy of the time and laps, from the results as they now are.
  function syncRecord(runnerId) {
    const now = standings(getState(), event.id).finishers.find((r) => r.runner.id === runnerId)
    const rec = now && recordRows([now])[0]
    if (!rec) return Promise.resolve(undefined)
    return server('tk_admin_rett_resultat', { p_runner_id: runnerId, p_sekunder: rec.sekunder, p_runder: rec.runder })
  }

  const rowView = (row, place) => {
    const editing = open === row.runner.id
    return (
      <div key={row.runner.id} className="admin-row">
        <div className="row" style={{ gap: 10 }}>
          <span className="display" style={{ width: 28, color: place && place <= 3 ? 'var(--amber)' : 'var(--muted)' }}>{place ?? '–'}</span>
          <span style={{ width: 44, fontWeight: 700 }}>{row.runner.bib}</span>
          <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.runner.name}</span>
          <span className="display" style={{ fontSize: 20 }}>{row.finished ? fmt(row.elapsed) : OUT[row.status] ?? ''}</span>
          <button className="btn ghost sm" onClick={() => { setOpen(editing ? null : row.runner.id); setNote(null) }} aria-expanded={editing}>
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
        {editing && <EditForm row={row} onName={(n) => saveName(row, n)} onBib={(b) => saveBib(row, b)} onTime={(ms) => saveTime(row, ms)} />}
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {classesIn(finishers).map((c) => (
        <div key={c}>
          <div style={{ fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>{c || 'No class'}</div>
          {finishers.filter((r) => (r.runner.category || '') === c).map((r, i) => rowView(r, i + 1))}
        </div>
      ))}
      {out.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Out of the race</div>
          {out.map((r) => rowView(r, null))}
        </div>
      )}
      {note && <div className={note.error ? 'form-error' : 'muted tiny'} role="status">{note.text}</div>}
    </div>
  )
}

function EditForm({ row, onName, onBib, onTime }) {
  const [name, setName] = useState(row.runner.name)
  const [bib, setBib] = useState(row.runner.bib)
  return (
    <div className="stack" style={{ gap: 10, marginTop: 10, padding: '12px 0 4px' }}>
      <label className="stack" style={{ gap: 4 }}>
        <span className="label">Name</span>
        <div className="row" style={{ gap: 8 }}>
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} style={{ minWidth: 0 }} />
          <button className="btn" disabled={!name.trim() || name.trim() === row.runner.name} onClick={() => onName(name)}>Save</button>
        </div>
      </label>
      {row.runner.category === 'Stafett' && <div className="muted tiny">A relay team is written “Team (Runner og Runner)”.</div>}
      <label className="stack" style={{ gap: 4 }}>
        <span className="label">Bib</span>
        <div className="row" style={{ gap: 8 }}>
          <input className="grow" inputMode="numeric" value={bib} onChange={(e) => setBib(e.target.value.replace(/\D/g, ''))} style={{ minWidth: 0 }} />
          <button className="btn" disabled={!bib || bib === row.runner.bib} onClick={() => onBib(bib)}>Save</button>
        </div>
      </label>
      {row.finished && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Finishing time</span>
          <TimeInput initialMs={row.elapsed} submitLabel="Save" onSubmit={onTime} />
        </div>
      )}
    </div>
  )
}

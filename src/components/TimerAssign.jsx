import { useState } from 'react'
import { saveTimers, timerLink, NotAdminError } from '../lib/online.js'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// The admin's side of a shared race: the link to send to the timers, the
// timers' names, and which runners each one times. Saved on the server
// straight away (each timer's phone picks it up within a couple of seconds)
// and every change offers Undo.
export default function TimerAssign({ event, heats, runners, offerUndo }) {
  const names = event.online.timers ?? []
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { text, error }
  const link = timerLink(event)

  async function save(change, undoLabel, undoChange) {
    setBusy(true); setMsg(null)
    try {
      await saveTimers(event.id, change)
      if (undoLabel) offerUndo(undoLabel, () => saveTimers(event.id, undoChange).catch(() => setMsg({ text: 'Undo failed: no signal. Try again.', error: true })))
      return true
    } catch (e) {
      setMsg({
        text: e instanceof NotAdminError ? 'Only the admin link can change this.' : 'Not saved: no signal. Try again.',
        error: true,
      })
      return false
    } finally { setBusy(false) }
  }

  const current = (list) => list.map((r) => ({ runnerId: r.id, timer: r.timer ?? null }))

  function addName(e) {
    e.preventDefault()
    const n = newName.trim().slice(0, 30)
    if (!n) return
    if (names.some((x) => x.toLowerCase() === n.toLowerCase())) { setMsg({ text: `${n} is already on the list.`, error: true }); return }
    save({ names: [...names, n] }).then((ok) => ok && setNewName(''))
  }

  function removeName(n) {
    const theirs = runners.filter((r) => r.timer === n)
    save({ names: names.filter((x) => x !== n) }, `Removed ${n}`, { names, assignment: current(theirs) })
  }

  function assign(r, timer) {
    save({ assignment: [{ runnerId: r.id, timer: timer || null }] },
      `${r.bib} → ${timer || 'nobody'}`, { assignment: current([r]) })
  }

  // Blocks of bibs that follow each other, as even as possible: a timer
  // watching 304-310 finds their runners faster than one with every third bib.
  function splitEvenly(heat, list) {
    if (!names.length || !list.length) return
    const per = Math.floor(list.length / names.length)
    const extra = list.length % names.length
    const assignment = []
    let i = 0
    names.forEach((n, k) => {
      const take = per + (k < extra ? 1 : 0)
      for (const r of list.slice(i, i + take)) assignment.push({ runnerId: r.id, timer: n })
      i += take
    })
    save({ assignment }, `${heat.name} split between ${plural(names.length, 'timer')}`, { assignment: current(list) })
  }

  async function shareLink() {
    if (!link) return
    try {
      if (navigator.share) { await navigator.share({ title: `${event.name} · timing`, url: link }); return }
    } catch { return /* closed the share sheet */ }
    try { await navigator.clipboard.writeText(link); setMsg({ text: 'Timer link copied.' }) }
    catch { window.prompt('Copy the timer link:', link) }
  }

  return (
    <div className="stack" style={{ marginTop: 22 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Timers</h2>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="muted" style={{ fontSize: 15 }}>
          Send the timer link to the people timing. They can only record laps for the runners you give them
          (or runners nobody has). Only this phone, on the admin link, can start and finish heats.
        </div>
        {link
          ? <button className="btn primary" onClick={shareLink}>Share the timer link</button>
          : <div className="muted tiny">The timer link appears here once the server has answered.</div>}

        <form className="row wrap" style={{ gap: 6 }} onSubmit={addName}>
          <input className="grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Timer's name" aria-label="Timer's name" maxLength={30} style={{ minWidth: 0 }} />
          <button className="btn" type="submit" disabled={busy || !newName.trim()}>Add</button>
        </form>
        {names.length > 0 && (
          <div className="row wrap" style={{ gap: 6 }}>
            {names.map((n) => (
              <span key={n} className="chip on" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {n} <span className="tiny" style={{ opacity: .65 }}>{runners.filter((r) => r.timer === n).length}</span>
                <button className="t-more" style={{ padding: '0 4px' }} disabled={busy} onClick={() => removeName(n)} aria-label={`Remove ${n}`}>✕</button>
              </span>
            ))}
          </div>
        )}
        {msg && <div className={msg.error ? 'form-error' : 'muted tiny'} role="status">{msg.text}</div>}
      </div>

      {names.length > 0 && heats.map((h) => {
        const list = runners.filter((r) => r.heatId === h.id)
        if (!list.length) return null
        const nobody = list.filter((r) => !r.timer).length
        return (
          <details key={h.id} className="card" open={h.status !== 'done'}>
            <summary className="row" style={{ cursor: 'pointer', alignItems: 'baseline' }}>
              <strong>{h.name}</strong>
              <span className="muted tiny" style={{ marginLeft: 8 }}>
                {plural(list.length, 'runner')}{nobody ? ` · ${nobody} without a timer` : ''}
              </span>
            </summary>
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              <button className="btn sm" disabled={busy} onClick={() => splitEvenly(h, list)}>
                Split evenly between {plural(names.length, 'timer')}
              </button>
              {list.map((r) => (
                <div key={r.id} className="row" style={{ gap: 8 }}>
                  <span style={{ width: 44, fontWeight: 700 }}>{r.bib}</span>
                  <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <select value={r.timer ?? ''} disabled={busy} onChange={(e) => assign(r, e.target.value)} aria-label={`Timer for ${r.bib}`} style={{ width: 130 }}>
                    <option value="">Nobody</option>
                    {names.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}

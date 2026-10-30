import { useState } from 'react'
import { saveTimers, timerLink, NotAdminError } from '../lib/online.js'

// The admin's list of timers and the link to send them. Which runners each
// one times is set per runner in Race admin's start list. Saved on the server
// straight away (each timer's phone picks it up within a couple of seconds)
// and every change offers Undo.
export default function TimerAssign({ event, runners, offerUndo }) {
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

  async function shareLink() {
    if (!link) return
    try {
      if (navigator.share) { await navigator.share({ title: `${event.name} · timing`, url: link }); return }
    } catch { return /* closed the share sheet */ }
    try { await navigator.clipboard.writeText(link); setMsg({ text: 'Timer link copied.' }) }
    catch { window.prompt('Copy the timer link:', link) }
  }

  return (
      <div className="card stack" style={{ gap: 10 }}>
        <div className="muted" style={{ fontSize: 15 }}>
          Add each timer by name, then share the link. They get in by typing their name (any upper/lower case),
          so the link alone is no use to anyone else. Give them runners in the start list below.
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
  )
}

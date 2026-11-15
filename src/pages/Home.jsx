import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useStore, listEvents, createEvent, deleteEvent, restoreEvent,
  runnersInEvent, heatsInEvent,
} from '../lib/store.js'
import { useConfirm } from '../components/Confirm.jsx'
import { useUndo } from '../components/Undo.jsx'
import EventFormatEditor from '../components/EventFormatEditor.jsx'
import HelpBox from '../components/HelpBox.jsx'
import OrganiserPanel from '../components/OrganiserPanel.jsx'
import { useOrganiser, createSharedRace } from '../lib/organiser.js'
import { presetFormat, formatOf, describe } from '../lib/eventFormat.js'

export default function Home() {
  const events = useStore((s) => listEvents(s))
  const nav = useNavigate()
  const [creating, setCreating] = useState(false)
  const [confirmNode, askConfirm] = useConfirm()
  const [undoNode, offerUndo] = useUndo()
  const [name, setName] = useState('')
  const [format, setFormat] = useState(() => presetFormat('beermile'))
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const user = useOrganiser()
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(e) {
    e.preventDefault()
    if (!shared) {
      const ev = createEvent({ name, date, format })
      nav(`/event/${ev.id}/setup`)
      return
    }
    // A shared race is made on the server, then opened here as its admin.
    setBusy(true); setError('')
    try {
      const ev = await createSharedRace({ name: name.trim() || 'Race', date, format })
      nav(`/event/${ev.id}/admin`)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="app">
      <div className="topbar">
        {/* The logo without its white sticker outline (logo-plain.png), on the dark page. */}
        <img className="mark" src="/logo-plain.png" alt="" width="60" height="56" />
        <div>
          <h1>Beermile <span className="accent">Timekeeping</span></h1>
        </div>
      </div>

      {!creating && (
        <button className="btn primary lg block" onClick={() => setCreating(true)}>
          + New event
        </button>
      )}

      {creating && (
        <form className="card stack" onSubmit={create}>
          <div>
            <label className="label">Event name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Club championship 2027"
            />
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Event</label>
            <EventFormatEditor value={format} onSave={setFormat} compact />
          </div>
          {user && (
            <label className="row" style={{ gap: 10 }}>
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)}
                style={{ width: 20, height: 20, flex: 'none', margin: 0, accentColor: 'var(--amber)' }} />
              <span className="grow">
                Shared race
                <span className="muted tiny" style={{ display: 'block' }}>Timed by several phones: you get an admin link, and a timer link to send to helpers.</span>
              </span>
            </label>
          )}
          {error && <div className="form-error">{error}</div>}
          <div className="row">
            <button type="button" className="btn ghost grow" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary grow" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      <OrganiserPanel />
      <HelpBox />

      <div style={{ height: 20 }} />

      {events.length === 0 && !creating && (
        <div className="empty">
          <div className="display">Race day starts here</div>
          Create an event to build your start list.
        </div>
      )}

      <div className="list">
        {events.map((ev) => (
          <EventRow key={ev.id} ev={ev} onOpen={() => nav(`/event/${ev.id}/setup`)}
            onLive={() => nav(`/event/${ev.id}/live`)}
            onHeat={(h) => nav(`/event/${ev.id}/heat/${h.id}`)}
            onDelete={() => askConfirm({
              title: `Delete ${ev.name}?`,
              body: 'Removes the event, its start list, heats and every recorded time. You can undo it straight after.',
              confirmLabel: 'Delete event',
              danger: true,
              onConfirm: () => {
                const snap = deleteEvent(ev.id)
                offerUndo(`Deleted ${ev.name}`, () => restoreEvent(snap))
              },
            })}
          />
        ))}
      </div>
      {confirmNode}
      {undoNode}
    </div>
  )
}

function EventRow({ ev, onOpen, onLive, onHeat, onDelete }) {
  const runners = useStore((s) => runnersInEvent(s, ev.id).length)
  const heatList = useStore((s) => heatsInEvent(s, ev.id))
  const heats = heatList.length
  // Coming back to the app mid-race, the running heat is the one thing you
  // want, so the card says so and goes straight there.
  const running = heatList.find((h) => h.status === 'running')
  return (
    <div className="event-card stack">
      <div className="row">
        <div className="grow" onClick={onOpen} style={{ cursor: 'pointer' }}>
          <div className="ev-name">
            {ev.name} {ev.online && <span className="pill live" style={{ verticalAlign: 3 }}>Shared</span>}
          </div>
          <div className="ev-meta">
            {ev.date} · {describe(formatOf(ev))} · {runners} runners · {heats} {heats === 1 ? 'heat' : 'heats'}
          </div>
          {running && <div className="running-note">● {running.name} is running</div>}
        </div>
        <button className="btn ghost danger" onClick={onDelete} aria-label="Delete">✕</button>
      </div>
      <div className="row">
        {running
          ? <button className="btn primary grow" onClick={() => onHeat(running)}>Resume {running.name}</button>
          : <button className="btn grow" onClick={onOpen}>Setup / Time</button>}
        <button className="btn grow" onClick={onLive}>Results</button>
      </div>
    </div>
  )
}

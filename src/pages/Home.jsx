import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useStore, listEvents, createEvent, deleteEvent,
  runnersInEvent, heatsInEvent,
} from '../lib/store.js'

export default function Home() {
  const events = useStore((s) => listEvents(s))
  const nav = useNavigate()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [laps, setLaps] = useState(4)

  function create(e) {
    e.preventDefault()
    const ev = createEvent({ name, numLaps: laps })
    nav(`/event/${ev.id}/setup`)
  }

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <h1>Beermile <span className="accent">Timekeeping</span></h1>
          <div className="sub">Tap timing · Live results · RFID-ready</div>
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
              placeholder="NM i Ølmila 2027"
            />
          </div>
          <div>
            <label className="label">Laps</label>
            <input
              type="number" min="1" max="20" inputMode="numeric"
              value={laps}
              onChange={(e) => setLaps(e.target.value)}
            />
          </div>
          <div className="row">
            <button type="button" className="btn ghost grow" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary grow">Create</button>
          </div>
        </form>
      )}

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
            onDelete={() => { if (confirm(`Delete "${ev.name}" and all its data?`)) deleteEvent(ev.id) }}
          />
        ))}
      </div>
    </div>
  )
}

function EventRow({ ev, onOpen, onLive, onDelete }) {
  const runners = useStore((s) => runnersInEvent(s, ev.id).length)
  const heats = useStore((s) => heatsInEvent(s, ev.id).length)
  return (
    <div className="event-card stack">
      <div className="row">
        <div className="grow" onClick={onOpen} style={{ cursor: 'pointer' }}>
          <div className="ev-name">{ev.name}</div>
          <div className="ev-meta">
            {ev.date} · {ev.numLaps} laps · {runners} runners · {heats} heats
          </div>
        </div>
        <button className="btn ghost danger" onClick={onDelete} aria-label="Delete">✕</button>
      </div>
      <div className="row">
        <button className="btn grow" onClick={onOpen}>Setup / Time</button>
        <button className="btn grow" onClick={onLive}>Results</button>
      </div>
    </div>
  )
}

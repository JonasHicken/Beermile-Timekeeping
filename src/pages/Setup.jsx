import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  useStore, getEvent, runnersInEvent, heatsInEvent, runnersInHeat,
  addRunner, removeRunner, importRunners, updateEvent,
  autoSplitHeats, createHeat, assignRunner, lapCount, crossingsInHeat,
} from '../lib/store.js'

export default function Setup() {
  const { eventId } = useParams()
  const nav = useNavigate()
  const event = useStore((s) => getEvent(s, eventId))
  const runners = useStore((s) => runnersInEvent(s, eventId))
  const heats = useStore((s) => heatsInEvent(s, eventId))

  const [bib, setBib] = useState('')
  const [name, setName] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [heatSize, setHeatSize] = useState(12)

  if (!event) {
    return (
      <div className="app">
        <Link to="/" className="backlink">← Home</Link>
        <div className="empty">Event not found.</div>
      </div>
    )
  }

  const assignedCount = runners.filter((r) => r.heatId).length

  function quickAdd(e) {
    e.preventDefault()
    if (!bib.trim()) return
    addRunner(eventId, { bib, name })
    setBib(''); setName('')
    document.getElementById('bibInput')?.focus()
  }

  function doImport() {
    const added = importRunners(eventId, importText)
    setImportText(''); setShowImport(false)
    if (added.length === 0) alert('No runners parsed. Use one per line: "14, Ola Nordmann".')
  }

  return (
    <div className="app">
      <div className="topbar">
        <Link to="/" className="backlink">← Home</Link>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => nav(`/event/${eventId}/live`)}>Results</button>
      </div>

      <div className="stack">
        <input
          value={event.name}
          onChange={(e) => updateEvent(eventId, { name: e.target.value })}
          style={{ fontSize: 20, fontWeight: 700 }}
        />
        <div className="row">
          <div className="grow">
            <label className="label">Date</label>
            <input type="date" value={event.date} onChange={(e) => updateEvent(eventId, { date: e.target.value })} />
          </div>
          <div style={{ width: 110 }}>
            <label className="label">Laps</label>
            <input type="number" min="1" max="20" inputMode="numeric" value={event.numLaps}
              onChange={(e) => updateEvent(eventId, { numLaps: Number(e.target.value) || 1 })} />
          </div>
        </div>
      </div>

      {/* --- Start list --- */}
      <h2 style={{ marginTop: 28, marginBottom: 12, fontSize: 16 }}>
        Start list <span className="muted">· {runners.length}</span>
      </h2>

      <form className="row" onSubmit={quickAdd}>
        <input id="bibInput" style={{ width: 92 }} inputMode="numeric" placeholder="Bib"
          value={bib} onChange={(e) => setBib(e.target.value)} />
        <input className="grow" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn primary">Add</button>
      </form>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost grow" onClick={() => setShowImport((v) => !v)}>
          {showImport ? 'Close paste import' : 'Paste a list'}
        </button>
      </div>

      {showImport && (
        <div className="card stack" style={{ marginTop: 10 }}>
          <label className="label">One runner per line — <code>bib, name</code> (category optional)</label>
          <textarea
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'14, Ola Nordmann\n27, Kari Berg, Women\n33, Jonas H.'}
            style={{
              width: '100%', background: 'var(--bg-2)', color: 'var(--text)',
              border: '1px solid var(--line)', borderRadius: 12, padding: 12, fontSize: 15,
            }}
          />
          <button className="btn primary" onClick={doImport}>Import</button>
        </div>
      )}

      <div className="list" style={{ marginTop: 14 }}>
        {runners.map((r) => (
          <div className="item" key={r.id}>
            <span className="bib">{r.bib}</span>
            <span className="name grow">{r.name || <span className="muted">—</span>}</span>
            {r.heatId
              ? <span className="pill">{heats.find((h) => h.id === r.heatId)?.name}</span>
              : <span className="pill setup">unassigned</span>}
            <button className="btn ghost danger" onClick={() => removeRunner(r.id)} aria-label="Remove">✕</button>
          </div>
        ))}
      </div>

      {/* --- Heats --- */}
      <h2 style={{ marginTop: 28, marginBottom: 4, fontSize: 16 }}>Heats</h2>
      <p className="muted tiny" style={{ marginTop: 0 }}>
        {assignedCount}/{runners.length} runners assigned. Split into heats to keep each screen tap-able.
      </p>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div style={{ width: 130 }}>
          <label className="label">Runners / heat</label>
          <input type="number" min="1" max="60" inputMode="numeric" value={heatSize}
            onChange={(e) => setHeatSize(Number(e.target.value) || 1)} />
        </div>
        <button className="btn"
          onClick={() => { if (runners.length && confirm('Re-split all heats? This clears any timing already recorded.')) autoSplitHeats(eventId, heatSize) }}>
          Auto-split
        </button>
        <button className="btn ghost" onClick={() => createHeat(eventId)}>+ Empty heat</button>
      </div>

      <div className="list">
        {heats.map((h) => (
          <HeatCard key={h.id} eventId={eventId} heat={h} runners={runners}
            onTime={() => nav(`/event/${eventId}/heat/${h.id}`)} />
        ))}
      </div>
      {heats.length === 0 && <div className="empty">No heats yet. Add runners, then Auto-split.</div>}

      <div style={{ height: 24 }} />
    </div>
  )
}

function HeatCard({ eventId, heat, runners, onTime }) {
  const inHeat = useStore((s) => runnersInHeat(s, heat.id))
  const crossings = useStore((s) => crossingsInHeat(s, heat.id).length)
  const state = heat.status === 'running' ? 'live' : heat.status === 'done' ? 'done' : 'setup'
  return (
    <div className="card stack">
      <div className="row">
        <div className="grow">
          <div style={{ fontWeight: 700 }}>{heat.name}</div>
          <div className="muted tiny">{inHeat.length} runners · {crossings} crossings</div>
        </div>
        <span className={`pill ${state}`}>{heat.status}</span>
      </div>
      <button className="btn primary block" onClick={onTime}>
        {heat.status === 'pending' ? 'Open timing' : heat.status === 'running' ? 'Resume timing' : 'Review timing'}
      </button>
    </div>
  )
}

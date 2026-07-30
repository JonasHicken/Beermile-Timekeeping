import { useParams, Link } from 'react-router-dom'
import { useStore, standings } from '../lib/store.js'
import { fmt, fmtShort } from '../lib/time.js'

export default function Live() {
  const { eventId } = useParams()
  const data = useStore((s) => standings(s, eventId))
  const { event, finishers = [], inProgress = [], notStarted = [] } = data

  if (!event) {
    return (
      <div className="app">
        <Link to="/" className="backlink">← Home</Link>
        <div className="empty">Event not found.</div>
      </div>
    )
  }

  const anyRunning = inProgress.length > 0

  return (
    <div className="app">
      <div className="topbar">
        <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>
        <div className="spacer" />
        {anyRunning ? <span className="pill live">● Live</span> : <span className="pill done">Results</span>}
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>{event.name}</h1>
      <div className="muted tiny" style={{ marginBottom: 16 }}>
        {event.date} · {event.numLaps} laps · {finishers.length} finished
      </div>

      {finishers.length === 0 && inProgress.length === 0 && (
        <div className="empty">
          <div className="display">No times yet</div>
          Start a heat and standings appear here live.
        </div>
      )}

      {finishers.length > 0 && (
        <table className="results">
          <thead>
            <tr>
              <th></th>
              <th>Runner</th>
              <th style={{ textAlign: 'right' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {finishers.map((r) => (
              <tr key={r.runner.id}>
                <td className="rank">{r.rank}</td>
                <td>
                  <div className="r-name"><strong>{r.runner.bib}</strong> {r.runner.name}</div>
                  <div className="splits">
                    {r.laps.map((l) => fmtShort(l.split)).join(' · ')}
                  </div>
                </td>
                <td className="time" style={{ textAlign: 'right' }}>{fmt(r.elapsed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {inProgress.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, fontSize: 15 }} className="muted">On course</h2>
          <div className="list">
            {inProgress.map((r) => (
              <div className="item" key={r.runner.id}>
                <span className="bib">{r.runner.bib}</span>
                <span className="name grow">{r.runner.name}</span>
                <span className="pill live">lap {r.lapsDone}/{event.numLaps}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {notStarted.length > 0 && (
        <div className="muted tiny" style={{ marginTop: 20 }}>
          {notStarted.length} not yet started.
        </div>
      )}

      <div style={{ height: 24 }} />
    </div>
  )
}

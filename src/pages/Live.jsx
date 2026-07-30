import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useStore, standings, heatsInEvent } from '../lib/store.js'
import { fmt, fmtShort } from '../lib/time.js'

export default function Live() {
  const { eventId } = useParams()
  const data = useStore((s) => standings(s, eventId))
  const heats = useStore((s) => heatsInEvent(s, eventId))
  const [heatFilter, setHeatFilter] = useState('all')
  const [copied, setCopied] = useState(false)

  const { event, finishers = [], inProgress = [], didNotFinish = [], notStarted = [] } = data

  if (!event) {
    return (
      <div className="app">
        <Link to="/" className="backlink">← Home</Link>
        <div className="empty">Event not found.</div>
      </div>
    )
  }

  const byHeat = (r) => heatFilter === 'all' || r.heat?.id === heatFilter
  // Re-rank within a heat filter so places read 1..n for that heat.
  const shownFinishers = finishers.filter(byHeat).map((r, i) => ({
    ...r,
    shownRank: heatFilter === 'all' ? r.rank : i + 1,
  }))
  const shownProgress = inProgress.filter(byHeat)
  const shownDnf = didNotFinish.filter(byHeat)

  const anyRunning = shownProgress.length > 0

  function exportCsv() {
    const head = ['Place', 'Bib', 'Name', 'Category', 'Heat', 'Status', 'Time', 'Splits']
    const esc = (v) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [head.join(',')]
    for (const r of shownFinishers) {
      lines.push([
        r.shownRank, r.runner.bib, r.runner.name, r.runner.category,
        r.heat?.name ?? '', 'FIN', fmt(r.elapsed),
        r.laps.map((l) => fmtShort(l.split)).join(' | '),
      ].map(esc).join(','))
    }
    for (const r of shownDnf) {
      lines.push(['', r.runner.bib, r.runner.name, r.runner.category,
        r.heat?.name ?? '', r.status.toUpperCase(), '', ''].map(esc).join(','))
    }
    const csv = lines.join('\n')
    navigator.clipboard?.writeText(csv).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1600) },
      () => {},
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${event.name.replace(/[^\w-]+/g, '_')}_results.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="app">
      <div className="topbar">
        <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>
        <div className="spacer" />
        {anyRunning ? <span className="pill live">● Live</span> : <span className="pill done">Results</span>}
      </div>

      <h1 style={{ margin: 0, fontSize: 28 }}>{event.name}</h1>
      <div className="muted tiny" style={{ textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 6, marginBottom: 16 }}>
        {event.date} · {event.numLaps} laps · {shownFinishers.length} finished
      </div>

      {heats.length > 1 && (
        <div className="chips">
          <button className={`chip${heatFilter === 'all' ? ' on' : ''}`} onClick={() => setHeatFilter('all')}>
            All heats
          </button>
          {heats.map((h) => (
            <button
              key={h.id}
              className={`chip${heatFilter === h.id ? ' on' : ''}`}
              onClick={() => setHeatFilter(h.id)}
            >
              {h.name}
            </button>
          ))}
        </div>
      )}

      {shownFinishers.length === 0 && shownProgress.length === 0 && shownDnf.length === 0 && (
        <div className="empty">
          <div className="display">No times yet</div>
          Start a heat and standings appear here live.
        </div>
      )}

      {shownFinishers.length > 0 && (
        <table className="results">
          <thead>
            <tr>
              <th></th>
              <th>Runner</th>
              <th style={{ textAlign: 'right' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {shownFinishers.map((r) => (
              <tr key={r.runner.id}>
                <td className="rank">{r.shownRank}</td>
                <td>
                  <div className="r-name"><strong>{r.runner.bib}</strong> {r.runner.name}</div>
                  <div className="splits">
                    {r.laps.map((l) => fmtShort(l.split)).join(' · ')}
                    {heatFilter === 'all' && r.heat && ` · ${r.heat.name}`}
                  </div>
                </td>
                <td className="time" style={{ textAlign: 'right' }}>{fmt(r.elapsed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {shownProgress.length > 0 && (
        <>
          <h2 className="sec-head">On course</h2>
          <div className="list">
            {shownProgress.map((r) => (
              <div className="item" key={r.runner.id}>
                <span className="bib">{r.runner.bib}</span>
                <span className="name grow">{r.runner.name}</span>
                <span className="pill live">lap {r.lapsDone}/{r.requiredLaps}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {shownDnf.length > 0 && (
        <>
          <h2 className="sec-head">Did not finish</h2>
          <div className="list">
            {shownDnf.map((r) => (
              <div className="item" key={r.runner.id}>
                <span className="bib">{r.runner.bib}</span>
                <span className="name grow">{r.runner.name}</span>
                <span className="pill">{r.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {(shownFinishers.length > 0 || shownDnf.length > 0) && (
        <button className="btn block" style={{ marginTop: 22 }} onClick={exportCsv}>
          {copied ? '✓ Copied + downloaded' : 'Export CSV'}
        </button>
      )}

      {notStarted.length > 0 && heatFilter === 'all' && (
        <div className="muted tiny" style={{ marginTop: 18 }}>
          {notStarted.length} not yet started.
        </div>
      )}

      <div style={{ height: 24 }} />
    </div>
  )
}

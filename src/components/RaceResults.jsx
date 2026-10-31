import { useEffect, useState } from 'react'
import { useStore, standings, heatsInEvent } from '../lib/store.js'
import { adminCall, NotAdminError } from '../lib/online.js'
import { fmt } from '../lib/time.js'
import { classesIn, fastestLaps, podiums, recordRows } from '../lib/raceResults.js'
import { drawResults, sharePicture } from '../lib/shareImage.js'
import ResultCorrections from './ResultCorrections.jsx'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Race admin's Results tab: each runner's fastest lap, a picture of the top
// three per class to post, and sending the times to the race website's
// records list (where they wait for approval before anyone sees them).
export default function RaceResults({ event, askConfirm, offerUndo }) {
  const st = useStore((s) => standings(s, event.id))
  const heats = useStore((s) => heatsInEvent(s, event.id))
  const [cls, setCls] = useState(null) // null = all classes
  const [picture, setPicture] = useState(null) // { blob, url }
  // Off unless the organiser turns it on for this picture (see shareImage.js).
  const [mascot, setMascot] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // { text, error }

  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.url) }, [picture])

  const rows = [...st.finishers, ...st.inProgress, ...st.didNotFinish]
  const laps = fastestLaps(rows)
  const shown = cls == null ? laps : laps.filter((x) => (x.runner.category || '') === cls)
  const pods = podiums(st.finishers)
  const open = heats.filter((h) => h.status !== 'done').length
  const toRecords = recordRows(st.finishers)

  async function makePicture(withMascot = mascot) {
    setBusy(true); setNote(null)
    try {
      const blob = await drawResults({ title: event.name, date: event.date, podiums: pods, mascot: withMascot })
      setPicture({ blob, url: URL.createObjectURL(blob) })
    } catch { setNote({ text: 'Could not make the picture on this phone.', error: true }) }
    finally { setBusy(false) }
  }

  async function share() {
    const how = await sharePicture(picture.blob, event.name)
    if (how === 'downloaded') setNote({ text: 'Saved as resultater.png. Post it from your photos.' })
  }

  function sendToRecords() {
    askConfirm({
      title: `Send ${plural(toRecords.length, 'time')} to the records list?`,
      body:
        'Women’s, men’s and relay finishing times go to the race website’s approval queue, rounded up to whole seconds, with each lap’s time. ' +
        'Nothing is public until you approve each one there, so check that the runners are happy to be listed. ' +
        'A runner already sent is not added twice; sending again fills in their lap times.',
      confirmLabel: 'Send',
      onConfirm: async () => {
        setBusy(true); setNote(null)
        try {
          const res = await adminCall(event.id, 'tk_admin_eksporter_resultater', { p_rader: toRecords })
          const sent = res?.sendt ?? 0
          const before = res?.oppdatert ?? toRecords.length - sent
          setNote({ text: `${plural(sent, 'time')} sent to the approval queue${before ? `; ${before} sent before, lap times filled in` : ''}.` })
        } catch (e) {
          setNote({ text: e instanceof NotAdminError ? 'Only the admin link can do this.' : `Not sent: ${e.message}`, error: true })
        } finally { setBusy(false) }
      },
    })
  }

  return (
    <div className="stack" style={{ marginTop: 14, gap: 14 }}>
      {open > 0 && (
        <div className="card muted" style={{ fontSize: 15 }}>
          {plural(open, 'heat')} not finished yet, so these results can still change.
        </div>
      )}

      <h2 className="admin-h" style={{ marginTop: 6 }}>Results</h2>
      {st.finishers.length + st.didNotFinish.length === 0 ? (
        <div className="muted">Nobody has finished yet.</div>
      ) : (
        <>
          <ResultCorrections event={event} finishers={st.finishers} out={st.didNotFinish} askConfirm={askConfirm} offerUndo={offerUndo} />
          <div className="muted tiny">Tap Edit to correct a name, a bib or a finishing time. Each change asks first and can be undone.</div>
        </>
      )}

      <h2 className="admin-h">Fastest laps</h2>
      {laps.length === 0 ? (
        <div className="muted">No laps recorded yet.</div>
      ) : (
        <>
          <div className="chips">
            <button className={`chip${cls == null ? ' on' : ''}`} onClick={() => setCls(null)}>All</button>
            {classesIn(laps.map((x) => ({ runner: x.runner }))).map((c) => (
              <button key={c} className={`chip${cls === c ? ' on' : ''}`} onClick={() => setCls(c)}>{c || 'No class'}</button>
            ))}
          </div>
          <div className="stack" style={{ gap: 0 }}>
            {shown.map((x, i) => (
              <div key={x.runner.id} className="admin-row row" style={{ gap: 10 }}>
                <span className="display" style={{ width: 28, color: i < 3 ? 'var(--amber)' : 'var(--muted)' }}>{i + 1}</span>
                <span style={{ width: 44, fontWeight: 700 }}>{x.runner.bib}</span>
                <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {x.runner.name}
                  <span className="muted tiny"> · lap {x.lap}{x.status !== 'ok' ? ` · ${x.status.toUpperCase()}` : ''}</span>
                </span>
                <span className="display" style={{ fontSize: 20 }}>{fmt(x.ms)}</span>
              </div>
            ))}
          </div>
          <div className="muted tiny">Each runner’s fastest lap. Lap 1 is from the start.</div>
        </>
      )}

      <h2 className="admin-h">Share the top 3</h2>
      {pods.length === 0 ? (
        <div className="muted">The picture can be made once someone has finished.</div>
      ) : (
        <div className="card stack" style={{ gap: 10 }}>
          <div className="muted" style={{ fontSize: 15 }}>
            A picture of the top three in each class, sized for an Instagram post. Share it straight from the phone.
          </div>
          <label className="row" style={{ gap: 10 }}>
            <input type="checkbox" checked={mascot} disabled={busy}
              onChange={(e) => { setMascot(e.target.checked); if (picture) makePicture(e.target.checked) }}
              style={{ width: 20, height: 20, flex: 'none', margin: 0, accentColor: 'var(--amber)' }} />
            <span>Show the mascot</span>
          </label>
          {mascot && (
            <div className="muted tiny">
              Beer imagery in a post about an event can count as alcohol advertising (in Norway, alkoholloven § 9-2). Your call per post.
            </div>
          )}
          {picture && <img src={picture.url} alt="Results picture: the top three in each class" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />}
          <div className="row" style={{ gap: 8 }}>
            <button className={`btn grow${picture ? '' : ' primary'}`} disabled={busy} onClick={() => makePicture()}>
              {picture ? 'Make it again' : 'Make the picture'}
            </button>
            {picture && <button className="btn primary grow" onClick={share}>Share</button>}
          </div>
        </div>
      )}

      <h2 className="admin-h">Records list</h2>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="muted" style={{ fontSize: 15 }}>
          Send the women’s and men’s times to the race website’s records list. They wait in its approval queue until you approve them.
        </div>
        <button className="btn" disabled={busy || toRecords.length === 0} onClick={sendToRecords}>
          {toRecords.length ? `Send ${plural(toRecords.length, 'time')}` : 'No finishing times to send yet'}
        </button>
      </div>

      {note && <div className={note.error ? 'form-error' : 'muted tiny'} role="status">{note.text}</div>}
    </div>
  )
}

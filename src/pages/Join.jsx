import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { joinWithLink, isAccessError, isNameError } from '../lib/online.js'
import { supabaseConfigured } from '../lib/supabase.js'
import TimerCode from '../components/TimerCode.jsx'

// Where a timing link lands: /join/<eventId>#<token>. The token sits after the
// # so it is never sent to the web server or written to its logs. It is kept
// with the event on this phone, so the link is only needed once per phone.
// A timer link also asks for the timer's name (TimerCode) before it opens.
export default function Join() {
  const { eventId } = useParams()
  const nav = useNavigate()
  const [error, setError] = useState(null)
  const [needName, setNeedName] = useState(null) // the server's hint, when it asks for a name
  const token = decodeURIComponent(window.location.hash.slice(1))

  useEffect(() => {
    if (!token) { setError('This link is incomplete. Ask the organiser to send it again.'); return }
    if (!supabaseConfigured) {
      // Most likely an old copy of the app from the offline cache, saved before
      // the server was set up: the service worker serves it once more and
      // fetches the new version in the background. Reload once to get it.
      let tried = false
      try { tried = sessionStorage.getItem('bmtk:join-reload') === '1' } catch { /* reload anyway */ }
      if (!tried) {
        try { sessionStorage.setItem('bmtk:join-reload', '1') } catch { /* see above */ }
        navigator.serviceWorker?.getRegistration()
          .then((reg) => reg?.update())
          .catch(() => {})
          .finally(() => window.location.reload())
        return
      }
      setError('This copy of the app is not connected to the results server.')
      return
    }
    let cancelled = false
    joinWithLink(eventId, token).then(
      (ev) => { if (!cancelled) nav(`/event/${ev.id}/setup`, { replace: true }) },
      (e) => {
        if (cancelled) return
        if (isNameError(e)) { setNeedName(isNameError(e)); return }
        setError(isAccessError(e)
          ? 'This timing link is no longer valid. Ask the organiser for the new one.'
          : 'Could not reach the server. Check your signal and open the link again.')
      },
    )
    return () => { cancelled = true }
  }, [eventId, nav, token])

  if (needName) {
    return (
      <div className="app">
        <h1 style={{ margin: '8px 0 14px', fontSize: 26 }}>Timing</h1>
        <TimerCode eventId={eventId} token={token} hint={needName}
          onIn={(ev) => nav(`/event/${ev.id}/setup`, { replace: true })} />
      </div>
    )
  }

  return (
    <div className="app">
      {error ? (
        <div className="empty">
          <div className="display">Can’t open the race</div>
          {error}
          <div style={{ marginTop: 18 }}><Link to="/" className="btn">Home</Link></div>
        </div>
      ) : (
        <div className="empty">
          <div className="display">Opening the race…</div>
        </div>
      )}
    </div>
  )
}

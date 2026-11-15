import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrganiser, sendLoginLink, logOut, myRaces, openMyRace, supabaseConfigured } from '../lib/organiser.js'

// The home page's organiser corner: log in by email to make shared races,
// and the races you made, to open on this phone (handy on a new phone).
export default function OrganiserPanel() {
  const user = useOrganiser()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [races, setRaces] = useState(null)

  useEffect(() => {
    if (!user) { setRaces(null); return }
    myRaces().then(setRaces).catch(() => setRaces([]))
  }, [user])

  if (!supabaseConfigured || user === undefined) return null

  async function login(e) {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Write your email address.'); return }
    setBusy(true); setError('')
    try { await sendLoginLink(email); setSent(true) }
    catch (err) { setError(`Could not send the link: ${err.message}`) }
    finally { setBusy(false) }
  }

  async function open(race) {
    setBusy(true); setError('')
    try { await openMyRace(race); nav(`/event/${race.id}/admin`) }
    catch (err) { setError(`Could not open it: ${err.message}`) }
    finally { setBusy(false) }
  }

  if (!user) {
    return (
      <div className="card stack" style={{ marginTop: 16, gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Organiser login</div>
        {sent ? (
          <div className="muted" style={{ fontSize: 15 }}>
            Check your email: the link logs you in on the phone or computer where you open it.
            <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setSent(false)}>Use another address</button>
          </div>
        ) : (
          <form className="row" style={{ gap: 8 }} onSubmit={login}>
            <input className="grow" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} style={{ minWidth: 0 }} aria-label="Email" />
            <button className="btn" disabled={busy}>{busy ? '…' : 'Send link'}</button>
          </form>
        )}
        <div className="muted tiny">
          Log in to make a shared race, timed by several phones. No password: you get a link by email.
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
    )
  }

  return (
    <div className="card stack" style={{ marginTop: 16, gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>My shared races</div>
          <div className="muted tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Logged in as {user.email}</div>
        </div>
        <button className="btn ghost sm" onClick={() => logOut()}>Log out</button>
      </div>
      {races == null ? <div className="muted tiny">Loading…</div> : races.length === 0 ? (
        <div className="muted tiny">None yet. Tap “New event” and choose a shared race.</div>
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          {races.map((r) => (
            <button key={r.id} className="admin-row row live-heat" disabled={busy} onClick={() => open(r)}>
              <span className="grow" style={{ textAlign: 'left', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span className="muted tiny">{[r.date, `${r.runners} runners`].filter(Boolean).join(' · ')}</span>
              <span className="muted" aria-hidden>›</span>
            </button>
          ))}
        </div>
      )}
      <div className="muted tiny">Races are deleted automatically three months after their date.</div>
      {error && <div className="form-error">{error}</div>}
    </div>
  )
}

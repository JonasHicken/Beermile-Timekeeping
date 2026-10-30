import { setMyTimer } from '../lib/store.js'

// A timer saying who they are, once per phone: the admin gives runners to
// names, and this is how a phone knows which runners are its own.
export default function WhoAmI({ event }) {
  const names = event.online.timers ?? []
  const me = event.online.me
  if (!names.length) {
    return (
      <div className="card muted" style={{ fontSize: 15 }}>
        The organiser has not named the timers yet, so you can time every runner. Your name appears here once they have.
      </div>
    )
  }
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div style={{ fontWeight: 700 }}>{me ? `You are timing as ${me}` : 'Who are you?'}</div>
      {!me && <div className="muted tiny">Pick your name to see the runners you are timing.</div>}
      <div className="row wrap" style={{ gap: 6 }}>
        {names.map((n) => (
          <button key={n} className={`chip${n === me ? ' on' : ''}`} onClick={() => setMyTimer(event.id, n === me ? null : n)} aria-pressed={n === me}>
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

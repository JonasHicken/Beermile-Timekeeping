import { t, plural, LANGS, useLang, setLang } from '../lib/i18n.js'
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
      const ev = await createSharedRace({ name: name.trim() || t('Race'), date, format })
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
        <div className="spacer" />
        <LangSwitch />
      </div>

      {!creating && (
        <button className="btn primary lg block" onClick={() => setCreating(true)}>
          {t('+ New event')}
        </button>
      )}

      {creating && (
        <form className="card stack" onSubmit={create}>
          <div>
            <label className="label">{t('Event name')}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Club championship 2027')}
            />
          </div>
          <div>
            <label className="label">{t('Date')}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">{t('Event')}</label>
            <EventFormatEditor value={format} onSave={setFormat} compact />
          </div>
          {user && (
            <label className="row" style={{ gap: 10 }}>
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)}
                style={{ width: 20, height: 20, flex: 'none', margin: 0, accentColor: 'var(--amber)' }} />
              <span className="grow">
                {t('Shared race')}
                <span className="muted tiny" style={{ display: 'block' }}>{t('Timed by several phones: you get an admin link, and a timer link to send to helpers.')}</span>
              </span>
            </label>
          )}
          {error && <div className="form-error">{error}</div>}
          <div className="row">
            <button type="button" className="btn ghost grow" onClick={() => setCreating(false)}>
              {t('Cancel')}
            </button>
            <button type="submit" className="btn primary grow" disabled={busy}>{busy ? t('Creating…') : t('Create')}</button>
          </div>
        </form>
      )}

      <OrganiserPanel />
      <HelpBox />

      <div style={{ height: 20 }} />

      {events.length === 0 && !creating && (
        <div className="empty">
          <div className="display">{t('Race day starts here')}</div>
          {t('Create an event to build your start list.')}
        </div>
      )}

      <div className="list">
        {events.map((ev) => (
          <EventRow key={ev.id} ev={ev} onOpen={() => nav(`/event/${ev.id}/setup`)}
            onLive={() => nav(`/event/${ev.id}/live`)}
            onHeat={(h) => nav(`/event/${ev.id}/heat/${h.id}`)}
            onDelete={() => askConfirm({
              title: t('Delete {name}?', { name: ev.name }),
              body: t('Removes the event, its start list, heats and every recorded time. You can undo it straight after.'),
              confirmLabel: t('Delete event'),
              danger: true,
              onConfirm: () => {
                const snap = deleteEvent(ev.id)
                offerUndo(t('Deleted {name}', { name: ev.name }), () => restoreEvent(snap))
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
            {ev.name} {ev.online && <span className="pill live" style={{ verticalAlign: 3 }}>{t('Shared')}</span>}
          </div>
          <div className="ev-meta">
            {ev.date} · {describe(formatOf(ev))} · {plural(runners, 'runner')} · {plural(heats, 'heat')}
          </div>
          {running && <div className="running-note">● {t('{name} is running', { name: running.name })}</div>}
        </div>
        <button className="btn ghost danger" onClick={onDelete} aria-label={t('Delete')}>✕</button>
      </div>
      <div className="row">
        {running
          ? <button className="btn primary grow" onClick={() => onHeat(running)}>{t('Resume {name}', { name: running.name })}</button>
          : <button className="btn grow" onClick={onOpen}>{t('Setup / Time')}</button>}
        <button className="btn grow" onClick={onLive}>{t('Results')}</button>
      </div>
    </div>
  )
}

// Norsk / English, kept on this phone.
function LangSwitch() {
  const lang = useLang()
  return (
    <div className="chips lang-switch" role="radiogroup" aria-label="Språk / Language">
      {LANGS.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={lang === l.id}
          className={`chip${lang === l.id ? ' on' : ''}`} onClick={() => setLang(l.id)} lang={l.id === 'no' ? 'nb' : 'en'}>
          {l.id === 'no' ? 'NO' : 'EN'}
        </button>
      ))}
    </div>
  )
}

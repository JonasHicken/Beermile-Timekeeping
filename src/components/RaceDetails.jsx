import { t } from '../lib/i18n.js'
import { useEffect, useState } from 'react'
import EventFormatEditor from './EventFormatEditor.jsx'
import { formatOf } from '../lib/eventFormat.js'
import { adminLink } from '../lib/online.js'

// Race admin's "Race" card: the race itself, as the race website shows it.
// Name and date reach the timing too; time and venue are on the race page.
// Every change is saved at once and can be undone.
//   call(fn, args)      -> the server's answer, or undefined after saying why not
//   undoable(label, fn) -> offers Undo
export default function RaceDetails({ event, busy, call, undoable, onFormat }) {
  const [info, setInfo] = useState(null) // { tittel, dato, tid, sted, vis_resultater, koblet }
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    call('tk_admin_lopsinfo', {}).then((res) => {
      if (!live) return
      if (res === undefined) setFailed(true)
      else setInfo(res)
    })
    return () => { live = false }
    // Once per race: the call itself refreshes the start list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id])

  async function save(change, label) {
    const before = Object.fromEntries(Object.keys(change).map((k) => [k, info?.[k] ?? null]))
    const res = await call('tk_admin_sett_lop', { p_endring: change })
    if (res === undefined) return false
    setInfo(res)
    undoable(label, async () => {
      const back = await call('tk_admin_sett_lop', { p_endring: before })
      if (back !== undefined) setInfo(back)
    })
    return true
  }


  if (failed && !info) {
    return (
      <div className="card stack" style={{ marginTop: 14, gap: 8 }}>
        <div className="muted">{t('The race’s details could not be loaded.')}</div>
        <EventRow event={event} busy={busy} onFormat={onFormat} />
      </div>
    )
  }

  return (
    <div className="card stack" style={{ marginTop: 14, gap: 12 }}>
      {!info ? <div className="muted tiny">{t('Loading the race…')}</div> : (
        <>
          <TextRow label={t('Name')} value={info.tittel} max={120} busy={busy} required
            onSave={(v) => save({ tittel: v }, `${t('Name')}: ${v}`)} />
          <label className="stack" style={{ gap: 4 }}>
            <span className="label">{t('Date')}</span>
            <input type="date" value={info.dato ?? ''} disabled={busy}
              onChange={(e) => save({ dato: e.target.value || null }, `${t('Date')}: ${e.target.value || t('none')}`)} />
          </label>
          <EventRow event={event} busy={busy} onFormat={onFormat} />
          <TextRow label={t('Start time')} value={info.tid} max={60} busy={busy} placeholder={t('18:00, or meet at 17:30')}
            onSave={(v) => save({ tid: v }, `${t('Start time')}: ${v || t('none')}`)} />
          <TextRow label={t('Venue')} value={info.sted} max={160} busy={busy}
            onSave={(v) => save({ sted: v }, `${t('Venue')}: ${v || t('none')}`)} />

          <Switch on={info.vis_resultater} busy={busy} label={t('Results on the race page')}
            hint={info.vis_resultater ? t('Anyone with the results link sees them live.') : t('Hidden: only the timing phones see them.')}
            onChange={(v) => save({ vis_resultater: v }, v ? t('Results shown') : t('Results hidden'))} />

          <AdminLinkRow event={event} />
          {info.koblet && (
            <div className="muted tiny">
              {t('Linked to {site}: its sign-ups come in from there, and the Results tab can send the times back.', { site: info.koblet })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function EventRow({ event, busy, onFormat }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="label">{t('Event')}</span>
      <EventFormatEditor value={formatOf(event)} busy={busy} onSave={onFormat} />
    </div>
  )
}

// A text field with its own Save, so a half-typed name is never sent.
function TextRow({ label, value, max, busy, required, placeholder, onSave }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  const v = draft.trim()
  const changed = v !== (value ?? '').trim()
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span className="label">{label}</span>
      <div className="row" style={{ gap: 8 }}>
        <input className="grow" value={draft} maxLength={max} placeholder={placeholder} style={{ minWidth: 0 }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && changed && (v || !required)) onSave(v) }} />
        {changed && <button className="btn" disabled={busy || (required && !v)} onClick={() => onSave(v)}>{t('Save')}</button>}
      </div>
    </label>
  )
}

function Switch({ on, busy, label, hint, onChange }) {
  return (
    <label className="row" style={{ gap: 10 }}>
      <input type="checkbox" checked={Boolean(on)} disabled={busy} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, flex: 'none', margin: 0, accentColor: 'var(--amber)' }} />
      <span className="grow">
        <span>{label}</span>
        <span className="muted tiny" style={{ display: 'block' }}>{hint}</span>
      </span>
    </label>
  )
}

// The admin link, to open the race as admin on another phone or to link a
// website to it. It gives full control of the race, so it is behind a button.
function AdminLinkRow({ event }) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const link = adminLink(event)
  if (!link) return null
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500) }
    catch { window.prompt(t('Copy the admin link:'), link) }
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="label">{t('Admin link')}</span>
      {shown ? (
        <div className="row" style={{ gap: 8 }}>
          <code className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{link}</code>
          <button className="btn sm" onClick={copy}>{copied ? t('Copied') : t('Copy')}</button>
        </div>
      ) : (
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShown(true)}>{t('Show admin link')}</button>
      )}
      <div className="muted tiny">
        {t('Full control of the race: for your own other phones, or to link a website (paste it there). Never send it to timers; they get the timer link.')}
      </div>
    </div>
  )
}

import { t } from '../lib/i18n.js'
import { useState } from 'react'
import { joinWithLink, isNameError, isAccessError } from '../lib/online.js'

// A timer getting in: the timer link alone does not open the race, the timer
// also types their name as the admin wrote it (upper/lower case does not
// matter). It works as a code, so a link that leaks is no use on its own.
// `hint` is why the server asked: 'trenger_navn', 'feil_navn' (e.g. the
// admin removed this name) or 'ingen_tidtakere'.
export default function TimerCode({ eventId, token, hint = 'trenger_navn', onIn }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(hint === 'feil_navn' ? t('Your name is no longer on the list of timers. Ask the admin.') : null)
  const [none, setNone] = useState(hint === 'ingen_tidtakere')

  async function submit(e) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const ev = await joinWithLink(eventId, token, name.trim())
      setNone(false)
      onIn?.(ev)
    } catch (err) {
      const h = isNameError(err)
      if (h === 'ingen_tidtakere') { setNone(true); setError(null) }
      else if (h) setError(t('That name is not on the list of timers. Check the spelling with the admin.'))
      else if (isAccessError(err)) setError(t('This timing link is no longer valid. Ask the admin for the new one.'))
      else setError(t('Could not reach the server. Check your signal and try again.'))
    } finally { setBusy(false) }
  }

  return (
    <form className="card stack" style={{ gap: 10 }} onSubmit={submit}>
      <strong>{t('Type your name to start timing')}</strong>
      <div className="muted tiny">
        {none
          ? t('The admin has not added any timers yet. Try again once they have.')
          : t('Your name is your code: write it the way the admin added you.')}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Your name')} aria-label={t('Your name')}
        autoComplete="off" autoCapitalize="words" maxLength={30} />
      {error && <div className="form-error">{error}</div>}
      <button className="btn primary" type="submit" disabled={busy || !name.trim()}>{busy ? t('Checking…') : t('Start timing')}</button>
    </form>
  )
}

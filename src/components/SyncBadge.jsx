import { t } from '../lib/i18n.js'
import { useEffect, useState } from 'react'
import { useStore, pendingCount } from '../lib/store.js'
import { useSyncStatus } from '../lib/online.js'

// One glance answer to "are my taps reaching the results page?". Timing never
// depends on it: taps are stored on the phone first and sent when possible.
export default function SyncBadge({ eventId }) {
  const st = useSyncStatus(eventId)
  const waiting = useStore((s) => pendingCount(s, eventId))
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])

  let kind = 'wait'
  let text = t('Connecting…')
  if (st?.denied) { kind = 'bad'; text = t('Link no longer valid') }
  else if (st?.needName) { kind = 'bad'; text = waiting ? t('Name needed · {n} waiting', { n: waiting }) : t('Name needed') }
  else if (st?.ok && Date.now() - st.at < 10000) {
    kind = waiting ? 'wait' : 'ok'
    text = waiting ? t('Sending {n}…', { n: waiting }) : t('Live')
  } else if (st && !st.ok) {
    kind = 'bad'
    text = waiting ? t('Offline · {n} waiting', { n: waiting }) : t('Offline')
  }
  return (
    <span className={`sync-badge ${kind}`} role="status" aria-live="polite">
      <span className="sync-dot" />{text}
    </span>
  )
}

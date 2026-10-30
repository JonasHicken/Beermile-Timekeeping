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
    const t = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(t)
  }, [])

  let kind = 'wait'
  let text = 'Connecting…'
  if (st?.denied) { kind = 'bad'; text = 'Link no longer valid' }
  else if (st?.needName) { kind = 'bad'; text = waiting ? `Name needed · ${waiting} waiting` : 'Name needed' }
  else if (st?.ok && Date.now() - st.at < 10000) {
    kind = waiting ? 'wait' : 'ok'
    text = waiting ? `Sending ${waiting}…` : 'Live'
  } else if (st && !st.ok) {
    kind = 'bad'
    text = waiting ? `Offline · ${waiting} waiting` : 'Offline'
  }
  return (
    <span className={`sync-badge ${kind}`} role="status" aria-live="polite">
      <span className="sync-dot" />{text}
    </span>
  )
}

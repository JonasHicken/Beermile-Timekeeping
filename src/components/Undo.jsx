import { useEffect, useState } from 'react'

const UNDO_MS = 12000

// Every destructive action offers Undo afterwards, as well as (or instead of)
// asking first. A confirmation only helps if the mistake is noticed before the
// tap; an Undo bar catches the one noticed a second after.
//
// Usage:  const [undoNode, offerUndo] = useUndo()
//         offerUndo('Removed Ola Nordmann', () => restoreEvent(snap))
//         ...then render {undoNode}
export function useUndo() {
  const [offer, setOffer] = useState(null)

  useEffect(() => {
    if (!offer) return
    const t = setTimeout(() => setOffer(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [offer])

  const node = offer ? (
    <div className="snackbar" role="status" key={offer.key}>
      <span className="grow">{offer.message}</span>
      <button
        className="btn sm primary"
        onClick={() => { offer.undo(); setOffer(null) }}
      >
        Undo
      </button>
      <button className="snack-x" onClick={() => setOffer(null)} aria-label="Dismiss">✕</button>
    </div>
  ) : null

  const offerUndo = (message, undo) => setOffer({ message, undo, key: Date.now() })
  return [node, offerUndo]
}

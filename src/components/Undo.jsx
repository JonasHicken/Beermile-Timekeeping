import { useEffect, useState } from 'react'

const UNDO_MS = 12000

// Every destructive action offers Undo afterwards, as well as (or instead of)
// asking first. A confirmation only helps if the mistake is noticed before the
// tap; an Undo bar catches the one noticed a second after.
//
// Offers stack: remove one runner, then another, and Undo takes back the
// second, then offers the first again. A single slot used to drop the first.
// Undoing in reverse order is what makes restoring snapshots safe. The bar
// stays while there is something to undo and nothing has happened for 12 s.
//
// Usage:  const [undoNode, offerUndo] = useUndo()
//         offerUndo('Removed Ola Nordmann', () => restoreEvent(snap))
//         ...then render {undoNode}
export function useUndo() {
  const [stack, setStack] = useState([])
  const top = stack[stack.length - 1]

  useEffect(() => {
    if (!stack.length) return
    const t = setTimeout(() => setStack([]), UNDO_MS)
    return () => clearTimeout(t)
  }, [stack])

  const node = top ? (
    <div className="snackbar" role="status" key={top.key}>
      <span className="grow">
        {top.message}
        {stack.length > 1 && <span className="muted"> · {stack.length - 1} more to undo</span>}
      </span>
      <button
        className="btn sm primary"
        onClick={() => { top.undo(); setStack((s) => s.slice(0, -1)) }}
      >
        Undo
      </button>
      <button className="snack-x" onClick={() => setStack([])} aria-label="Dismiss">✕</button>
    </div>
  ) : null

  const offerUndo = (message, undo) =>
    setStack((s) => [...s.slice(-9), { message, undo, key: Date.now() + Math.random() }])
  return [node, offerUndo]
}

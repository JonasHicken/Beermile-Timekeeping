import { useState, useEffect } from 'react'

// In-app confirmation, replacing window.confirm().
//
// Native dialogs are not safe for this app: browsers offer "prevent this page
// from creating additional dialogs" after a few in a row, and once that's set
// every confirm() silently returns false — so the button it guards looks dead
// with no error and no way for the user to tell why. That is exactly what
// happened to "Finish heat". Native dialogs also block the main thread and
// can't be styled, which is the wrong trade mid-race.
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="display" style={{ fontSize: 23 }}>{title}</div>
        {body && <p className="muted" style={{ margin: '10px 0 0' }}>{body}</p>}
        <div className="row" style={{ marginTop: 22 }}>
          <button className="btn ghost grow" onClick={onClose}>Cancel</button>
          <button
            className={`btn grow ${danger ? 'danger-solid' : 'primary'}`}
            onClick={() => { onConfirm?.(); onClose() }}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}

// Usage:  const [confirmNode, askConfirm] = useConfirm()
//         askConfirm({ title, body, confirmLabel, danger, onConfirm })
//         ...then render {confirmNode}
export function useConfirm() {
  const [pending, setPending] = useState(null)
  const node = pending
    ? <ConfirmDialog {...pending} onClose={() => setPending(null)} />
    : null
  return [node, setPending]
}

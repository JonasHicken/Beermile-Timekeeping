import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  useStore, getEvent, getHeat, runnersInHeat, crossingsInHeat, heatsInEvent,
  startHeat, finishHeat, reopenHeat, resetHeat, undoReset, recordCrossing, undoLastCrossing,
  acceptRejectedTap, requiredLaps, statusOf, roleOf, canTime, timerHeat,
} from '../lib/store.js'
import { fmt, nowMs } from '../lib/time.js'
import { useUndo } from '../components/Undo.jsx'
import { useOnlineSync, useSyncStatus } from '../lib/online.js'
import SyncBadge from '../components/SyncBadge.jsx'
import RunnerSheet from '../components/RunnerSheet.jsx'
import { useConfirm } from '../components/Confirm.jsx'
import TimerCode from '../components/TimerCode.jsx'

export default function Timing() {
  const { eventId, heatId } = useParams()
  const nav = useNavigate()
  const event = useStore((s) => getEvent(s, eventId))
  const heat = useStore((s) => getHeat(s, heatId))
  const heats = useStore((s) => heatsInEvent(s, eventId))
  const runners = useStore((s) => runnersInHeat(s, heatId))
  const crossings = useStore((s) => crossingsInHeat(s, heatId))

  const [flashId, setFlashId] = useState(null)
  const [toast, setToast] = useState(null)
  // One timer for the message, kept across renders. It used to hang off the
  // showToast function, which is new on every render, so an older tap's timer
  // was never cleared and hid a newer message early — including the 6 s ones
  // with a button, in exactly the quick-tap moments they are for.
  const toastTimer = useRef(null)
  const [sheetRunner, setSheetRunner] = useState(null)
  const [hideFinished, setHideFinished] = useState(false)
  const [confirmNode, askConfirm] = useConfirm()
  const [undoNode, offerUndo] = useUndo()
  const wakeRef = useRef(null)
  const online = Boolean(event?.online)
  useOnlineSync(eventId, online)
  const sync = useSyncStatus(eventId)
  // A timer on a shared race neither starts nor finishes heats (the admin
  // does, and the server ignores it from a timer link) and sees only the
  // runners given to them. Before the server has said which role this phone
  // has, it behaves as it always did.
  const role = roleOf(event)
  const timer = role === 'timer' && Boolean(event?.online?.role)
  const isAdmin = !timer
  // Where a timer belongs. They are moved on by themselves once this heat is
  // done (or the admin moved all their runners elsewhere), so nobody has to
  // find their way around the app at the start line.
  const myHeat = useStore((s) => (timer && event.online.me ? timerHeat(s, event) : null))
  const myHeatIds = useStore((s) => (timer ? new Set(s.runners.filter((r) => r.eventId === eventId && event && canTime(event, r)).map((r) => r.heatId)) : null))
  const mineHere = useStore((s) => (timer ? s.runners.some((r) => r.heatId === heatId && canTime(event, r)) : true))
  useEffect(() => {
    if (!timer || !myHeat || myHeat === heatId) return
    if (heat?.status === 'done' || !mineHere) nav(`/event/${eventId}/heat/${myHeat}`, { replace: true })
  }, [timer, myHeat, heatId, heat?.status, mineHere, eventId, nav])

  // With several phones on one heat, each timer usually watches a few runners.
  // "Mine" is that set, kept on this phone only, and is just a filter: any
  // runner can still be tapped from "All".
  const mineKey = `bmtk:mine:${heatId}`
  const [mine, setMine] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(mineKey) || '[]')) } catch { return new Set() }
  })
  const [onlyMine, setOnlyMine] = useState(false)
  const [picking, setPicking] = useState(false)
  function toggleMine(id) {
    setMine((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { localStorage.setItem(mineKey, JSON.stringify([...next])) } catch { /* filter only */ }
      return next
    })
  }

  const running = heat?.status === 'running'

  // Keep the screen awake while timing.
  useEffect(() => {
    if (!running) return
    let released = false
    async function acquire() {
      try {
        wakeRef.current = await navigator.wakeLock?.request('screen')
      } catch { /* not supported / denied — fine */ }
    }
    acquire()
    const onVis = () => { if (document.visibilityState === 'visible' && !released) acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVis)
      wakeRef.current?.release?.().catch(() => {})
      wakeRef.current = null
    }
  }, [running])

  if (!event || !heat) {
    return (
      <div className="app">
        <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>
        <div className="empty">Heat not found.</div>
      </div>
    )
  }

  const counts = {}
  for (const c of crossings) counts[c.runnerId] = (counts[c.runnerId] || 0) + 1

  const rows = runners.filter((r) => !timer || canTime(event, r)).map((r) => {
    const need = requiredLaps(event, r)
    const done = counts[r.id] || 0
    const st = statusOf(r)
    return {
      runner: r,
      need,
      done,
      status: st,
      finished: st === 'ok' && done >= need,
      out: st !== 'ok',
    }
  })
  const finishedCount = rows.filter((x) => x.finished).length
  const outCount = rows.filter((x) => x.out).length
  const racingCount = rows.length - outCount
  const allIn = rows.length > 0 && finishedCount + outCount === rows.length
  const stillRacing = rows.filter((x) => !x.finished && !x.out)
  const mineCount = rows.filter((x) => mine.has(x.runner.id)).length
  const visible = rows
    .filter((x) => picking || !onlyMine || !mineCount || mine.has(x.runner.id))
    .filter((x) => picking || !hideFinished || (!x.finished && !x.out))

  // A message after a tap. With an action (count a held-back tap) it stays up
  // longer, so there is time to read it and press the button.
  function showToast(msg, action = null, ms = null) {
    setToast({ msg, action })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms ?? (action ? 6000 : 1400))
  }

  function tap(row) {
    if (picking) { toggleMine(row.runner.id); return }
    if (!running) {
      if (heat.status === 'done') showToast('Heat finished · Reopen to record laps')
      return
    }
    if (row.out) { showToast(`${row.runner.bib} is ${row.status.toUpperCase()}`); return }
    const c = recordCrossing(heatId, row.runner.id, 'tap')
    if (!c) return
    const bib = row.runner.bib
    // Another timer already has this crossing. That is the overlap working,
    // not a mis-tap, so no "use this tap": pressing it would swap the other
    // timer's earlier time for this later one.
    if (c.otherTimer) {
      // Both phones stamp server time, so the other tap can even be a hair
      // *later* than this one by the time it arrives; that reads "just now".
      const when = c.sinceMs < 1000 ? 'just now' : `${secs(c.sinceMs)} ago`
      showToast(`${bib} was already tapped by another timer ${when}. Not counted twice.`, null, 3500)
      return
    }
    if (c.afterFinish) {
      showToast(`${bib} already finished ${secs(c.sinceMs)} ago. Is this the real finish?`, {
        label: 'Use as finish',
        run: () => { acceptRejectedTap(c.id); showToast(`${bib} · finish moved to this tap`) },
      })
      return
    }
    // Held-back taps are kept in the log either way; these offer the one-step
    // fix while the timer still remembers what just happened.
    if (c.duplicate) {
      showToast(`${bib} already had a lap ${secs(c.sinceMs)} ago. Was that one a mis-tap?`, {
        label: 'Use this tap',
        run: () => { acceptRejectedTap(c.id); showToast(`${bib} · lap moved to this tap`) },
      })
      return
    }
    if (c.tooSoon) {
      showToast(`${bib}: only ${secs(c.sinceMs)} since ${row.done ? 'the last lap' : 'the start'}. Not counted.`, {
        label: 'Count it',
        run: () => { acceptRejectedTap(c.id); showToast(`${bib} · lap ${row.done + 1}`) },
      })
      return
    }
    setFlashId(row.runner.id)
    setTimeout(() => setFlashId((id) => (id === row.runner.id ? null : id)), 220)
    if (navigator.vibrate) navigator.vibrate(15)
    const nowDone = row.done + 1
    showToast(nowDone >= row.need ? `${row.runner.bib} FINISHED` : `${row.runner.bib} · lap ${nowDone}`)
  }

  function undo() {
    const last = undoLastCrossing(heatId)
    if (last) {
      showToast(`Undo ${last.bib} · lap ${last.lap}`)
      if (navigator.vibrate) navigator.vibrate([10, 40, 10])
    } else showToast(online ? 'None of your taps to undo' : 'Nothing to undo')
  }

  return (
    <div className="app timing">
      <div className="topbar">
        {timer
          ? <span className="muted tiny">{event.online.me ? `Timing as ${event.online.me}` : 'Timer'}</span>
          : <Link to={`/event/${eventId}/setup`} className="backlink">← Setup</Link>}
        <div className="spacer" />
        {online && <SyncBadge eventId={eventId} />}
        <button className="btn ghost" onClick={() => nav(`/event/${eventId}/heat/${heatId}/review`)}>Review</button>
        <button className="btn ghost" onClick={() => nav(`/event/${eventId}/live`)}>Results</button>
      </div>

      {/* heat switcher — jump between heats without going back to Setup */}
      {heats.filter((h) => !timer || myHeatIds?.has(h.id)).length > 1 && (
        <div className="chips">
          {heats.filter((h) => !timer || myHeatIds?.has(h.id)).map((h) => (
            <button
              key={h.id}
              className={`chip${h.id === heatId ? ' on' : ''}`}
              onClick={() => nav(`/event/${eventId}/heat/${h.id}`)}
            >
              {h.name}
              {h.status === 'running' && <span className="chip-dot" />}
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ alignItems: 'baseline', marginTop: 4 }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>{heat.name}</h1>
        {/* Out of the runners still racing: a DNF is not a runner left to wait for. */}
        <span className="muted tiny">
          {finishedCount}/{racingCount} finished{outCount > 0 && ` · ${outCount} out`}
        </span>
        <div className="spacer" />
        {running && <HeatClock startedAt={heat.startedAt} />}
      </div>

      {runners.length === 0 && (
        <div className="empty">
          <div className="display">Empty heat</div>
          Assign runners to it in Setup.
        </div>
      )}

      {timer && sync?.needName && (
        <div style={{ marginTop: 12 }}><TimerCode eventId={eventId} token={event.online.token} hint={sync.needName} /></div>
      )}

      {heat.status === 'pending' && runners.length > 0 && isAdmin && (
        <div className="card stack center" style={{ marginTop: 24, padding: 28 }}>
          <div className="display" style={{ fontSize: 22 }}>{runners.length} on the line</div>
          <div className="muted">
            Mass start — tap when the gun goes.
            {online && " The timers' phones start by themselves."}
          </div>
          {role === 'admin' && <TimerSummary runners={runners} names={event.online.timers ?? []} />}
          <button className="btn primary lg block" onClick={() => startHeat(heatId)}>
            ▶ Start heat
          </button>
        </div>
      )}

      {heat.status === 'pending' && timer && (
        <div className="card stack center" style={{ marginTop: 24, padding: 28 }}>
          <div className="display" style={{ fontSize: 22 }}>Waiting for the start</div>
          <div className="muted">
            The admin starts the heat, and your phone starts with it.
            {rows.length > 0 && ` You are timing ${plural(rows.length, 'runner')}:`}
          </div>
          {rows.length > 0 && (
            <div style={{ fontWeight: 700 }}>{rows.map((x) => x.runner.bib).join(', ')}</div>
          )}
        </div>
      )}

      {(running || heat.status === 'done') && (
        <>
          <div className="row wrap" style={{ gap: 6 }}>
            {finishedCount > 0 && !picking && (
              <button className="toggle" onClick={() => setHideFinished((v) => !v)}>
                <span className={`toggle-box${hideFinished ? ' on' : ''}`} />
                Hide finished ({finishedCount})
              </button>
            )}
            {mineCount > 0 && !picking && (
              <button className="toggle" onClick={() => setOnlyMine((v) => !v)}>
                <span className={`toggle-box${onlyMine ? ' on' : ''}`} />
                Only mine ({mineCount})
              </button>
            )}
            <div className="spacer" />
            {/* "Mine" splits a heat between several phones, which only exists
                in a shared race; on one phone it was a row of dead space. */}
            {online && isAdmin && (
              <button className={`btn sm${picking ? ' primary' : ' ghost'}`} onClick={() => { setPicking((v) => !v); if (picking && mineCount) setOnlyMine(true) }}>
                {picking ? 'Done' : 'Choose mine'}
              </button>
            )}
          </div>
          {picking && (
            <div className="muted tiny" style={{ marginTop: 6 }}>
              Tap the runners you are timing. Taps here only choose; no laps are recorded.
            </div>
          )}

          {visible.length === 0 && !picking && hideFinished && (
            <div className="empty" style={{ padding: '28px 10px' }}>
              <div className="display">Everyone is in</div>
              All {plural(rows.length, 'runner')} in this heat {outCount ? `have finished or are out (${outCount} out)` : 'have finished'}.
              Untick “Hide finished” to see their tiles and times.
            </div>
          )}

          <div className={`grid${runners.length > 12 ? ' dense' : ''}`} style={{ marginTop: 14 }}>
            {visible.map((row) => (
              <RunnerTile
                key={row.runner.id}
                row={row}
                flash={flashId === row.runner.id}
                picking={picking}
                isMine={mine.has(row.runner.id)}
                elapsed={row.finished ? finishElapsed(crossings, row.runner.id, row.need, heat.startedAt) : null}
                disabled={!running && !picking}
                onTap={() => tap(row)}
                onDetail={() => setSheetRunner(row.runner.id)}
              />
            ))}
          </div>

          {running && allIn && (
            <div className="heat-banner">
              Everyone is in: {finishedCount} finished{outCount > 0 && `, ${outCount} out`}. {isAdmin ? 'Finish the heat when you are ready.' : 'The admin finishes the heat.'}
            </div>
          )}

          {running && (
            <div className="actionbar">
              <button className="btn danger grow lg" onClick={undo}>↶ Undo</button>
              {isAdmin && <button
                className="btn grow lg"
                onClick={() =>
                  askConfirm(stillRacing.length
                    ? {
                        title: `${plural(stillRacing.length, 'runner')} still racing`,
                        body:
                          `${stillRacing.slice(0, 6).map((x) => `${x.runner.bib} (${x.done}/${x.need} laps)`).join(', ')}` +
                          `${stillRacing.length > 6 ? ' …' : ''} ${stillRacing.length === 1 ? 'has' : 'have'} not finished. ` +
                          'Finish anyway if they dropped out (mark them DNF), or keep timing. You can reopen the heat later.',
                        confirmLabel: 'Finish anyway',
                        danger: true,
                        onConfirm: () => finishHeat(heatId),
                      }
                    : {
                        title: 'Finish this heat?',
                        body: 'Everyone is in. Timing stops; you can still review and correct it, or reopen the heat.',
                        confirmLabel: 'Finish',
                        onConfirm: () => finishHeat(heatId),
                      })
                }
              >
                Finish heat
              </button>}
            </div>
          )}

          {heat.status === 'done' && !isAdmin && (
            <div className="actionbar">
              <button className="btn primary grow" onClick={() => nav(`/event/${eventId}/live`)}>
                Results
              </button>
            </div>
          )}

          {heat.status === 'done' && isAdmin && (
            <div className="actionbar">
              {/* Reopen keeps every crossing; Reset is the destructive one. */}
              <button className="btn grow" onClick={() => reopenHeat(heatId)}>
                Reopen
              </button>
              <button
                className="btn ghost danger"
                onClick={() =>
                  askConfirm({
                    title: `Reset ${heat.name}?`,
                    body: 'Clears every lap recorded in this heat and returns it to the start line. You can undo it straight after.',
                    confirmLabel: 'Reset heat',
                    danger: true,
                    onConfirm: () => {
                      const info = resetHeat(heatId)
                      offerUndo(`Reset ${heat.name}`, () => undoReset(info))
                    },
                  })
                }
              >
                Reset
              </button>
              <button className="btn primary grow" onClick={() => nav(`/event/${eventId}/live`)}>
                Results
              </button>
            </div>
          )}
        </>
      )}

      {sheetRunner && (
        <RunnerSheet
          eventId={eventId}
          heatId={heatId}
          runnerId={sheetRunner}
          onClose={() => setSheetRunner(null)}
          offerUndo={offerUndo}
        />
      )}

      {confirmNode}
      {undoNode}
      {toast && (
        <div className={`toast${toast.action ? ' has-action' : ''}`} role="status">
          <span>{toast.msg}</span>
          {toast.action && (
            <button className="toast-act" onClick={() => { const a = toast.action; setToast(null); a.run() }}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Who times whom in this heat, for the admin before the start.
function TimerSummary({ runners, names }) {
  if (!names.length) return <div className="muted tiny">No timers added yet, so only you can time this heat. Add them in Race admin.</div>
  const parts = names.map((n) => `${n} ${runners.filter((r) => r.timer === n).length}`)
  const nobody = runners.filter((r) => !r.timer).length
  if (nobody) parts.push(`only you ${nobody}`)
  return <div className="muted tiny">{parts.join(' · ')}</div>
}

const secs = (ms) => `${Math.max(0, Math.round(ms / 1000))} s`

function finishElapsed(crossings, runnerId, need, startedAt) {
  const cs = crossings.filter((c) => c.runnerId === runnerId).sort((a, b) => a.capturedAt - b.capturedAt)
  if (cs.length < need || startedAt == null) return null
  return cs[need - 1].capturedAt - startedAt
}

function HeatClock({ startedAt }) {
  // On the server's clock (nowMs), like the start time it is measured from.
  const [now, setNow] = useState(nowMs())
  useEffect(() => {
    const t = setInterval(() => setNow(nowMs()), 100)
    return () => clearInterval(t)
  }, [])
  return <span className="clock" style={{ fontSize: 26 }}>{fmt(now - startedAt)}</span>
}

function RunnerTile({ row, flash, elapsed, disabled, picking, isMine, onTap, onDetail }) {
  const { runner, need, done, finished, out, status } = row
  return (
    <div
      className={`tile${flash ? ' flash' : ''}${finished ? ' done' : ''}${out ? ' out' : ''}${picking ? ' picking' : ''}${picking && isMine ? ' mine-on' : ''}`}
      aria-pressed={picking ? isMine : undefined}
      onClick={onTap}
      role="button"
      tabIndex={disabled && !finished ? -1 : 0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap() } }}
      aria-disabled={disabled && !finished}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
        <span className="t-bib grow">
          {runner.bib}
          {runner.penaltyLaps > 0 && <span className="t-pen">+{runner.penaltyLaps}</span>}
        </span>
        <button
          className="t-more"
          onClick={(e) => { e.stopPropagation(); onDetail() }}
          aria-label={`Options for ${runner.bib}`}
        >
          ⋯
        </button>
      </div>
      <div className="t-name">{runner.name || ' '}</div>

      {out ? (
        <div className="t-status">{status.toUpperCase()}</div>
      ) : finished ? (
        <div className="t-final">{fmt(elapsed)}</div>
      ) : (
        <div className="t-laps">
          {Array.from({ length: need }).map((_, i) => (
            <span key={i} className={`lap-dot${i < done ? ' on' : ''}`} />
          ))}
        </div>
      )}
    </div>
  )
}

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store keeps its state in a module-level variable loaded from
// localStorage, so every test gets a fresh module over an empty storage.
let S
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  S = await import('../src/lib/store.js')
})

const T0 = 1_700_000_000_000
const sec = (n) => T0 + n * 1000

// An event with one running heat that started at T0, and the given bibs in it.
function race(bibs = ['1', '2', '3'], numLaps = 4) {
  const ev = S.createEvent({ name: 'Test', numLaps })
  const heat = S.createHeat(ev.id)
  const runners = bibs.map((bib) => {
    const r = S.addRunner(ev.id, { bib, name: `Runner ${bib}` })
    S.assignRunner(r.id, heat.id)
    return r
  })
  S.updateHeat(heat.id, { status: 'running', startedAt: T0 })
  return { ev, heat, runners }
}

const state = () => S.getState()
const result = (ev, heat, r) =>
  S.runnerResult(state(), S.getEvent(state(), ev.id), S.getHeat(state(), heat.id), S.getRunner(state(), r.id))

describe('recording laps', () => {
  it('counts laps and finishes a runner on the last one', () => {
    const { ev, heat, runners: [r] } = race(['7'])
    for (const t of [60, 120, 180, 240]) S.recordCrossing(heat.id, r.id, 'tap', sec(t))

    const res = result(ev, heat, r)
    expect(res.lapsDone).toBe(4)
    expect(res.finished).toBe(true)
    expect(res.elapsed).toBe(240_000)
    expect(res.laps.map((l) => l.split)).toEqual([60_000, 60_000, 60_000, 60_000])
  })

  it('does not count a lap beyond the required count, but keeps the tap', () => {
    const { heat, runners: [r] } = race(['7'], 2)
    S.recordCrossing(heat.id, r.id, 'tap', sec(60))
    const finish = S.recordCrossing(heat.id, r.id, 'tap', sec(120))
    const after = S.recordCrossing(heat.id, r.id, 'tap', sec(180))
    expect(after).toMatchObject({ afterFinish: true, prevId: finish.id, void: true, rejected: 'finished' })
    expect(S.lapCount(state(), heat.id, r.id)).toBe(2)
  })

  it('a mis-tap on the last lap is fixed by using the real finish', () => {
    const { ev, heat, runners: [r] } = race(['11'], 2)
    S.recordCrossing(heat.id, r.id, 'tap', sec(60))
    S.recordCrossing(heat.id, r.id, 'tap', sec(120)) // someone else crossed; 11 tapped
    const real = S.recordCrossing(heat.id, r.id, 'tap', sec(130))
    S.acceptRejectedTap(real.id)
    expect(result(ev, heat, r)).toMatchObject({ finished: true, elapsed: 130_000 })
  })

  it('treats a second tap inside the duplicate window as the same crossing, but keeps it', () => {
    const { heat, runners: [r] } = race(['7'])
    const first = S.recordCrossing(heat.id, r.id, 'tap', sec(60))
    const again = S.recordCrossing(heat.id, r.id, 'tap', sec(65))

    expect(again).toMatchObject({ duplicate: true, prevId: first.id, void: true, rejected: 'duplicate' })
    expect(S.lapCount(state(), heat.id, r.id)).toBe(1)
    // Not lost: it is in the log, struck through, for the timer to use.
    expect(S.allCrossingsInHeat(state(), heat.id)).toHaveLength(2)
  })

  it('a mis-tap followed by the real crossing is fixed in one step', () => {
    const { heat, runners: [r] } = race(['8'])
    const mistap = S.recordCrossing(heat.id, r.id, 'tap', sec(70))
    const real = S.recordCrossing(heat.id, r.id, 'tap', sec(80))
    expect(real.duplicate).toBe(true)

    S.acceptRejectedTap(real.id)
    const laps = S.crossingsForRunner(state(), heat.id, r.id)
    expect(laps.map((c) => c.id)).toEqual([real.id])
    expect(S.allCrossingsInHeat(state(), heat.id).find((c) => c.id === mistap.id).void).toBe(true)
  })

  it('holds back a lap faster than any real one until the timer confirms it', () => {
    const { heat, runners: [r] } = race(['7'])
    const bump = S.recordCrossing(heat.id, r.id, 'tap', sec(3))
    expect(bump).toMatchObject({ tooSoon: true, void: true, rejected: 'too-soon' })
    expect(S.lapCount(state(), heat.id, r.id)).toBe(0)

    S.acceptRejectedTap(bump.id)
    expect(S.lapCount(state(), heat.id, r.id)).toBe(1)
    // Measured from the runner's previous lap after the first.
    expect(S.recordCrossing(heat.id, r.id, 'tap', sec(30)).tooSoon).toBe(true)
    expect(S.recordCrossing(heat.id, r.id, 'tap', sec(30), { force: true }).tooSoon).toBeUndefined()
  })

  it('tags each crossing with its source, so RFID reads share the log', () => {
    const { heat, runners: [r] } = race(['7'])
    S.recordCrossing(heat.id, r.id, 'rfid', sec(60))
    expect(state().crossings[0].source).toBe('rfid')
  })
})

describe('corrections', () => {
  it('voiding a mid-race lap renumbers the laps after it', () => {
    const { ev, heat, runners: [r] } = race(['7'])
    const laps = [60, 120, 180].map((t) => S.recordCrossing(heat.id, r.id, 'tap', sec(t)))

    S.setCrossingVoid(laps[1].id, true)
    const res = result(ev, heat, r)

    expect(res.lapsDone).toBe(2)
    expect(res.laps.map((l) => l.lap)).toEqual([1, 2])
    // The old lap 3 is now lap 2, and its split spans the voided crossing.
    expect(res.laps[1]).toMatchObject({ id: laps[2].id, split: 120_000 })
  })

  it('never deletes: a voided crossing stays in the log', () => {
    const { heat, runners: [r] } = race(['7'])
    const c = S.recordCrossing(heat.id, r.id, 'tap', sec(60))
    S.setCrossingVoid(c.id, true)

    expect(S.crossingsInHeat(state(), heat.id)).toHaveLength(0)
    expect(S.allCrossingsInHeat(state(), heat.id)).toEqual([expect.objectContaining({ id: c.id, void: true })])
  })

  it('undo takes back the most recent lap in the heat', () => {
    const { heat, runners: [a, b] } = race(['1', '2'])
    S.recordCrossing(heat.id, a.id, 'tap', sec(60))
    const last = S.recordCrossing(heat.id, b.id, 'tap', sec(61))

    expect(S.undoLastCrossing(heat.id).id).toBe(last.id)
    expect(S.lapCount(state(), heat.id, a.id)).toBe(1)
    expect(S.lapCount(state(), heat.id, b.id)).toBe(0)
  })

  it('adds a missed lap at a typed time, in time order, and refuses nonsense', () => {
    const { ev, heat, runners: [r] } = race(['7'])
    S.recordCrossing(heat.id, r.id, 'tap', sec(60))
    S.recordCrossing(heat.id, r.id, 'tap', sec(180))

    const added = S.addLapAt(heat.id, r.id, sec(120))
    expect(added.source).toBe('manual')
    expect(result(ev, heat, r).laps.map((l) => l.split)).toEqual([60_000, 60_000, 60_000])

    expect(S.addLapAt(heat.id, r.id, sec(125)).error).toMatch(/15 seconds/)
    expect(S.addLapAt(heat.id, r.id, T0 - 1000).error).toMatch(/before the start/)
    S.addLapAt(heat.id, r.id, sec(240))
    expect(S.addLapAt(heat.id, r.id, sec(300)).error).toMatch(/already recorded/)
  })

  it('reassigning a mistap moves the lap to the right runner and marks it manual', () => {
    const { heat, runners: [a, b] } = race(['1', '2'])
    const c = S.recordCrossing(heat.id, a.id, 'tap', sec(60))
    S.reassignCrossing(c.id, b.id)

    expect(S.lapCount(state(), heat.id, a.id)).toBe(0)
    expect(S.crossingsForRunner(state(), heat.id, b.id)[0]).toMatchObject({ bib: '2', source: 'manual' })
  })

  it('reopening a finished heat keeps its timing; resetting throws it away', () => {
    const { heat, runners: [r] } = race(['7'])
    S.recordCrossing(heat.id, r.id, 'tap', sec(60))

    S.finishHeat(heat.id)
    S.reopenHeat(heat.id)
    expect(S.getHeat(state(), heat.id)).toMatchObject({ status: 'running', startedAt: T0 })
    expect(S.lapCount(state(), heat.id, r.id)).toBe(1)

    S.resetHeat(heat.id)
    expect(S.getHeat(state(), heat.id)).toMatchObject({ status: 'pending', startedAt: null })
    expect(S.lapCount(state(), heat.id, r.id)).toBe(0)
  })
})

describe('undo for destructive actions', () => {
  it('removing a runner can be undone, laps included', () => {
    const { heat, runners: [a, b] } = race(['1', '2'])
    S.recordCrossing(heat.id, a.id, 'tap', sec(60))
    const snap = S.removeRunner(a.id)
    expect(S.getRunner(state(), a.id)).toBeNull()

    // A lap tapped for someone else meanwhile survives the undo.
    S.recordCrossing(heat.id, b.id, 'tap', sec(70))
    S.restoreEvent(snap)
    expect(S.lapCount(state(), heat.id, a.id)).toBe(1)
    expect(S.lapCount(state(), heat.id, b.id)).toBe(1)
  })

  it('deleting a heat, resetting it and re-splitting can all be undone', () => {
    const { ev, heat, runners: [a] } = race(['1'])
    S.recordCrossing(heat.id, a.id, 'tap', sec(60))

    S.restoreEvent(S.deleteHeat(heat.id))
    expect(S.getRunner(state(), a.id).heatId).toBe(heat.id)
    expect(S.lapCount(state(), heat.id, a.id)).toBe(1)

    S.undoReset(S.resetHeat(heat.id))
    expect(S.getHeat(state(), heat.id)).toMatchObject({ status: 'running', startedAt: T0 })
    expect(S.lapCount(state(), heat.id, a.id)).toBe(1)

    S.restoreEvent(S.autoSplitHeats(ev.id, 12).snap)
    expect(S.heatsInEvent(state(), ev.id).map((h) => h.id)).toEqual([heat.id])
  })

  it('deleting the whole event can be undone', () => {
    const { ev, heat, runners: [a] } = race(['1'])
    S.recordCrossing(heat.id, a.id, 'tap', sec(60))
    S.restoreEvent(S.deleteEvent(ev.id))
    expect(S.getEvent(state(), ev.id)).not.toBeNull()
    expect(S.lapCount(state(), heat.id, a.id)).toBe(1)
  })
})

describe('beer-mile rules', () => {
  it('a penalty lap raises the laps a runner needs to finish', () => {
    const { ev, heat, runners: [r] } = race(['7'])
    S.setPenaltyLaps(r.id, 1)
    for (const t of [60, 120, 180, 240]) S.recordCrossing(heat.id, r.id, 'tap', sec(t))
    expect(result(ev, heat, r).finished).toBe(false)

    S.recordCrossing(heat.id, r.id, 'tap', sec(300))
    expect(result(ev, heat, r)).toMatchObject({ finished: true, requiredLaps: 5, elapsed: 300_000 })
  })

  it('clamps penalty laps to 0–9', () => {
    const { runners: [r] } = race(['7'])
    S.setPenaltyLaps(r.id, -3)
    expect(S.getRunner(state(), r.id).penaltyLaps).toBe(0)
    S.setPenaltyLaps(r.id, 40)
    expect(S.getRunner(state(), r.id).penaltyLaps).toBe(9)
  })
})

describe('standings', () => {
  it('ranks finishers by time and keeps DNF, in-progress and not-started apart', () => {
    const { ev, heat, runners: [fast, slow, mid, out, idle] } = race(['1', '2', '3', '4', '5'], 2)
    S.recordCrossing(heat.id, fast.id, 'tap', sec(300))
    S.recordCrossing(heat.id, fast.id, 'tap', sec(600))
    S.recordCrossing(heat.id, slow.id, 'tap', sec(400))
    S.recordCrossing(heat.id, slow.id, 'tap', sec(700))
    S.recordCrossing(heat.id, mid.id, 'tap', sec(350))
    S.setRunnerStatus(out.id, 'dnf')

    const s = S.standings(state(), ev.id)
    expect(s.finishers.map((r) => [r.rank, r.runner.bib])).toEqual([[1, '1'], [2, '2']])
    expect(s.inProgress.map((r) => r.runner.bib)).toEqual(['3'])
    expect(s.didNotFinish.map((r) => r.runner.bib)).toEqual(['4'])
    expect(s.notStarted.map((r) => r.runner.bib)).toEqual([idle.bib])
  })
})

describe('start list', () => {
  it('reports duplicate and missing bibs instead of dropping them silently', () => {
    const ev = S.createEvent({ name: 'Test' })
    S.addRunner(ev.id, { bib: '14', name: 'Already here' })

    const res = S.importRunnerRows(ev.id, [
      { bib: '14', name: 'Clash with existing' },
      { bib: '27', name: 'New' },
      { bib: '27', name: 'Clash within file' },
      { bib: '  ', name: 'No bib' },
    ])

    expect(res.added.map((r) => r.bib)).toEqual(['27'])
    expect(res.duplicates.map((r) => r.name)).toEqual(['Clash with existing', 'Clash within file'])
    expect(res.missingBib.map((r) => r.name)).toEqual(['No bib'])
  })

  it('replacing the list also clears heats and timing built on the old one', () => {
    const { ev, heat, runners: [r] } = race(['7'])
    S.recordCrossing(heat.id, r.id, 'tap', sec(60))

    S.importRunnerRows(ev.id, [{ bib: '99', name: 'Fresh' }], { replace: true })

    expect(S.runnersInEvent(state(), ev.id).map((x) => x.bib)).toEqual(['99'])
    expect(S.heatsInEvent(state(), ev.id)).toHaveLength(0)
    expect(state().crossings).toHaveLength(0)
  })

  it('knows who already has a bib', () => {
    const ev = S.createEvent({ name: 'Test' })
    const a = S.addRunner(ev.id, { bib: '5', name: 'Sindre' })
    expect(S.bibOwner(state(), ev.id, ' 5 ')?.name).toBe('Sindre')
    expect(S.bibOwner(state(), ev.id, '5', a.id)).toBeNull()
    expect(S.bibOwner(state(), ev.id, '')).toBeNull()
  })

  it('sorts bibs numerically, not as text', () => {
    const ev = S.createEvent({ name: 'Test' })
    for (const bib of ['10', '9', '100', '1']) S.addRunner(ev.id, { bib })
    expect(S.runnersInEvent(state(), ev.id).map((r) => r.bib)).toEqual(['1', '9', '10', '100'])
  })

  it('auto-split spreads the field evenly, in bib order', () => {
    const ev = S.createEvent({ name: 'Test' })
    for (let i = 28; i >= 1; i--) S.addRunner(ev.id, { bib: String(i) })

    const heats = S.autoSplitHeats(ev.id, 12)
    const bibsIn = (h) => S.runnersInHeat(state(), h.id).map((r) => Number(r.bib))

    // 10/9/9, not 12/12/4.
    expect(heats.map((h) => bibsIn(h).length)).toEqual([10, 9, 9])
    expect(bibsIn(heats[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(bibsIn(heats[2])).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28])
  })

  it('auto-split never exceeds the heat size and fills exact multiples fully', () => {
    const ev = S.createEvent({ name: 'Test' })
    for (let i = 1; i <= 24; i++) S.addRunner(ev.id, { bib: String(i) })
    const sizes = (n) => S.autoSplitHeats(ev.id, n).map((h) => S.runnersInHeat(state(), h.id).length)

    expect(sizes(12)).toEqual([12, 12])
    expect(sizes(30)).toEqual([24])
    expect(sizes(5)).toEqual([5, 5, 5, 5, 4])
  })
})

describe('persistence', () => {
  it('survives a reload: the store comes back from localStorage', async () => {
    const { heat, runners: [r] } = race(['7'])
    S.recordCrossing(heat.id, r.id, 'tap', sec(60))

    vi.resetModules()
    const reloaded = await import('../src/lib/store.js')
    expect(reloaded.lapCount(reloaded.getState(), heat.id, r.id)).toBe(1)
  })
})

describe('shared races', () => {
  const adopt = () =>
    S.adoptOnlineEvent({
      event: { id: 'ev-1', name: 'Shared', num_laps: 4 },
      runners: [{ id: 'r-1', bib: 7, name: 'Desk name', heat_id: 'h-1' }],
      heats: [{ id: 'h-1', name: 'Heat 1', order: 0, status: 'running', started_at: T0 }],
    }, 'token')

  it('queues what this phone changes until the server acknowledges it', () => {
    adopt()
    S.setRunnerStatus('r-1', 'dnf')
    const pending = S.pendingFor(state(), 'ev-1')
    expect(pending.runners.map((r) => r.id)).toEqual(['r-1'])

    S.ackSent(pending)
    expect(S.pendingCount(state(), 'ev-1')).toBe(0)
  })

  it('keeps a row queued if it changed again while the send was in flight', () => {
    adopt()
    S.setRunnerStatus('r-1', 'dnf')
    const sent = S.pendingFor(state(), 'ev-1')
    S.setRunnerStatus('r-1', 'ok')

    S.ackSent(sent)
    expect(S.pendingCount(state(), 'ev-1')).toBe(1)
  })

  it('the desk owns the start list: server names win over an unsent local edit', () => {
    adopt()
    S.updateRunner('r-1', { name: 'Phone edit', status: 'dq' })
    S.mergeServer('ev-1', {
      runners: [{ id: 'r-1', bib: 7, name: 'Desk name', heat_id: 'h-1', endret_ms: 0 }],
    })

    // Name comes from the desk; the phone's newer status survives, still queued.
    expect(S.getRunner(state(), 'r-1')).toMatchObject({ name: 'Desk name', status: 'dq' })
  })

  it('a tap on a lap another timer just recorded is not offered as a swap', () => {
    adopt()
    S.mergeServer('ev-1', {
      crossings: [{ id: 'c-a', heat_id: 'h-1', runner_id: 'r-1', lap: 1, captured_at: sec(80), enhet: 'phone-a' }],
    })
    // This phone taps the same crossing 3 s later, and again 25 s later.
    const b = S.recordCrossing('h-1', 'r-1', 'tap', sec(83))
    expect(b).toMatchObject({ otherTimer: true, void: true, rejected: 'other-timer', prevId: 'c-a' })
    expect(S.recordCrossing('h-1', 'r-1', 'tap', sec(105)).otherTimer).toBe(true)
    expect(S.lapCount(state(), 'h-1', 'r-1')).toBe(1)
    // A real next lap a minute later counts as normal.
    expect(S.recordCrossing('h-1', 'r-1', 'tap', sec(160)).void).toBe(false)
  })

  it('undo in a shared heat only takes back this phone’s own taps', () => {
    adopt()
    S.mergeServer('ev-1', {
      crossings: [{ id: 'c-other', heat_id: 'h-1', runner_id: 'r-1', lap: 1, captured_at: sec(60), enhet: 'another-phone' }],
    })
    expect(S.undoLastCrossing('h-1')).toBeNull()
    expect(S.lapCount(state(), 'h-1', 'r-1')).toBe(1)
  })
})

describe('dedupeCrossings', () => {
  it('drops a second phone’s tap on the same runner inside the window', () => {
    const cs = [
      { runnerId: 'a', capturedAt: sec(60) },
      { runnerId: 'a', capturedAt: sec(62) },
      { runnerId: 'b', capturedAt: sec(62) },
      { runnerId: 'a', capturedAt: sec(120) },
    ]
    expect(S.dedupeCrossings(cs)).toEqual([cs[0], cs[2], cs[3]])
  })
})

describe('assigning bibs in blocks', () => {
  it('renumbers in one go, keeps the laps, and undoes in one go', () => {
    const { ev, heat, runners: [a, b] } = race(['1', '2'])
    S.recordCrossing(heat.id, a.id, 'tap', sec(60))
    const snap = S.assignBibs(ev.id, [{ key: a.id, to: 2 }, { key: b.id, to: 1 }])

    expect(S.getRunner(state(), a.id).bib).toBe('2')
    expect(S.getRunner(state(), b.id).bib).toBe('1')
    expect(result(ev, heat, a).lapsDone).toBe(1)

    S.restoreEvent(snap)
    expect(S.getRunner(state(), a.id).bib).toBe('1')
    expect(result(ev, heat, a).lapsDone).toBe(1)
  })
})

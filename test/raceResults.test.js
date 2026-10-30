import { describe, expect, it } from 'vitest'
import { fastestLaps, podiums, recordRows, recordSeconds } from '../src/lib/raceResults.js'

const row = (id, category, splits, extra = {}) => ({
  runner: { id, name: id, category },
  laps: splits.map((split, i) => ({ lap: i + 1, split })),
  status: 'ok',
  finished: splits.length >= 4,
  elapsed: splits.reduce((a, b) => a + b, 0),
  ...extra,
})

describe('fastestLaps', () => {
  it('takes each runner’s fastest lap and ranks them, skipping runners with no laps', () => {
    const laps = fastestLaps([
      row('a', 'Menn', [80000, 70000, 90000, 85000]),
      row('b', 'Kvinner', [75000, 72000]),
      row('c', 'Menn', []),
    ])
    expect(laps.map((x) => [x.runner.id, x.lap, x.ms])).toEqual([['a', 2, 70000], ['b', 2, 72000]])
  })
})

describe('podiums', () => {
  it('gives the top three per class, women first', () => {
    const finishers = ['m1', 'k1', 'm2', 'm3', 'm4', 's1'].map((id) =>
      row(id, id[0] === 'k' ? 'Kvinner' : id[0] === 's' ? 'Stafett' : 'Menn', [1, 1, 1, 1]))
    expect(podiums(finishers).map((p) => [p.name, p.rows.map((r) => r.runner.id)]))
      .toEqual([['Kvinner', ['k1']], ['Menn', ['m1', 'm2', 'm3']], ['Stafett', ['s1']]])
  })
})

describe('records', () => {
  it('rounds up to whole seconds and leaves relay teams out', () => {
    expect(recordSeconds(364100)).toBe(365)
    expect(recordSeconds(364000)).toBe(364)
    const rows = recordRows([
      row('k', 'Kvinner', [], { elapsed: 400001 }),
      row('s', 'Stafett', [], { elapsed: 300000 }),
      row('m', 'Menn', [], { elapsed: 360000 }),
    ])
    expect(rows).toEqual([{ runner_id: 'k', sekunder: 401 }, { runner_id: 'm', sekunder: 360 }])
  })
})

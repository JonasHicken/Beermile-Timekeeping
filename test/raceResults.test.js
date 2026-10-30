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
  it('rounds the time up to whole seconds and sends each lap, relay teams included', () => {
    expect(recordSeconds(364100)).toBe(365)
    expect(recordSeconds(364000)).toBe(364)
    const rows = recordRows([
      row('k', 'Kvinner', [], { elapsed: 400001 }),
      row('s', 'Stafett', [100400, 99600], { elapsed: 200000, requiredLaps: 2 }),
      row('m', 'Menn', [90000, 90000, 90000, 90000, 5000], { elapsed: 360000, requiredLaps: 4 }),
      row('x', 'Veteran', [], { elapsed: 360000 }),
    ])
    expect(rows).toEqual([
      { runner_id: 'k', sekunder: 401, runder: [] },
      { runner_id: 's', sekunder: 200, runder: [100, 100] },
      { runner_id: 'm', sekunder: 360, runder: [90, 90, 90, 90] },
    ])
  })
})

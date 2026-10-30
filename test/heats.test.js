import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, groupOf, leastFull, planHeats } from '../src/lib/heats.js'

const runners = (n, category, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `${category}-${from + i}`, category }))

describe('planHeats', () => {
  it('splits a group evenly into as few heats as the limit allows', () => {
    const plan = planHeats(runners(17, 'Menn'), DEFAULT_SETTINGS, 8, 1)
    expect(plan.map((h) => h.runners.length)).toEqual([6, 6, 5])
    expect(plan.map((h) => h.nr)).toEqual([1, 2, 3])
  })

  it('keeps women, men and relay teams apart, in the chosen order', () => {
    const all = [...runners(3, 'Menn'), ...runners(2, 'Kvinner'), ...runners(2, 'Stafett')]
    const plan = planHeats(all, { ...DEFAULT_SETTINGS, order: ['relay', 'men', 'women'] }, 8, 3)
    expect(plan.map((h) => [h.nr, h.group, h.runners.length])).toEqual([[3, 'relay', 2], [4, 'men', 3], [5, 'women', 2]])
  })

  it('runs everyone together when nothing is split', () => {
    const all = [...runners(3, 'Menn'), ...runners(2, 'Kvinner'), ...runners(2, 'Stafett')]
    const plan = planHeats(all, { ...DEFAULT_SETTINGS, byGender: false, relayApart: false }, 8, 1)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ group: 'all' })
    expect(plan[0].runners).toHaveLength(7)
  })
})

describe('groupOf and leastFull', () => {
  it('reads the sign-up categories', () => {
    expect(groupOf('Kvinner', DEFAULT_SETTINGS)).toBe('women')
    expect(groupOf('Menn', DEFAULT_SETTINGS)).toBe('men')
    expect(groupOf('Stafett', DEFAULT_SETTINGS)).toBe('relay')
    expect(groupOf('Menn', { ...DEFAULT_SETTINGS, byGender: false })).toBe('all')
  })

  it('suggests the emptiest heat for the group with room, the later one on a tie', () => {
    const counts = { 1: { n: 5, group: 'men' }, 2: { n: 4, group: 'men' }, 3: { n: 4, group: 'men' }, 4: { n: 2, group: 'women' } }
    expect(leastFull(counts, 'men', 8)).toBe(3)
    expect(leastFull(counts, 'women', 8)).toBe(4)
    expect(leastFull(counts, 'relay', 8)).toBeNull()
    expect(leastFull({ 1: { n: 8, group: 'men' } }, 'men', 8)).toBeNull()
  })
})

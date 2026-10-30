import { describe, expect, it } from 'vitest'
import { parseNumbers, planBibs, classesOf } from '../src/lib/bibs.js'

const entry = (key, bib, category) => ({ key, bib: String(bib), category })
const NL = String.fromCharCode(10)
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

describe('parseNumbers', () => {
  it('reads single numbers and ranges, sorted and without repeats', () => {
    expect(parseNumbers('5, 1-3; 3–4').numbers).toEqual([1, 2, 3, 4, 5])
    expect(parseNumbers('').numbers).toEqual([])
  })

  it('reads a list pasted as it is: line breaks, spaces, trailing commas, overlaps', () => {
    const pasted = '306-310' + NL + '322-329' + NL + '304, 311, 313, 315' + NL + '322-323, 331-332, ' + NL + '337-339, 341'
    const { numbers, error } = parseNumbers(pasted)
    expect(error).toBeNull()
    expect(numbers).toEqual([304, 306, 307, 308, 309, 310, 311, 313, 315, 322, 323, 324, 325, 326, 327, 328, 329, 331, 332, 337, 338, 339, 341])
    expect(parseNumbers('1 - 3 7  9').numbers).toEqual([1, 2, 3, 7, 9])
  })

  it('names the part it cannot read', () => {
    expect(parseNumbers('1-10, abc').error).toMatch('abc')
    expect(parseNumbers('10-1').error).toMatch('10-1')
    expect(parseNumbers('0-5').error).toBeTruthy()
  })
})

describe('planBibs', () => {
  const list = [
    entry('m1', 4, 'Men'), entry('w1', 1, 'Women'), entry('m2', 2, 'Men'),
    entry('w2', 3, 'Women'), entry('r1', 5, 'Relay'),
  ]

  it('gives each class a block of numbers that follow each other, in the chosen order', () => {
    const p = planBibs(list, { available: range(1, 50), order: ['Men', 'Women', 'Relay'] })
    expect(p.groups.map((g) => [g.category, g.first, g.last])).toEqual([['Men', 1, 2], ['Women', 3, 4], ['Relay', 5, 5]])
    expect(p.missing).toBe(0)
  })

  it('keeps the current order within a class', () => {
    const p = planBibs(list, { available: range(1, 50), order: ['Men'] })
    expect(p.groups[0].items.map((x) => x.key)).toEqual(['m2', 'm1'])
  })

  it('starts each later class on the next ten when asked', () => {
    const p = planBibs(list, { available: range(1, 50), order: ['Men', 'Women', 'Relay'], tens: true })
    expect(p.groups.map((g) => g.first)).toEqual([1, 10, 20])
  })

  it('starts a class where it is told to, and never hands out a number twice', () => {
    const p = planBibs(list, { available: range(1, 50), order: ['Men', 'Women'], starts: { Women: 2 } })
    const all = p.groups.flatMap((g) => g.items.map((x) => x.to))
    expect(new Set(all).size).toBe(all.length)
    expect(p.groups[1].first).toBe(3) // 2 was taken by the men
  })

  it('uses only the available numbers, and says when a block has a gap', () => {
    const p = planBibs(list, { available: [1, 2, 7, 8, 9], order: ['Men', 'Women', 'Relay'] })
    expect(p.groups[1]).toMatchObject({ first: 7, last: 8, gaps: false })
    expect(planBibs(list, { available: [1, 3, 5, 7, 9], order: ['Men'] }).groups[0].gaps).toBe(true)
  })

  it('counts who is left without a number when there are too few', () => {
    const p = planBibs(list, { available: [1, 2, 3], order: [] })
    expect(p.missing).toBe(2)
  })

  it('lists only the bibs that actually change', () => {
    const p = planBibs([entry('a', 1, 'X'), entry('b', 2, 'X')], { available: range(1, 9) })
    expect(p.changes).toEqual([])
  })
})

describe('classesOf', () => {
  it('orders classes by their lowest bib', () => {
    expect(classesOf([entry('a', 9, 'B'), entry('b', 2, 'A'), entry('c', 1, 'C')])).toEqual(['C', 'A', 'B'])
  })
})

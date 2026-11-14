import { describe, it, expect } from 'vitest'
import { classOf, relayOf, toSignups } from '../src/lib/raceImport.js'

describe('classOf', () => {
  it('reads Norwegian and English class words', () => {
    expect(classOf('Kvinner')).toBe('kvinne')
    expect(classOf('K')).toBe('kvinne')
    expect(classOf('Women')).toBe('kvinne')
    expect(classOf('Menn')).toBe('mann')
    expect(classOf('herrer')).toBe('mann')
    expect(classOf('Stafett')).toBe('stafett')
    expect(classOf('Relay')).toBe('stafett')
    expect(classOf('')).toBe(null)
    expect(classOf('Veteran')).toBe(null)
  })
})

describe('relayOf', () => {
  it('reads "Team (A og B)"', () => {
    expect(relayOf('Lag 1 (Per og Pål)')).toEqual({ lagnavn: 'Lag 1', navn: 'Per', partner_navn: 'Pål' })
  })
  it('reads "A & B" with the team from its own column, else the two names', () => {
    expect(relayOf('Per & Pål', 'Raskt')).toEqual({ lagnavn: 'Raskt', navn: 'Per', partner_navn: 'Pål' })
    expect(relayOf('Per og Pål', '')).toEqual({ lagnavn: 'Per og Pål', navn: 'Per', partner_navn: 'Pål' })
  })
  it('needs two runners', () => {
    expect(relayOf('Per')).toBe(null)
  })
})

describe('toSignups', () => {
  const existing = [{ bib: '1', name: 'Ann Ås' }, { bib: '2', name: 'Lag (Bo Bø og Cy Ce)' }]
  it('builds sign-ups and skips what cannot be added', () => {
    const rows = [
      { bib: '5', name: 'Kari', category: 'Kvinner' },
      { bib: '', name: 'Ola', category: 'Menn' },
      { bib: '1', name: 'Eva', category: 'K' },
      { bib: '9', name: 'ann ås', category: 'K' },
      { bib: '10', name: 'Cy Ce og Di', category: 'Stafett' },
      { bib: '11', name: 'Tom', category: '' },
      { bib: '12', name: '', category: 'M' },
      { bib: '13', name: 'Solo', category: 'Stafett' },
    ]
    const { ok, skipped } = toSignups(rows, null, existing)
    expect(ok.map((x) => [x.label, x.signup.startnummer, x.bibTaken])).toEqual([
      ['Kari', 5, false], ['Ola', null, false], ['Eva', null, true],
    ])
    expect(ok[0].signup).toMatchObject({ klasse: 'individuell', kjonn: 'kvinne', navn: 'Kari' })
    expect(skipped.map((s) => s.why)).toEqual([
      'already in the race', 'already in the race', 'no class', 'no name', 'relay team needs two runners (“Ann og Bo”)',
    ])
  })
  it('uses the fallback class and catches the same name twice in one file', () => {
    const { ok, skipped } = toSignups([{ name: 'Tom' }, { name: 'tom' }, { name: 'Lise', bib: '3' }, { name: 'Mia', bib: '3' }], 'mann')
    expect(ok.map((x) => [x.signup.navn, x.signup.kjonn, x.signup.startnummer])).toEqual([['Tom', 'mann', null], ['Lise', 'mann', 3], ['Mia', 'mann', null]])
    expect(skipped).toHaveLength(1)
  })
})

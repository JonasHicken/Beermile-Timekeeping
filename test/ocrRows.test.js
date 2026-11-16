import { describe, it, expect } from 'vitest'
import { ocrToRows } from '../src/lib/ocrRows.js'

const lines = (s) => s.split('\n').slice(1)

describe('reading a photographed list', () => {
  it('splits bib, name and class from each line', () => {
    const out = ocrToRows('14 Ola Nordmann Menn\n27 Kari Berg Kvinner\n33 Per Hansen')
    expect(out.split('\n')[0]).toBe('Navn; Klasse; Startnr')
    expect(lines(out)).toEqual(['Ola Nordmann; Menn; 14', 'Kari Berg; Kvinner; 27', 'Per Hansen; ; 33'])
  })

  it('drops places, times, table lines and a header', () => {
    const out = ocrToRows('Navn Klasse Startnr\n|-----|------|\n1. 14 Ola Nordmann 6:12.4\n2) 27 Kari Berg 6:40')
    expect(lines(out)).toEqual(['Ola Nordmann; ; 14', 'Kari Berg; ; 27'])
  })

  it('skips a header line in any order of columns', () => {
    expect(lines(ocrToRows('Startnr Navn Klasse\n14 Ola Nordmann Menn'))).toEqual(['Ola Nordmann; Menn; 14'])
    expect(lines(ocrToRows('Pl. Nr Navn Klubb Tid\n1. 14 Ola Nordmann 6:12'))).toEqual(['Ola Nordmann; ; 14'])
  })

  it('reads a bib written after the name, and names with æøå', () => {
    expect(lines(ocrToRows('Bjørn Ødegård 12'))).toEqual(['Bjørn Ødegård; ; 12'])
  })

  it('keeps a relay team with both runners', () => {
    expect(lines(ocrToRows('Lag 1 (Per og Pål) Stafett'))).toEqual(['Lag 1 (Per og Pål); Stafett; '])
  })

  it('gives nothing for a photo without names', () => {
    expect(ocrToRows('12\n—\n3:45')).toBe('')
  })
})

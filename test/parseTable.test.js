import { describe, expect, it } from 'vitest'
import {
  detectDelimiter, parseDelimited, guessMapping, toRunnerRows, looksLikeHeader,
} from '../src/lib/parseTable.js'

const parse = (text) => parseDelimited(text, detectDelimiter(text))

describe('detectDelimiter', () => {
  it('spots semicolons, which Norwegian Excel uses for CSV', () => {
    expect(detectDelimiter('Startnr;Navn;Klubb\n14;Ola Nordmann;OSI\n27;Kari Berg;BUL')).toBe(';')
  })

  it('spots commas, tabs and pipes', () => {
    expect(detectDelimiter('bib,name\n1,A\n2,B')).toBe(',')
    expect(detectDelimiter('bib\tname\n1\tA\n2\tB')).toBe('\t')
    expect(detectDelimiter('bib|name\n1|A\n2|B')).toBe('|')
  })

  it('is not fooled by commas inside a semicolon file', () => {
    expect(detectDelimiter('Nr;Navn\n14;"Nordmann, Ola"\n27;"Berg, Kari"')).toBe(';')
  })
})

describe('parseDelimited', () => {
  it('keeps a quoted field with the delimiter in it as one cell', () => {
    expect(parse('bib,name\n14,"Nordmann, Ola"')).toEqual([['bib', 'name'], ['14', 'Nordmann, Ola']])
  })

  it('unescapes doubled quotes', () => {
    expect(parse('bib,name\n1,"Ola ""Speedy"" N"')[1]).toEqual(['1', 'Ola "Speedy" N'])
  })

  it('strips a byte-order mark so the first header still matches', () => {
    expect(parse('﻿bib,name\n1,A')[0][0]).toBe('bib')
  })

  it('handles Windows line endings and skips blank lines', () => {
    expect(parse('bib,name\r\n1,A\r\n\r\n2,B\r\n')).toEqual([['bib', 'name'], ['1', 'A'], ['2', 'B']])
  })
})

describe('guessMapping', () => {
  it('maps Norwegian headers', () => {
    const rows = parse('Startnr;Navn;Klubb;Klasse;E-post\n14;Ola;OSI;M;ola@example.com')
    expect(guessMapping(rows)).toEqual({
      hasHeader: true,
      mapping: { bib: 0, name: 1, club: 2, category: 3, email: 4 },
    })
  })

  it('maps the short forms an organiser actually types', () => {
    for (const header of ['Nr', 'Startnummer', 'Bib']) {
      expect(guessMapping([[header, 'Navn'], ['14', 'Ola']]).mapping.bib).toBe(0)
    }
  })

  it('maps English headers in any order and any case', () => {
    const rows = parse('Name,Club,BIB\nOla,OSI,14')
    expect(guessMapping(rows).mapping).toMatchObject({ bib: 2, name: 0, club: 1 })
  })

  it('without a header row, takes the all-numeric column as the bib', () => {
    const rows = parse('Ola Nordmann,14\nKari Berg,27')
    expect(guessMapping(rows)).toMatchObject({ hasHeader: false, mapping: { bib: 1, name: 0 } })
  })
})

describe('looksLikeHeader', () => {
  it('recognises a header row and rejects a data row', () => {
    expect(looksLikeHeader(['Startnr', 'Navn'])).toBe(true)
    expect(looksLikeHeader(['14', 'Ola Nordmann'])).toBe(false)
  })
})

describe('toRunnerRows', () => {
  it('turns mapped rows into runners and drops fully empty lines', () => {
    const rows = [['Nr', 'Navn'], [' 14 ', ' Ola '], ['', ''], ['27', 'Kari']]
    expect(toRunnerRows(rows, { bib: 0, name: 1, club: -1, category: -1, email: -1 }, true)).toEqual([
      { bib: '14', name: 'Ola', club: '', category: '', email: '' },
      { bib: '27', name: 'Kari', club: '', category: '', email: '' },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { fmt, fmtShort } from '../src/lib/time.js'

describe('fmt', () => {
  it('formats race time as m:ss.d, truncating rather than rounding', () => {
    expect(fmt(0)).toBe('0:00.0')
    expect(fmt(65_490)).toBe('1:05.4')
    expect(fmt(599_999)).toBe('9:59.9')
  })

  it('shows exactly the tenths a time was entered with', () => {
    // 194.7 - 180 is 14.6999… in floating point.
    expect(fmt(194_700)).toBe('3:14.7')
    for (let t = 0; t < 6000; t++) expect(fmt(t * 100).endsWith(`.${t % 10}`)).toBe(true)
  })

  it('shows a dash for a missing time', () => {
    expect(fmt(null)).toBe('—')
    expect(fmt(NaN)).toBe('—')
  })
})

describe('fmtShort', () => {
  it('rounds to whole seconds', () => {
    expect(fmtShort(65_490)).toBe('1:05')
    expect(fmtShort(65_500)).toBe('1:06')
  })
})

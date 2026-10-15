import { describe, expect, it } from 'vitest'
import { fmt, fmtShort, parseElapsed } from '../src/lib/time.js'

describe('fmt', () => {
  it('formats race time as m:ss.d, truncating rather than rounding', () => {
    expect(fmt(0)).toBe('0:00.0')
    expect(fmt(65_490)).toBe('1:05.4')
    expect(fmt(599_999)).toBe('9:59.9')
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

describe('parseElapsed', () => {
  it('reads the formats an operator types when correcting a time', () => {
    expect(parseElapsed('1:05.4')).toBe(65_400)
    expect(parseElapsed('1:05,4')).toBe(65_400)
    expect(parseElapsed('6:30')).toBe(390_000)
    expect(parseElapsed('45')).toBe(45_000)
  })

  it('round-trips with fmt', () => {
    expect(parseElapsed(fmt(372_800))).toBe(372_800)
  })

  it('rejects nonsense instead of producing NaN', () => {
    for (const bad of ['', 'abc', '1:75', '1:2:3']) expect(parseElapsed(bad)).toBeNull()
  })
})

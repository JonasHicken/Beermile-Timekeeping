import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('clock sync', () => {
  let time
  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    time = await import('../src/lib/time.js')
  })
  afterEach(() => vi.useRealTimers())

  // The server is 5 s ahead; a reading with round trip `rtt` that the
  // network delayed asymmetrically is off by up to rtt/2.
  const reading = (rtt, skew = rtt / 2) => {
    const sent = Date.now()
    time.noteServerTime(sent + 5000 + skew, sent, sent + rtt)
  }

  it('sets the offset from the quickest round trip', () => {
    reading(60, 30)
    expect(time.clockInfo().offset).toBe(5000)
    reading(2000, 1900) // slow and lopsided: ignored
    expect(time.clockInfo().offset).toBe(5000)
  })

  it('never lets a slow reading replace a good one, however old the good one is', () => {
    reading(60, 30)
    vi.advanceTimersByTime(11 * 60 * 1000)
    reading(3000, 2900) // a congested 3 s round trip after the old ten-minute expiry
    expect(time.clockInfo().offset).toBe(5000)
  })

  it('lets an old reading be replaced by one that is nearly as good', () => {
    reading(60, 30)
    vi.advanceTimersByTime(10 * 60 * 1000)
    reading(110, 40) // 110 ms: accepted once the 60 ms reading is ten minutes old
    expect(time.clockInfo().rtt).toBe(110)
  })
})

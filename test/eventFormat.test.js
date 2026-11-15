import { describe, it, expect } from 'vitest'
import {
  lapPoints, presetFormat, formatOf, splitLabel, describe as describeFormat, parsePoints, normalise, progressLabel,
} from '../src/lib/eventFormat.js'
import { requiredLaps } from '../src/lib/store.js'

describe('lapPoints', () => {
  it('times each pass of the line, the first after the part lap', () => {
    expect(lapPoints(400)).toEqual([400])
    expect(lapPoints(800)).toEqual([400, 800])
    expect(lapPoints(1500)).toEqual([300, 700, 1100, 1500])
    expect(lapPoints(3000)).toEqual([200, 600, 1000, 1400, 1800, 2200, 2600, 3000])
    expect(lapPoints(5000)).toHaveLength(13)
    expect(lapPoints(5000)[0]).toBe(200)
    expect(lapPoints(10000, 1000)).toHaveLength(10)
  })
  it('a race shorter than a lap is finish only', () => {
    expect(lapPoints(200, 400)).toEqual([200])
  })
})

describe('presets', () => {
  it('fill in the points for the distance', () => {
    expect(presetFormat('1500').points).toEqual([300, 700, 1100, 1500])
    expect(presetFormat('beermile')).toMatchObject({ points: [400, 800, 1200, 1600], penalties: true })
    expect(presetFormat('5000').penalties).toBe(false)
  })
  it('an older race without a format is a beer mile of its laps', () => {
    expect(formatOf({ numLaps: 5 }).points).toEqual([400, 800, 1200, 1600, 2000])
    expect(formatOf({ numLaps: 5 }).penalties).toBe(true)
  })
})

describe('required taps', () => {
  it('one per timing point, plus penalty laps only in a beer mile', () => {
    const track = { format: presetFormat('1500') }
    const beer = { format: presetFormat('beermile') }
    expect(requiredLaps(track, { penaltyLaps: 2 })).toBe(4)
    expect(requiredLaps(beer, { penaltyLaps: 2 })).toBe(6)
    expect(requiredLaps({ numLaps: 4 }, { penaltyLaps: 1 })).toBe(5)
  })
})

describe('labels', () => {
  it('name a split by its distance, or its lap in a beer mile', () => {
    expect(splitLabel(presetFormat('1500'), 1)).toBe('700 m')
    expect(splitLabel(presetFormat('beermile'), 1)).toBe('Lap 2')
    expect(splitLabel(presetFormat('beermile'), 4)).toBe('Penalty lap 1')
    expect(describeFormat(presetFormat('1500'))).toBe('1500 m · 4 splits')
    expect(describeFormat(normalise({ ...presetFormat('5000'), mode: 'finish' }))).toBe('5000 m · finish only')
    expect(progressLabel(presetFormat('1500'), { lapsDone: 2, requiredLaps: 4 })).toBe('700 m / 1500')
  })
})

describe('own points', () => {
  it('reads a list of distances and checks it', () => {
    expect(parsePoints('1500, 3000 5000m')).toEqual({ points: [1500, 3000, 5000] })
    expect(parsePoints('1500, 1000').error).toMatch(/further/)
    expect(parsePoints('').error).toBeTruthy()
    expect(normalise({ kind: 'custom', mode: 'points', points: [1500, 3000, 5000], distance: 1 }).distance).toBe(5000)
  })
})

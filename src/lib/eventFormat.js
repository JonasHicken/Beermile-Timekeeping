import { t, plural as tPlural, ordinal as tOrdinal } from './i18n.js'
// What kind of race is timed, and where on the course a runner is timed.
//
// A race is a list of timing points: the distance (in metres from the start)
// at each place a runner is tapped, the last one being the finish. A runner's
// nth tap is their nth point, so a 1500 m on a 400 m track is timed at 300,
// 700, 1100 and 1500 m: four taps, the first after 300 m. A beer mile is four
// 400 m laps, with penalty laps on top for anyone who has to run one.
//
//   format = {
//     kind:      '400' | '800' | '1500' | '3000' | '5000' | 'beermile' | 'custom',
//     distance:  metres, the finish
//     lapLength: metres per lap of the course (400 on a track)
//     mode:      'laps' (a tap each time past the line) | 'finish' (the finish only)
//                | 'points' (the points as written)
//     points:    [metres], increasing, ending at `distance`
//     penalties: true for a beer mile: penalty laps can be added per runner
//   }
//
// Older races have no format: they are beer miles with `numLaps` laps.

export const KINDS = [
  { id: '400', label: '400 m', distance: 400 },
  { id: '800', label: '800 m', distance: 800 },
  { id: '1500', label: '1500 m', distance: 1500 },
  { id: '3000', label: '3000 m', distance: 3000 },
  { id: '5000', label: '5000 m', distance: 5000 },
  { id: 'beermile', label: 'Beermile', distance: 1600 },
  { id: 'custom', label: 'Custom', distance: 5000 },
]

export const MAX_POINTS = 40

// A tap each time past the line, the first after whatever is left over from
// whole laps (1500 m on 400 m laps: 300, 700, 1100, 1500).
export function lapPoints(distance, lapLength = 400) {
  const d = Math.round(Number(distance))
  const lap = Math.round(Number(lapLength))
  if (!(d > 0)) return []
  if (!(lap > 0) || lap >= d) return [d]
  const first = d % lap || lap
  const out = []
  for (let m = first; m <= d && out.length < MAX_POINTS; m += lap) out.push(m)
  return out
}

export function pointsFor(format) {
  if (format.mode === 'finish') return [format.distance]
  if (format.mode === 'points') return format.points ?? []
  return lapPoints(format.distance, format.lapLength)
}

export function presetFormat(kind) {
  const k = KINDS.find((x) => x.id === kind) ?? KINDS.find((x) => x.id === 'custom')
  const base = { kind: k.id, distance: k.distance, lapLength: 400, mode: 'laps', penalties: k.id === 'beermile' }
  return { ...base, points: pointsFor(base) }
}

// The race's format, from the stored one or (older races) its lap count.
export function formatOf(event) {
  if (event?.format?.points?.length) return event.format
  const laps = Number(event?.numLaps) || 4
  return { kind: 'beermile', distance: laps * 400, lapLength: 400, mode: 'laps', penalties: true, points: lapPoints(laps * 400, 400) }
}

export const isBeermile = (format) => format.kind === 'beermile'

// The label for the ith tap (from 0): "Lap 2" in a beer mile, "700 m"
// otherwise; past the race's points, a penalty lap.
export function splitLabel(format, i) {
  const n = format.points.length
  if (i >= n) return `${t('Penalty lap')} ${i - n + 1}`
  if (isBeermile(format)) return `${t('Lap')} ${i + 1}`
  return `${format.points[i]} m`
}

const plural = tPlural

// One line for a list or a heading: "Beermile · 4 laps", "1500 m · 4 splits".
export function describe(format) {
  const n = format.points.length
  const name = KINDS.find((k) => k.id === format.kind && k.id !== 'custom')?.label ?? `${format.distance} m`
  if (isBeermile(format)) return `Beermile · ${plural(n, 'lap')}`
  if (n === 1) return `${name} · ${t('finish only')}`
  return `${name} · ${plural(n, 'split')}`
}

// "300, 700, 1100, 1500" -> [300, 700, 1100, 1500], or an error to show.
export function parsePoints(text) {
  const parts = String(text).split(/[\s,;]+/).filter(Boolean)
  const points = parts.map((p) => Number(p.replace(/m$/i, '')))
  if (!points.length) return { error: t('Write at least the finish distance.') }
  if (points.some((p) => !Number.isInteger(p) || p < 1 || p > 100000)) return { error: t('Distances are whole metres, like 300, 700, 1500.') }
  if (points.some((p, i) => i > 0 && p <= points[i - 1])) return { error: t('Each point must be further than the one before.') }
  if (points.length > MAX_POINTS) return { error: t('At most {n} timing points.', { n: MAX_POINTS }) }
  return { points }
}

// A format made whole after an edit: points worked out again from the mode,
// and the distance following the last point when they are written by hand.
export function normalise(format) {
  const f = { ...format }
  f.distance = Math.max(1, Math.round(Number(f.distance) || 0))
  f.lapLength = Math.max(1, Math.round(Number(f.lapLength) || 400))
  if (f.mode === 'points') {
    f.points = (f.points ?? []).slice(0, MAX_POINTS)
    if (f.points.length) f.distance = f.points[f.points.length - 1]
  } else {
    f.points = pointsFor(f)
  }
  f.penalties = isBeermile(f)
  return f
}

export const sameFormat = (a, b) => JSON.stringify(normalise(a)) === JSON.stringify(normalise(b))

const ordinal = tOrdinal

// What a change in the number of timing points does to results already timed.
export function formatChangeWarning(was, now, finished) {
  const vars = { taps: plural(was, 'tap'), nth: ordinal(now), n: plural(finished, 'runner') }
  return t('Laps are already recorded. Every result is worked out from the timing points, so') + ' ' +
    (now > was
      ? t(finished
        ? 'runners who finished after {taps} count as still on course until a {nth} is recorded ({n} finished right now).'
        : 'runners who finished after {taps} count as still on course until a {nth} is recorded.', vars)
      : t('runners finish at their {nth} tap, and later taps no longer count.', vars)) +
    ' ' + t('You can undo it straight after.')
}

// Where a runner on course is: "lap 2/4" in a beer mile, "700 m / 1500" else.
export function progressLabel(format, row) {
  if (isBeermile(format) || !row.lapsDone) return `${t('lap')} ${row.lapsDone}/${row.requiredLaps}`
  const at = format.points[Math.min(row.lapsDone, format.points.length) - 1]
  return `${at} m / ${format.distance}`
}

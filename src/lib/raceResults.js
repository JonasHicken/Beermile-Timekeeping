// What a finished race gives back: each runner's fastest lap, the top three per
// class, and the times to send to a records list. Built on store.standings(),
// so laps already leave out voided taps and a second phone's tap on the same
// crossing.

// The classes in the order they are shown; anything else comes after.
export const CLASS_ORDER = ['Kvinner', 'Menn', 'Stafett']

export function classesIn(rows) {
  const names = [...new Set(rows.map((r) => r.runner.category || ''))]
  const at = (c) => { const i = CLASS_ORDER.indexOf(c); return i < 0 ? 99 : i }
  return names.sort((a, b) => at(a) - at(b) || a.localeCompare(b))
}

// Every runner who ran at least one lap, with their fastest one, fastest first.
// rows: the standings rows (finishers, in progress and out alike).
// Returns [{ runner, lap, ms, status, finished }].
export function fastestLaps(rows) {
  const best = []
  for (const r of rows) {
    if (!r.laps?.length) continue
    const lap = r.laps.reduce((a, b) => (b.split < a.split ? b : a))
    best.push({ runner: r.runner, lap: lap.lap, ms: lap.split, status: r.status, finished: r.finished })
  }
  return best.sort((a, b) => a.ms - b.ms)
}

// The top three per class, from the ranked finishers: [{ name, rows }].
export function podiums(finishers) {
  return classesIn(finishers)
    .map((c) => ({ name: c, rows: finishers.filter((r) => (r.runner.category || '') === c).slice(0, 3) }))
    .filter((p) => p.rows.length)
}

// Whole seconds for a records list, rounded up as hand timing is: 6:04.1
// counts as 6:05, never as faster than it was.
export const recordSeconds = (ms) => Math.ceil(ms / 1000)

// The finishers a records list takes: women, men and relay teams, each with
// their laps in whole seconds (nearest second; the race's own laps plus any
// penalty laps, no stray taps after the finish).
export const RECORD_CLASSES = ['Kvinner', 'Menn', 'Stafett']

export function recordRows(finishers) {
  return finishers
    .filter((r) => RECORD_CLASSES.includes(r.runner.category))
    .map((r) => ({
      runner_id: r.runner.id,
      sekunder: recordSeconds(r.elapsed),
      runder: (r.laps ?? []).slice(0, r.requiredLaps ?? r.laps?.length).map((l) => Math.round(l.split / 1000)),
    }))
}

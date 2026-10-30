// Making heats for a shared race from the admin link (pages/RaceAdmin.jsx).
//
// Runners are grouped (women, men, relay teams, or everyone together for
// whatever is not split) and each group is split evenly into as few heats of
// at most `per` as possible: 17 at 8 per heat is 6 + 6 + 5, not 8 + 8 + 1.
// A relay team is one runner in the start list (its runners are on the track
// one at a time), so it takes one place.
//
// Categories come from the race's sign-ups: "Kvinner", "Menn", "Stafett".

export const GROUPS = ['women', 'men', 'relay', 'all']
export const DEFAULT_SETTINGS = { perHeat: 8, byGender: true, relayApart: true, order: GROUPS }

export function groupOf(category, { byGender, relayApart }) {
  const c = (category || '').toLowerCase()
  if (c.startsWith('stafett') || c.startsWith('relay')) return relayApart ? 'relay' : 'all'
  if (!byGender) return 'all'
  if (c.startsWith('kvinn') || c.startsWith('women')) return 'women'
  if (c.startsWith('menn') || c.startsWith('men')) return 'men'
  return 'all'
}

// [{ nr, group, runners }]: each group in the chosen order, numbered from
// `first`, runners in the order given (bib order).
export function planHeats(runners, settings, per, first) {
  const order = [...settings.order.filter((g) => GROUPS.includes(g)), ...GROUPS.filter((g) => !settings.order.includes(g))]
  const plan = []
  for (const g of order) {
    const inGroup = runners.filter((r) => groupOf(r.category, settings) === g)
    if (!inGroup.length) continue
    const k = Math.ceil(inGroup.length / per)
    for (let h = 0; h < k; h++) {
      plan.push({ nr: first + plan.length, group: g, runners: inGroup.filter((_, j) => Math.floor((j * k) / inGroup.length) === h) })
    }
  }
  return plan
}

// Where a late arrival goes: of the heats that have not started, are for their
// group (or mixed/empty) and have room, the one with the fewest runners, and
// on a tie the later one, which gives them the most time to get ready. Null
// when none has room. counts: heat number -> { n, group }.
export function leastFull(counts, group, per) {
  const best = Object.entries(counts).map(([nr, x]) => [Number(nr), x])
    .filter(([, x]) => x.n < per && (x.group === group || x.group === null))
    .sort((a, b) => a[1].n - b[1].n || b[0] - a[0])[0]
  return best ? best[0] : null
}

// Runners shared between timers in blocks of bibs that follow each other, as
// even as possible (7 between 3 is 3 + 2 + 2): a timer watching 304-306 finds
// their runners faster than one with every third bib. `runners` in bib order.
// Returns [{ runner, timer }].
export function splitBetween(runners, timers) {
  if (!timers.length) return []
  const per = Math.floor(runners.length / timers.length)
  const extra = runners.length % timers.length
  const out = []
  let i = 0
  timers.forEach((t, k) => {
    const take = per + (k < extra ? 1 : 0)
    for (const r of runners.slice(i, i + take)) out.push({ runner: r, timer: t })
    i += take
  })
  return out
}

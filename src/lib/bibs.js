// Handing out bib numbers in blocks: every runner in a class (a category such
// as "Women", "Men" or "Relay") gets numbers that follow each other, so a bib
// tells a marshal the class at a glance. The organiser says which numbers are
// available (the bibs they actually have printed), the order of the classes,
// and optionally where each class starts. Used for events on this phone and,
// through the admin link, for shared races (pages/RaceAdmin.jsx).

const MAX = 9999

// "1-50, 60, 100-120" -> { numbers: [1..50, 60, 100..120], error }. Commas,
// semicolons, line breaks and spaces all separate, so a list pasted from a
// spreadsheet or a note works as it is; "1 - 5" is still a range. En dashes
// are accepted, overlaps are fine, and the result is sorted and unique.
export function parseNumbers(text) {
  const numbers = new Set()
  const normalised = String(text ?? '').replace(/\s*[-–]\s*/g, '-')
  for (const raw of normalised.split(/[,;\s]+/)) {
    const part = raw.trim()
    if (!part) continue
    const m = part.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/)
    if (!m) return { numbers: [], error: `"${part}" is not a number or a range like 1-50` }
    const a = Number(m[1])
    const b = m[2] == null ? a : Number(m[2])
    if (a < 1 || b > MAX || b < a) return { numbers: [], error: `"${part}" must be between 1 and ${MAX}, low to high` }
    for (let n = a; n <= b; n++) numbers.add(n)
  }
  return { numbers: [...numbers].sort((x, y) => x - y), error: null }
}

const bibValue = (b) => {
  const n = parseInt(String(b ?? '').replace(/\D/g, ''), 10)
  return Number.isNaN(n) ? Infinity : n
}

// The classes in the start list, in the order of their lowest current bib.
export function classesOf(entries) {
  const first = new Map()
  for (const e of entries) {
    const c = e.category ?? ''
    if (!first.has(c) || bibValue(e.bib) < first.get(c)) first.set(c, bibValue(e.bib))
  }
  return [...first.keys()].sort((a, b) => first.get(a) - first.get(b))
}

// entries: [{ key, bib, category }]. Options:
//   available  sorted numbers that may be used (parseNumbers)
//   order      the classes in the order they get numbers; any missing go last
//   starts     { class: number } where a class starts; others carry on
//   tens       start each class after the first on the next ten (1-17, then 20)
// Within a class runners keep their current order. Returns
//   { groups: [{ category, items: [{ key, from, to }], first, last, gaps }],
//     changes: [{ key, from, to }] (only those whose bib changes),
//     missing: how many runners got no number }
export function planBibs(entries, { available, order = [], starts = {}, tens = false }) {
  const classes = [...order.filter((c) => entries.some((e) => (e.category ?? '') === c)),
    ...classesOf(entries).filter((c) => !order.includes(c))]
  const used = new Set()
  const groups = []
  let missing = 0
  let last = null
  for (const category of classes) {
    const members = entries
      .filter((e) => (e.category ?? '') === category)
      .sort((a, b) => bibValue(a.bib) - bibValue(b.bib))
    const explicit = Number(starts[category])
    const from = explicit > 0 ? explicit : tens && last != null ? Math.floor(last / 10) * 10 + 10 : 1
    const free = available.filter((n) => n >= from && !used.has(n)).slice(0, members.length)
    free.forEach((n) => used.add(n))
    const items = members.map((e, i) => ({ key: e.key, from: String(e.bib ?? ''), to: free[i] ?? null }))
    missing += members.length - free.length
    if (free.length) last = free[free.length - 1]
    groups.push({
      category, items,
      first: free[0] ?? null, last: free[free.length - 1] ?? null,
      gaps: free.length > 1 && free[free.length - 1] - free[0] + 1 > free.length,
    })
  }
  const changes = groups.flatMap((g) => g.items).filter((x) => x.to != null && String(x.to) !== x.from)
  return { groups, changes, missing }
}

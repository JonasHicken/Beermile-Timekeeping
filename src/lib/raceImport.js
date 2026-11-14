// Turning imported start-list rows (parseTable.toRunnerRows) into sign-ups for
// a shared race: each needs a class (women, men or a relay team), and a relay
// team needs a team name and two runners. Pure, so Race admin can show
// exactly what will be added and what will be skipped before anything is sent.

const WOMEN = /^(k|kv|kvinne|kvinner|dame|damer|jente|jenter|w|women|woman|female|f|girls?|ladies)$/
const MEN = /^(m|mann|menn|herre|herrer|gutt|gutter|men|man|male|boys?)$/
const RELAY = /(stafett|relay|lag|team)/

const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')

// 'kvinne' | 'mann' | 'stafett' | null (not given or not understood).
export function classOf(category) {
  const c = clean(category).toLowerCase().replace(/[^a-zæøå ]/g, '').trim()
  if (!c) return null
  if (RELAY.test(c)) return 'stafett'
  const word = c.split(' ')[0]
  if (WOMEN.test(word) || WOMEN.test(c)) return 'kvinne'
  if (MEN.test(word) || MEN.test(c)) return 'mann'
  return null
}

// "Team (Ann og Bo)", or "Ann og Bo" / "Ann & Bo" / "Ann / Bo" with the team
// name from the club column (else the two names).
export function relayOf(name, club) {
  const n = clean(name)
  let m = n.match(/^(.+?) \((.+?)\s+(?:og|and|&|\/|\+)\s+(.+)\)$/i)
  if (m) return { lagnavn: m[1], navn: m[2], partner_navn: m[3] }
  m = n.match(/^(.+?)\s+(?:og|and|&|\/|\+)\s+(.+)$/i) || n.match(/^(.+?)\s*[,/&+]\s*(.+)$/)
  if (m) return { lagnavn: clean(club) || `${m[1]} og ${m[2]}`, navn: m[1], partner_navn: m[2] }
  return null
}

// rows: [{ bib, name, club, category }]. fallback: the class for rows that do
// not say ('kvinne' | 'mann' | null to skip them). existing: the runners
// already in the race ({ bib, name }).
// -> { ok: [{ row, label, signup }], skipped: [{ row, why }] }
export function toSignups(rows, fallback, existing = []) {
  const takenBibs = new Set(existing.map((r) => String(Number(r.bib))))
  const takenNames = new Set()
  for (const r of existing) {
    // A relay runner's name holds the team and both runners.
    const m = clean(r.name).match(/^.+? \((.+) og (.+)\)$/)
    for (const n of m ? [m[1], m[2]] : [r.name]) takenNames.add(clean(n).toLowerCase())
  }
  const ok = []
  const skipped = []
  for (const row of rows) {
    const name = clean(row.name)
    if (!name) { skipped.push({ row, why: 'no name' }); continue }
    const kind = classOf(row.category) ?? fallback
    if (!kind) { skipped.push({ row, why: row.category ? `class “${clean(row.category)}” not understood` : 'no class' }); continue }

    let signup
    if (kind === 'stafett') {
      const team = relayOf(name, row.club)
      if (!team) { skipped.push({ row, why: 'relay team needs two runners (“Ann og Bo”)' }); continue }
      signup = { klasse: 'stafett', kjonn: null, ...team }
    } else {
      signup = { klasse: 'individuell', kjonn: kind, navn: name, lagnavn: null, partner_navn: null }
    }
    const names = [signup.navn, signup.partner_navn].filter(Boolean).map((n) => n.toLowerCase())
    if (names.some((n) => takenNames.has(n))) { skipped.push({ row, why: 'already in the race' }); continue }
    names.forEach((n) => takenNames.add(n))

    const bib = /^\d{1,4}$/.test(clean(row.bib)) && Number(row.bib) >= 1 ? String(Number(row.bib)) : null
    // A bib already used gets the next free one on the server instead.
    const freeBib = bib && !takenBibs.has(bib) ? bib : null
    if (freeBib) takenBibs.add(freeBib)
    signup.startnummer = freeBib ? Number(freeBib) : null
    const label = signup.klasse === 'stafett' ? `${signup.lagnavn} (${signup.navn} og ${signup.partner_navn})` : signup.navn
    ok.push({ row, label, signup, bibTaken: Boolean(bib && !freeBib) })
  }
  return { ok, skipped }
}

export const CLASS_NAME = { kvinne: 'Women', mann: 'Men', stafett: 'Relay' }

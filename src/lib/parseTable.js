// Turning a start-list file into rows.
//
// Handles CSV/TSV natively and defers Excel to SheetJS, which is only fetched
// when someone actually picks an .xlsx — it's far bigger than the rest of the
// app and this is a pre-race task, so it has no business in the offline bundle.

const DELIMS = [',', ';', '\t', '|']

// Norwegian Excel writes CSV with SEMICOLONS (comma is the decimal separator
// in this locale), so assuming "CSV = comma" would mangle the most likely file
// this app ever sees. Pick whichever delimiter is most consistent across lines.
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20)
  if (!lines.length) return ','
  let best = ','
  let bestScore = -1
  for (const d of DELIMS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d))
    const first = counts[0]
    if (!first) continue
    const consistent = counts.filter((c) => c === first).length / counts.length
    const score = consistent * 10 + first // prefer consistency, then richness
    if (score > bestScore) { bestScore = score; best = d }
  }
  return best
}

function countOutsideQuotes(line, delim) {
  let n = 0
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQ && line[i + 1] === '"') i++
      else inQ = !inQ
    } else if (c === delim && !inQ) n++
  }
  return n
}

// RFC4180-ish: quoted fields may contain the delimiter, newlines and escaped
// quotes. A naive split() would break on a name like "Berg, Kari".
export function parseDelimited(text, delim) {
  const rows = []
  let row = []
  let field = ''
  let inQ = false

  text = text.replace(/^﻿/, '') // strip BOM

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQ = false
      } else field += c
    } else if (c === '"') {
      inQ = true
    } else if (c === delim) {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); field = ''
      rows.push(row); row = []
    } else if (c === '\r') {
      // handled by \n
    } else {
      field += c
    }
  }
  row.push(field)
  rows.push(row)

  return rows
    .map((r) => r.map((f) => f.trim()))
    .filter((r) => r.some((f) => f !== ''))
}

export async function parseFile(file) {
  const name = (file.name || '').toLowerCase()
  const isExcel = /\.(xlsx|xlsm|xlsb|xls)$/.test(name)

  if (isExcel) {
    // Loaded on demand; see note at the top of the file.
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false })
    return rows
      .map((r) => r.map((c) => String(c ?? '').trim()))
      .filter((r) => r.some((c) => c !== ''))
  }

  const text = await file.text()
  return parseDelimited(text, detectDelimiter(text))
}

// ---- column mapping --------------------------------------------------------

// Norwegian and English headers, since the start list could come from either.
const HEADER_HINTS = {
  bib: ['bib', 'nr', 'no', 'number', 'startnr', 'startnummer', 'nummer'],
  name: ['name', 'navn', 'runner', 'løper', 'loper', 'fullname', 'fullt navn'],
  club: ['club', 'klubb', 'lag', 'team', 'by', 'city'],
  category: ['category', 'kategori', 'klasse', 'class', 'gender', 'kjønn', 'kjonn', 'div'],
  email: ['email', 'e-mail', 'epost', 'e-post', 'mail'],
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[_\s.]+/g, '')

// A first row counts as headers when it names at least one field we know and
// doesn't look like data (a row starting with a bare number is probably a bib).
export function looksLikeHeader(row) {
  if (!row?.length) return false
  const hits = row.filter((cell) => {
    const n = norm(cell)
    return Object.values(HEADER_HINTS).some((list) => list.includes(n))
  }).length
  return hits >= 1
}

export function guessMapping(rows) {
  const hasHeader = looksLikeHeader(rows[0])
  const mapping = { bib: -1, name: -1, club: -1, category: -1, email: -1 }

  if (hasHeader) {
    rows[0].forEach((cell, i) => {
      const n = norm(cell)
      for (const [field, list] of Object.entries(HEADER_HINTS)) {
        if (mapping[field] === -1 && list.includes(n)) mapping[field] = i
      }
    })
  }

  const body = hasHeader ? rows.slice(1) : rows
  // No usable headers: fall back to shape. A column that's numeric throughout
  // is the bib; the widest text column is the name.
  if (mapping.bib === -1 && mapping.name === -1 && body.length) {
    const cols = Math.max(...body.map((r) => r.length))
    for (let i = 0; i < cols; i++) {
      const vals = body.map((r) => r[i] ?? '').filter(Boolean)
      if (!vals.length) continue
      const numeric = vals.every((v) => /^\d{1,5}$/.test(v))
      if (numeric && mapping.bib === -1) { mapping.bib = i; continue }
      if (!numeric && mapping.name === -1) mapping.name = i
    }
    if (mapping.bib === -1 && cols > 0) mapping.bib = 0
    if (mapping.name === -1 && cols > 1) mapping.name = mapping.bib === 0 ? 1 : 0
  }

  return { hasHeader, mapping }
}

export function toRunnerRows(rows, mapping, hasHeader) {
  const body = hasHeader ? rows.slice(1) : rows
  const pick = (r, i) => (i >= 0 ? (r[i] ?? '').trim() : '')
  return body
    .map((r) => ({
      bib: pick(r, mapping.bib),
      name: pick(r, mapping.name),
      club: pick(r, mapping.club),
      category: pick(r, mapping.category),
      email: pick(r, mapping.email),
    }))
    .filter((r) => r.bib || r.name)
}

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import no from '../src/lib/i18n/no.js'

// Every text the app passes to t() (and the words plural() builds) needs a
// Norwegian entry, or a Norwegian phone shows that one text in English.
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name)
    if (d.isDirectory()) return d.name === 'i18n' ? [] : sources(p)
    return /\.(jsx?|mjs)$/.test(d.name) && !/\.test\./.test(d.name) ? [p] : []
  })
}

const STR = String.raw`'((?:[^'\\]|\\.)*)'`
const unq = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\')
const keys = new Set()
for (const f of sources('src')) {
  const s = readFileSync(f, 'utf8')
  // t('…'), and t(cond ? '…' : '…')
  for (const m of s.matchAll(new RegExp(String.raw`(?<![\w.])t\(` + STR, 'g'))) keys.add(unq(m[1]))
  for (const m of s.matchAll(new RegExp(String.raw`(?<![\w.])t\(\w+\s*\?\s*` + STR + String.raw`\s*:\s*` + STR, 'g'))) {
    keys.add(unq(m[1])); keys.add(unq(m[2]))
  }
  // plural(n, 'runner') needs 'runner' and 'runners'
  for (const m of s.matchAll(/\bplural\([^,()]+(?:\([^()]*\))?[^,()]*, '([^']+)'(?:, '([^']+)')?\)/g)) {
    keys.add(m[1]); keys.add(m[2] ?? `${m[1]}s`)
  }
  // Labels kept in tables and passed to t() where they are shown.
  if (/t\((?:\w+\.)?(?:label|title)\)|t\(GROUP_NAME|t\(STATE|t\(REJECTED/.test(s)) {
    for (const m of s.matchAll(new RegExp(String.raw`\b(?:label|title):\s*` + STR, 'g'))) if (/[a-z]/.test(m[1])) keys.add(unq(m[1]))
    for (const m of s.matchAll(new RegExp(String.raw`^\s+(?:'[\w-]+'|\w+):\s*` + STR + ',?$', 'gm'))) if (/[a-z]{2}/.test(m[1])) keys.add(unq(m[1]))
    for (const m of s.matchAll(new RegExp(String.raw`\[\s*'\w+',\s*` + STR + String.raw`\s*\]`, 'g'))) keys.add(unq(m[1]))
  }
}

describe('Norwegian texts', () => {
  it('has an entry for every text in the app', () => {
    const missing = [...keys].filter((k) => !(k in no)).sort()
    expect(missing).toEqual([])
  })
  it('keeps every {placeholder}', () => {
    const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join()
    const wrong = Object.entries(no).filter(([en, nb]) => ph(en) !== ph(nb)).map(([en]) => en)
    expect(wrong).toEqual([])
  })
})

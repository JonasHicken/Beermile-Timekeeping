import { useSyncExternalStore } from 'react'
import no from './i18n/no.js'

// The app's two languages. The English text is the key: t('Start heat')
// gives "Start heat" in English and the Norwegian entry from i18n/no.js in
// Norwegian (falling back to the English when an entry is missing, which
// i18n.test.js catches). Norwegian is the default; the choice is kept per
// phone.
//
// {name} in a text is filled from the second argument:
//   t('Delete {name}?', { name: ev.name })

const KEY = 'bmtk:lang'
export const LANGS = [
  { id: 'no', label: 'Norsk' },
  { id: 'en', label: 'English' },
]

function stored() {
  try {
    const v = localStorage.getItem(KEY)
    return LANGS.some((l) => l.id === v) ? v : null
  } catch { return null }
}

let lang = stored() ?? 'no'
const listeners = new Set()

function apply() {
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'no' ? 'nb' : 'en'
}
apply()

export const getLang = () => lang

export function setLang(next) {
  if (next === lang || !LANGS.some((l) => l.id === next)) return
  lang = next
  try { localStorage.setItem(KEY, next) } catch { /* not remembered */ }
  apply()
  listeners.forEach((f) => f())
}

export function useLang() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => lang,
    () => lang,
  )
}

export function t(text, vars) {
  let out = lang === 'no' ? (no[text] ?? text) : text
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
  return out
}

// "1 runner", "3 runners": both forms are keys, so Norwegian gets its own.
export const plural = (n, one, many = `${one}s`) => `${n} ${t(n === 1 ? one : many)}`

// "4th" in English, "4." in Norwegian.
export function ordinal(n) {
  if (lang === 'no') return `${n}.`
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

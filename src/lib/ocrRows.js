// Text read from a photo of a start list or result list, turned into rows the
// import understands. Text recognition gives lines with words separated by
// spaces, so the columns are guessed per line: a number first is the bib, a
// class word last is the class, and the rest is the name. A time (12:34 or
// 7:05.2) is dropped: a result list's times are not part of a start list.
//
// The rows come out as "Name; Class; Bib" text and go into the paste box, so
// the organiser reads and corrects them before importing anything.

const CLASS_WORDS = /^(kvinner?|menn|mann|stafett|women|woman|men|man|relay|k|m|d|h|dame|damer|herre|herrer)$/i
const TIME = /^\d{1,2}[:.]\d{2}([:.]\d{1,2})?([.,]\d)?$/
// The words of a list's header line, in Norwegian and English.
const HEADER = /^(start)?(nr|no|nummer|number)\.?$|^(bib|navn|name|deltaker|deltakere|runner|løper|løpere|klasse|class|kategori|category|klubb|club|lag|team|tid|time|plass|place|pl\.?|kjønn|gender|heat)$/i
// Stray marks text recognition reads from table lines and bullets.
const JUNK = /^[|_\-–—=•·*.,:;'"`~]+$/

export function ocrToRows(text) {
  const rows = []
  for (const raw of String(text).split(/\r?\n/)) {
    const words = raw.replace(/[|]/g, ' ').trim().split(/\s+/).filter((w) => w && !JUNK.test(w))
    // Nothing, or a header line ("Startnr Navn Klasse") of column words only.
    if (!words.length || words.every((w) => HEADER.test(w))) continue
    // A place in a result list ("1." or "1)") before the bib.
    if (words.length > 2 && /^\d{1,3}[.)]$/.test(words[0])) words.shift()
    let bib = ''
    if (/^\d{1,4}$/.test(words[0])) bib = words.shift()
    while (words.length && TIME.test(words[words.length - 1])) words.pop()
    let cls = ''
    if (words.length > 1 && CLASS_WORDS.test(words[words.length - 1])) cls = words.pop()
    // A bib written last, after the name.
    if (!bib && words.length > 1 && /^\d{1,4}$/.test(words[words.length - 1])) bib = words.pop()
    const name = words.join(' ')
    // A line without a letter in its name is a heading rule or a page number.
    if (!/\p{L}{2}/u.test(name)) continue
    rows.push({ name, cls, bib })
  }
  if (!rows.length) return ''
  return ['Navn; Klasse; Startnr', ...rows.map((r) => [r.name, r.cls, r.bib].join('; '))].join('\n')
}

// iPhone and iPad have Live Text built in (the camera reads text into any
// text box), so they need no download; everything else reads the photo here.
export function hasLiveText() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

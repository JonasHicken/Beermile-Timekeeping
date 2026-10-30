// The results as a picture to post: the race, then the top three in each class,
// at Instagram's 4:5 post size. Drawn on a canvas on the phone, in the app's
// own type and colours. By default text and colour only: no drinks or brands,
// so the picture is about the runners. The bottle mascot is an opt-in per
// picture, because in some countries (Norway's alcohol advertising ban, for
// one) beer imagery in a post about an event can count as alcohol marketing.
import { fmt } from './time.js'

const W = 1080
const H = 1350
const PAD = 84
const C = { bg: '#131211', panel: '#1e1c19', line: '#33302b', text: '#f4efe6', muted: '#9a938a', amber: '#ffa515', ink: '#111111' }
const ANTON = "'Anton', 'Arial Narrow', sans-serif"
const BARLOW = "'Barlow Condensed', 'Arial Narrow', sans-serif"

// Shortens text with an ellipsis until it fits.
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

// Text with its capital letters centred on y. The two typefaces sit
// differently in their line boxes, so "middle" left names lower than times;
// measuring "H" (not the text itself) keeps a name with a g or a p level.
function centred(ctx, text, x, y) {
  ctx.fillText(text, x, y + ctx.measureText('H').actualBoundingBoxAscent / 2)
}

// "2026-10-30" as "30. oktober 2026", the way the picture's readers write it.
function longDate(iso) {
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Up to two lines of a heading, breaking between words.
function lines(ctx, text, max) {
  const words = text.split(/\s+/)
  const out = ['']
  for (const w of words) {
    const tryLine = out[out.length - 1] ? `${out[out.length - 1]} ${w}` : w
    if (ctx.measureText(tryLine).width <= max || !out[out.length - 1]) out[out.length - 1] = tryLine
    else out.push(w)
  }
  return out.length > 2 ? [out[0], fit(ctx, out.slice(1).join(' '), max)] : out
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// podiums: [{ name, rows }] from raceResults.podiums(). mascot: put the bottle
// mascot in the corner (the organiser's choice per picture, see the header).
// Resolves to a PNG blob.
export async function drawResults({ title, date, podiums, mascot = false }) {
  try {
    await Promise.all([
      document.fonts.load(`96px ${ANTON}`),
      document.fonts.load(`700 44px ${BARLOW}`),
      document.fonts.load(`500 34px ${BARLOW}`),
    ])
  } catch { /* fall back to the system fonts in the stack */ }

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = C.amber
  ctx.fillRect(0, 0, W, 14)

  // The mascot cheering in the top corner, when asked for; the title keeps
  // clear of it. A picture without it is still complete if it fails to load.
  let titleW = W - PAD * 2
  if (mascot) {
    const img = await loadImage(`${import.meta.env.BASE_URL}mascot-cheer.svg`).catch(() => null)
    if (img) {
      const mw = 170
      ctx.drawImage(img, W - PAD - mw + 16, 40, mw, mw * (132 / 90))
      titleW -= mw + 10
    }
  }

  // The race
  let y = PAD + 30
  ctx.fillStyle = C.amber
  ctx.font = `700 30px ${BARLOW}`
  ctx.fillText('RESULTATER', PAD, y)
  y += 24
  ctx.fillStyle = C.text
  ctx.font = `92px ${ANTON}`
  for (const l of lines(ctx, (title || '').toUpperCase(), titleW)) { y += 100; ctx.fillText(l, PAD, y) }
  if (date) {
    y += 52
    ctx.fillStyle = C.muted
    ctx.font = `500 34px ${BARLOW}`
    ctx.fillText(longDate(date), PAD, y)
  }
  y += 30

  // Each class: its name, then up to three rows. The rows share out the room
  // that is left, so one class gets big rows and three still fit.
  const many = podiums.length >= 3
  const headH = many ? 64 : 78
  const rowCount = podiums.reduce((n, p) => n + p.rows.length, 0)
  const rowH = Math.max(72, Math.min(140, Math.floor((H - PAD - y - podiums.length * headH) / rowCount)))
  const big = Math.round(rowH * 0.56)
  const name = Math.round(rowH * 0.46)
  for (const p of podiums) {
    y += headH
    ctx.fillStyle = C.amber
    ctx.font = `${many ? 40 : 46}px ${ANTON}`
    ctx.fillText(p.name.toUpperCase(), PAD, y - 16)
    p.rows.forEach((r, i) => {
      const top = y + i * rowH
      const mid = top + rowH / 2
      ctx.fillStyle = i === 0 ? C.amber : C.panel
      ctx.fillRect(PAD, top + 6, W - PAD * 2, rowH - 12)
      ctx.fillStyle = i === 0 ? C.ink : C.amber
      ctx.font = `${big}px ${ANTON}`
      centred(ctx, String(i + 1), PAD + 28, mid)
      ctx.fillStyle = i === 0 ? C.ink : C.text
      const time = fmt(r.elapsed)
      const tw = ctx.measureText(time).width
      centred(ctx, time, W - PAD - 28 - tw, mid)
      ctx.font = `700 ${name}px ${BARLOW}`
      centred(ctx, fit(ctx, r.runner.name || `#${r.runner.bib}`, W - PAD * 2 - 150 - tw), PAD + 28 + big * 1.4, mid)
    })
    y += p.rows.length * rowH
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// Hands the picture to the phone's share sheet (Instagram, Messenger, saving
// it...), or downloads it where sharing files is not supported.
export async function sharePicture(blob, title) {
  const file = new File([blob], 'resultater.png', { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared' }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled' }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'resultater.png'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return 'downloaded'
}

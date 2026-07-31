// Regenerates the app icons from the source logo.
//
//   npm run icons                 # uses public/logo-source.png
//   npm run icons -- path/to.png  # or an explicit source
//
// The source is a sticker-style illustration on a WHITE background that also
// has a WHITE keyline around the figure. We flood-fill inward from the image
// border, so only white *connected to the edge* becomes transparent — white
// enclosed by the dark linework (helmet, the stars on the horn) survives.
//
// That flood fill necessarily also eats the keyline, because a white outline
// touching a white background is one contiguous region (verified: a test
// sticker trimmed to its dark body, losing the ring). The art's own linework is
// dark navy, which would disappear against this app's near-black canvas, so we
// rebuild the keyline afterwards: dilate the alpha, fill it, and composite the
// art back on top. Deliberate and controllable, rather than hoping the original
// outline survives the cut.
//
// Outputs:
//   public/logo.png            transparent, trimmed  (used in the app UI)
//   public/icon-192.png        transparent           (manifest)
//   public/icon-512.png        transparent           (manifest)
//   public/apple-touch-icon.png  flattened on the app's canvas colour, since
//                                iOS paints alpha black on the home screen.

import sharp from 'sharp'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const pub = path.join(root, 'public')

const BG = '#131211'        // app canvas colour
// >= this on ALL channels counts as background. Deliberately permissive: the
// source is a JPEG, so the sticker's die-cut shadow and compression ringing
// leave a band of off-white around the figure. Too strict a value stops the
// flood fill at that band and leaves a grey halo, which is glaring on a dark
// canvas. Being permissive also removes the original white keyline — which is
// fine, addKeyline() draws a clean one back. Safe for the art itself because
// every channel must be high, and the tan/navy/rust palette never is.
const WHITE = Number(process.env.WHITE_THRESHOLD ?? 200)
const PAD_RATIO = 0.06      // breathing room inside the icon square
const OUTLINE = '#f4efe6'   // rebuilt keyline colour (app's paper white)
const OUTLINE_RATIO = 0.018 // keyline width as a fraction of the art's longest side

const src = process.argv[2]
  ? path.resolve(process.argv[2])
  : ['logo-source.png', 'logo-source.jpg', 'logo-source.jpeg']
      .map((f) => path.join(pub, f))
      .find(existsSync)

if (!src || !existsSync(src)) {
  console.error(`\nSource image not found: ${pub}/logo-source.{png,jpg}\n`)
  console.error('Save the logo there (or pass a path) and re-run.\n')
  process.exit(1)
}

// Flood-fill transparency in from every border pixel.
async function removeBackground(file) {
  const img = sharp(file).ensureAlpha()
  const { width, height } = await img.metadata()
  const data = await img.raw().toBuffer() // RGBA

  const isLight = (i) =>
    data[i] >= WHITE && data[i + 1] >= WHITE && data[i + 2] >= WHITE

  const seen = new Uint8Array(width * height)
  const stack = []

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const p = y * width + x
    if (seen[p]) return
    if (!isLight(p * 4)) return
    seen[p] = 1
    stack.push(p)
  }

  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1) }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y) }

  while (stack.length) {
    const p = stack.pop()
    const x = p % width
    const y = (p - x) / width
    data[p * 4 + 3] = 0 // transparent
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }

  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

// Rebuild a sticker keyline around the cut-out art so its silhouette stays
// legible on a dark canvas. Dilation is approximated by blurring the alpha and
// re-thresholding it, which sharp can do without a morphology op.
async function addKeyline(buf) {
  const meta = await sharp(buf).metadata()
  const w = Math.round(Math.max(meta.width, meta.height) * OUTLINE_RATIO)
  if (w < 1) return buf

  // Grow the canvas first, or the outline gets clipped at the edges.
  const padded = await sharp(buf)
    .extend({ top: w, bottom: w, left: w, right: w, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const { width, height } = await sharp(padded).metadata()

  const mask = await sharp(padded)
    .extractChannel(3)
    .blur(w / 1.6)
    .threshold(24)
    .toBuffer()

  const outlineLayer = await sharp({
    create: { width, height, channels: 3, background: OUTLINE },
  })
    .joinChannel(mask)
    .png()
    .toBuffer()

  return sharp(outlineLayer).composite([{ input: padded }]).png().toBuffer()
}

// Center the (trimmed) logo on a transparent square with a little padding.
async function square(buf, size) {
  const inner = Math.round(size * (1 - PAD_RATIO * 2))
  const fitted = await sharp(buf)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: fitted, gravity: 'center' }])
    .png()
    .toBuffer()
}

const cut = await removeBackground(src)
// Trim the now-transparent margin so the art fills the icon.
const bare = await sharp(cut).trim({ threshold: 1 }).png().toBuffer()
const trimmed = await addKeyline(bare)

await sharp(trimmed).toFile(path.join(pub, 'logo.png'))

for (const size of [192, 512]) {
  await sharp(await square(trimmed, size)).toFile(path.join(pub, `icon-${size}.png`))
}

// iOS ignores alpha on the home screen and fills it black, so bake the canvas.
await sharp(await square(trimmed, 180))
  .flatten({ background: BG })
  .toFile(path.join(pub, 'apple-touch-icon.png'))

const meta = await sharp(trimmed).metadata()
console.log(`source      ${path.basename(src)}`)
console.log(`logo.png    ${meta.width}x${meta.height} (transparent, trimmed)`)
console.log('icon-192.png, icon-512.png, apple-touch-icon.png written')

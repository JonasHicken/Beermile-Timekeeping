// Copies the text-recognition files (Tesseract.js worker, its WebAssembly
// core, and the Norwegian and English language data) from node_modules into
// public/tesseract, so the app serves them itself: reading a photo needs no
// other site, and the photo never leaves the phone. Runs before dev and build;
// public/tesseract is not committed.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const out = 'public/tesseract'
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`))

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'core'), { recursive: true })
mkdirSync(join(out, 'lang'), { recursive: true })

cpSync(join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), join(out, 'worker.min.js'))

// Only the LSTM builds (the recognition mode the app uses); the worker picks
// the one with SIMD where the phone supports it.
const core = pkgDir('tesseract.js-core')
for (const f of readdirSync(core)) {
  if (/^tesseract-core(-\w+)?-lstm\.(wasm|wasm\.js|js)$/.test(f)) cpSync(join(core, f), join(out, 'core', f))
}

// The "best_int" models: accurate enough for printed and neat handwritten
// lists, and a fraction of the size of the full ones.
for (const lang of ['nor', 'eng']) {
  const dir = pkgDir(`@tesseract.js-data/${lang}`)
  const file = join(dir, '4.0.0_best_int', `${lang}.traineddata.gz`)
  if (!existsSync(file)) throw new Error(`Missing ${file}`)
  cpSync(file, join(out, 'lang', `${lang}.traineddata.gz`))
}
console.log('tesseract files copied to', out)

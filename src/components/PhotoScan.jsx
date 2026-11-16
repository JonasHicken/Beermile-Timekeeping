import { t } from '../lib/i18n.js'
import { useRef, useState } from 'react'
import { hasLiveText, ocrToRows } from '../lib/ocrRows.js'

// A photo of a start list or result list, read into the paste box below it.
// Nothing leaves the phone: on iPhone and iPad, Apple's Live Text reads the
// camera straight into the text box; elsewhere Tesseract.js reads the photo
// here, with its files served by this app (first use downloads them once,
// about 5 MB). The text lands in the paste box to be checked before import.
//   onText(text)  puts the rows in the paste box
//   pasteRef      the paste box, focused for Live Text
export default function PhotoScan({ onText, pasteRef }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [note, setNote] = useState(null) // { text, error }
  const fileRef = useRef(null)

  if (hasLiveText()) {
    return (
      <div className="stack" style={{ gap: 6, marginTop: 10 }}>
        <button type="button" className="btn ghost block" onClick={() => {
          pasteRef.current?.focus()
          setNote({ text: t('Tap the box again and choose Scan Text (or the text-scan icon above the keyboard), then point the camera at the list. Or open the photo in Photos, press and hold the text, Copy, and paste it here.') })
        }}>
          {t('Scan a list with the camera')}
        </button>
        {note && <div className="muted tiny">{note.text}</div>}
      </div>
    )
  }

  async function read(file) {
    if (!file) return
    setBusy(true); setProgress(0); setNote(null)
    let worker = null
    try {
      const { createWorker } = await import('tesseract.js')
      worker = await createWorker(['nor', 'eng'], 1, {
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/core',
        langPath: '/tesseract/lang',
        workerBlobURL: false,
        gzip: true,
        logger: (m) => { if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100)) },
      })
      const { data } = await worker.recognize(file)
      const rows = ocrToRows(data.text)
      if (!rows) { setNote({ text: t('No names found in the photo. Try a sharper photo, straight on, with good light.'), error: true }); return }
      onText(rows)
      setNote({ text: t('Read {n} rows. Check them in the box below and correct any mistakes before you use them.', { n: rows.split('\n').length - 1 }) })
    } catch (e) {
      setNote({ text: t('Could not read the photo: {why}', { why: e?.message || e }), error: true })
    } finally {
      await worker?.terminate().catch(() => {})
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="stack" style={{ gap: 6, marginTop: 10 }}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={(e) => read(e.target.files?.[0])} />
      <button type="button" className="btn ghost block" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? t('Reading the photo… {n} %', { n: progress }) : t('Take a photo of a list')}
      </button>
      {note ? <div className={note.error ? 'form-error' : 'muted tiny'}>{note.text}</div>
        : <div className="muted tiny">{t('Read on this phone; the photo is not sent anywhere. One runner per line works best.')}</div>}
    </div>
  )
}

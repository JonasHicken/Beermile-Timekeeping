import { useRef, useState } from 'react'
import { parseFile, parseDelimited, detectDelimiter, guessMapping, toRunnerRows } from '../lib/parseTable.js'
import { useStore, runnersInEvent, importRunnerRows, classifyImport } from '../lib/store.js'

const FIELDS = [
  { key: 'bib', label: 'Bib', required: true },
  { key: 'name', label: 'Name' },
  { key: 'club', label: 'Club' },
  { key: 'category', label: 'Category' },
  { key: 'email', label: 'Email' },
]

// Import a start list from a spreadsheet export or pasted text. Column mapping
// is shown rather than assumed: a start list that silently imports the wrong
// column is worse than one that asks.
export default function ImportDialog({ eventId, existingCount, onClose, onDone }) {
  const [rows, setRows] = useState(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState(null)
  const [sourceName, setSourceName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [replace, setReplace] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const existingBibs = useStore((s) => runnersInEvent(s, eventId).map((r) => r.bib))

  function ingest(parsed, label) {
    if (!parsed.length) { setError('That file had no readable rows.'); return }
    const { hasHeader: hh, mapping: m } = guessMapping(parsed)
    setRows(parsed)
    setHasHeader(hh)
    setMapping(m)
    setSourceName(label)
    setError('')
  }

  async function onFile(file) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      ingest(await parseFile(file), file.name)
    } catch (e) {
      setError(`Could not read that file: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  function usePaste() {
    const t = pasteText.trim()
    if (!t) { setError('Nothing pasted yet.'); return }
    ingest(parseDelimited(t, detectDelimiter(t)), 'pasted text')
  }

  const preview = rows && mapping ? toRunnerRows(rows, mapping, hasHeader) : []
  // The same check the import itself runs, so the numbers here are the truth.
  const plan = classifyImport(preview, replace ? [] : existingBibs)
  const skipped = plan.duplicates.length + plan.missingBib.length
  const canImport = plan.ok.length > 0 && mapping?.bib >= 0

  function doImport() {
    const result = importRunnerRows(eventId, preview, { replace })
    onDone(result)
    onClose()
  }

  const columnCount = rows ? Math.max(...rows.map((r) => r.length)) : 0

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet import" role="dialog" aria-modal="true" aria-label="Import start list">
        <div className="sheet-grip" />
        <div className="row">
          <div className="display grow" style={{ fontSize: 23 }}>Import start list</div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!rows && (
          <>
            <p className="muted" style={{ margin: '10px 0 16px' }}>
              Excel (.xlsx) or CSV. Exporting to CSV from Excel in Norwegian gives
              semicolons — that's handled.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button className="btn primary block lg" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Reading…' : 'Choose file'}
            </button>

            <div className="or-line"><span>or paste rows</span></div>

            <textarea
              rows={5}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'14, Ola Nordmann, OSI\n27, Kari Berg, BUL\n33, Per Hansen'}
            />
            <button className="btn block" style={{ marginTop: 10 }} onClick={usePaste}>
              Use pasted rows
            </button>
          </>
        )}

        {rows && mapping && (
          <>
            <div className="muted tiny" style={{ margin: '8px 0 14px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              {sourceName} · {rows.length} rows · {columnCount} columns
            </div>

            <button className="toggle" onClick={() => setHasHeader((v) => !v)}>
              <span className={`toggle-box${hasHeader ? ' on' : ''}`} />
              First row is a header
            </button>

            <div className="map-grid">
              {FIELDS.map((f) => (
                <label key={f.key} className="map-row">
                  <span className="label" style={{ margin: 0 }}>
                    {f.label}{f.required && <span style={{ color: 'var(--amber)' }}> *</span>}
                  </span>
                  <select
                    value={mapping[f.key]}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
                  >
                    <option value={-1}>— none —</option>
                    {Array.from({ length: columnCount }).map((_, i) => (
                      <option key={i} value={i}>
                        {hasHeader && rows[0][i] ? rows[0][i] : `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            {mapping.bib < 0 && (
              <div className="form-error" style={{ marginTop: 10 }}>
                Pick which column holds the bib number.
              </div>
            )}

            {preview.length > 0 && (
              <>
                <span className="label" style={{ marginTop: 18 }}>
                  Preview · {plan.ok.length} runners
                </span>
                {skipped > 0 && (
                  <div className="form-error" style={{ marginBottom: 10 }}>
                    {plan.duplicates.length > 0 && (
                      <div>
                        {plan.duplicates.length} will be skipped: bib already used
                        ({[...new Set(plan.duplicates.map((d) => d.bib))].slice(0, 6).join(', ')}
                        {plan.duplicates.length > 6 ? '…' : ''}).
                      </div>
                    )}
                    {plan.missingBib.length > 0 && (
                      <div>
                        {plan.missingBib.length} will be skipped: no bib number
                        ({plan.missingBib.slice(0, 3).map((r) => r.name || 'unnamed').join(', ')}
                        {plan.missingBib.length > 3 ? '…' : ''}).
                      </div>
                    )}
                  </div>
                )}
                <div className="list">
                  {preview.slice(0, 4).map((r, i) => (
                    <div className="item" key={i}>
                      <span className="bib">{r.bib || '—'}</span>
                      <span className="grow">
                        {r.name || <span className="muted">no name</span>}
                        {(r.club || r.category) && (
                          <span className="muted tiny"> · {[r.club, r.category].filter(Boolean).join(' · ')}</span>
                        )}
                      </span>
                    </div>
                  ))}
                  {preview.length > 4 && (
                    <div className="muted tiny center">+ {preview.length - 4} more</div>
                  )}
                </div>
              </>
            )}

            {existingCount > 0 && (
              <button className="toggle" style={{ marginTop: 14 }} onClick={() => setReplace((v) => !v)}>
                <span className={`toggle-box${replace ? ' on' : ''}`} />
                Replace the {existingCount} runners already here
              </button>
            )}
            {replace && (
              <div className="form-error">
                This clears the current start list, its heats and any recorded timing.
              </div>
            )}

            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn ghost grow" onClick={() => { setRows(null); setMapping(null) }}>
                Back
              </button>
              <button className="btn primary grow" disabled={!canImport} onClick={doImport}>
                Import {plan.ok.length}
              </button>
            </div>
          </>
        )}

        {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        <div style={{ height: 8 }} />
      </div>
    </>
  )
}

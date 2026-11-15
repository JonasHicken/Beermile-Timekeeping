import { t, plural } from '../lib/i18n.js'
import { useRef, useState } from 'react'
import { parseFile, parseDelimited, detectDelimiter, guessMapping, toRunnerRows } from '../lib/parseTable.js'
import { toSignups, CLASS_NAME } from '../lib/raceImport.js'

const FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'category', label: 'Class' },
  { key: 'bib', label: 'Bib' },
  { key: 'club', label: 'Relay team' },
]

// Race admin's import: a start list from Excel, CSV or pasted rows, added to
// the shared race as sign-ups (so they reach every phone and the race page).
// The columns are shown, not assumed, and the preview is exactly what is sent.
export default function RaceImport({ runners, busy, onClose, onImport }) {
  const [rows, setRows] = useState(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState(null)
  const [sourceName, setSourceName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [fallback, setFallback] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const fileRef = useRef(null)

  function ingest(parsed, label) {
    if (!parsed.length) { setError(t('That file had no readable rows.')); return }
    const g = guessMapping(parsed)
    setRows(parsed); setHasHeader(g.hasHeader); setMapping(g.mapping); setSourceName(label); setError('')
  }
  async function onFile(file) {
    if (!file) return
    setReading(true); setError('')
    try { ingest(await parseFile(file), file.name) }
    catch (e) { setError(t('Could not read that file: {why}', { why: e?.message || e })) }
    finally { setReading(false) }
  }
  function usePaste() {
    const t = pasteText.trim()
    if (!t) { setError(t('Nothing pasted yet.')); return }
    ingest(parseDelimited(t, detectDelimiter(t)), 'pasted text')
  }

  const preview = rows && mapping ? toRunnerRows(rows, mapping, hasHeader) : []
  const plan = toSignups(preview, fallback || null, runners)
  const bibsTaken = plan.ok.filter((x) => x.bibTaken).length
  const noBib = plan.ok.filter((x) => x.signup.startnummer == null && !x.bibTaken).length
  const columnCount = rows ? Math.max(...rows.map((r) => r.length)) : 0
  const reasons = Object.entries(plan.skipped.reduce((m, s) => ({ ...m, [s.why]: [...(m[s.why] ?? []), s.row] }), {}))

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet import" role="dialog" aria-modal="true" aria-label={t('Import start list')}>
        <div className="sheet-grip" />
        <div className="row">
          <div className="display grow" style={{ fontSize: 23 }}>{t('Import start list')}</div>
          <button className="btn ghost" onClick={onClose} aria-label={t('Close')}>✕</button>
        </div>

        {!rows && (
          <>
            <p className="muted" style={{ margin: '10px 0 16px' }}>
              {t('Excel (.xlsx) or CSV, one runner or relay team per row. The runners are added to this race like sign-ups, without a heat. Names already in the race are skipped, so importing the same list twice is safe.')}
            </p>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,text/csv"
              style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn primary block lg" disabled={reading} onClick={() => fileRef.current?.click()}>
              {reading ? t('Reading…') : t('Choose file')}
            </button>
            <div className="or-line"><span>{t('or paste rows')}</span></div>
            <textarea rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Name; Class; Bib\nOla Nordmann; Menn; 14\nKari Berg; Kvinner; 27\nLag 1 (Per og Pål); Stafett'} />
            <button className="btn block" style={{ marginTop: 10 }} onClick={usePaste}>{t('Use pasted rows')}</button>
          </>
        )}

        {rows && mapping && (
          <>
            <div className="muted tiny" style={{ margin: '8px 0 14px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              {sourceName} · {plural(rows.length, 'row')} · {plural(columnCount, 'column')}
            </div>
            <button className="toggle" onClick={() => setHasHeader((v) => !v)}>
              <span className={`toggle-box${hasHeader ? ' on' : ''}`} />
              {t('First row is a header')}
            </button>

            <div className="map-grid">
              {FIELDS.map((f) => (
                <label key={f.key} className="map-row">
                  <span className="label" style={{ margin: 0 }}>
                    {f.label}{f.required && <span style={{ color: 'var(--amber)' }}> *</span>}
                  </span>
                  <select value={mapping[f.key]} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}>
                    <option value={-1}>{t('— none —')}</option>
                    {Array.from({ length: columnCount }).map((_, i) => (
                      <option key={i} value={i}>{hasHeader && rows[0][i] ? rows[0][i] : `${t('Column')} ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="map-row">
                <span className="label" style={{ margin: 0 }}>{t('No class given')}</span>
                <select value={fallback} onChange={(e) => setFallback(e.target.value)}>
                  <option value="">{t('Skip the row')}</option>
                  <option value="kvinne">{t('Women')}</option>
                  <option value="mann">{t('Men')}</option>
                  <option value="stafett">{t('Relay')}</option>
                </select>
              </label>
            </div>
            <div className="muted tiny" style={{ marginTop: 6 }}>
              {t('Class is read from words like Kvinner / Menn / Stafett (or Women / Men / Relay). A relay team is written “Team (Ann og Bo)”, or “Ann og Bo” with the team name in its own column.')}
            </div>

            {mapping.name < 0 && <div className="form-error" style={{ marginTop: 10 }}>{t('Pick which column holds the names.')}</div>}

            {preview.length > 0 && (
              <>
                <span className="label" style={{ marginTop: 18 }}>{t('Preview · {n} to add', { n: plan.ok.length })}</span>
                {reasons.length > 0 && (
                  <div className="form-error" style={{ marginBottom: 10 }}>
                    {reasons.map(([why, list]) => (
                      <div key={why}>
                        {t('{n} skipped: {why}', { n: list.length, why: t(why) })} ({list.slice(0, 3).map((r) => r.name || t('unnamed')).join(', ')}{list.length > 3 ? '…' : ''}).
                      </div>
                    ))}
                  </div>
                )}
                {(bibsTaken > 0 || noBib > 0) && (
                  <div className="muted tiny" style={{ marginBottom: 8 }}>
                    {[bibsTaken && t('{n} with a bib already used', { n: bibsTaken }), noBib && t('{n} without a bib', { n: noBib })].filter(Boolean).join(` ${t('and')} `)}
                    {' '}{t('get the next free numbers.')}
                  </div>
                )}
                <div className="list">
                  {plan.ok.slice(0, 5).map((x, i) => (
                    <div className="item" key={i}>
                      <span className="bib">{x.signup.startnummer ?? '—'}</span>
                      <span className="grow">
                        {x.label}
                        <span className="muted tiny"> · {CLASS_NAME[x.signup.klasse === 'stafett' ? 'stafett' : x.signup.kjonn]}</span>
                      </span>
                    </div>
                  ))}
                  {plan.ok.length > 5 && <div className="muted tiny center">+ {plan.ok.length - 5} {t('more')}</div>}
                </div>
              </>
            )}

            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn ghost grow" onClick={() => { setRows(null); setMapping(null) }}>{t('Back')}</button>
              <button className="btn primary grow" disabled={busy || !plan.ok.length || mapping.name < 0}
                onClick={() => onImport(plan.ok)}>
                {busy ? t('Adding…') : t('Add {n}', { n: plan.ok.length })}
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

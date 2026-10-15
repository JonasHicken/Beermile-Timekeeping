# Beermile Timekeeping

Mobile-first race timing for beer miles. **Tap timing, live results, RFID-ready.**
Built to replace a hired timing crew: an operator taps a runner's tile as they
cross, the app tracks laps and finish times, and results are ready instantly.

## Why it's built this way

Timing is really two problems: the **clock** (an exact timestamp when someone
crosses — easy, must be perfect) and the **identity** (which bib — the hard part).
This app makes a human the identity engine (tap the tile) and the button the
clock. That is 100% reliable and needs no hardware.

**Local-first:** every tap writes to `localStorage` synchronously, so timing
never depends on the network. Supabase is a downstream publisher, not the
source of truth. Kill the signal mid-heat and nothing is lost.

**RFID-ready:** the crossings log is append-only with a `source` field
(`tap` | `rfid` | `manual`). A future RFID bridge writes crossings with
`source:'rfid'` into the exact same shape — every screen already understands
them. No rework needed to add hands-off chip timing later.

**Corrections never delete.** A mis-tap is voided, not removed, so the log
stays auditable and lap numbers are re-derived from chronological order at read
time.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. Create an event → add runners by hand or **Import from
file** (`.xlsx` / `.csv`) → **Auto-split** into heats → open a heat → **START** →
tap tiles as runners cross → **Results**.

Works offline with zero configuration. Data lives in your browser.

## Shared races (several phones, one race)

A race can be timed by more than one phone at once. Each phone opens the same
timing link; laps, heat start/finish and runner status are stamped with a device
id and a timestamp, queued in an outbox, and reconciled newest-wins. The start
list and heats come from the organiser and are read-only on the phones.

The server side for this lives in the **main site's** `supabase/schema.sql`,
not in this repo.

## Publishing to a website (optional)

1. Run `supabase/schema.sql` in the Supabase SQL Editor (safe to re-run).
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` +
   `VITE_SUPABASE_ANON_KEY` (the `sb_publishable_...` key).

The anon key can **read** published results (for a public live page) but not
write — publishing needs a service-role context or Supabase Auth (see
`src/lib/sync.js`). Entrant email is additionally protected by a column-level
grant, because RLS is row-level only and would not stop the public key reading
every entrant's address.

## Roadmap

- [x] Software core: start list, tap timing, laps, undo, live standings (offline)
- [x] Import start lists from Excel / CSV
- [x] Shared races: several phones timing one race
- [ ] Publish results live to a public website (`/live`)
- [ ] RFID input module: reader bridge → same crossings log → hands-off + lap splits
- [ ] Drinking-zone splits, multi-operator cross-check, results export

## Structure

| Path | What |
|---|---|
| `src/lib/store.js` | Local-first data model + the append-only crossings log |
| `src/lib/time.js` | Race time formatting / elapsed helpers |
| `src/lib/parseTable.js` | CSV/XLSX parsing, delimiter + column detection |
| `src/lib/online.js` | Shared-race sync loop (outbox out, changes in) |
| `src/lib/sync.js` | Supabase publish + public read/realtime (gated on write access) |
| `src/pages/Home.jsx` | Event list / create |
| `src/pages/Setup.jsx` | Start list + heats |
| `src/pages/Timing.jsx` | The tap-timing tile grid (the heart) |
| `src/pages/Review.jsx` | Chronological crossing log + corrections |
| `src/pages/Live.jsx` | Standings + splits |
| `src/pages/Join.jsx` | Joining a shared race from a timing link |
| `supabase/schema.sql` | `tk_*` tables, RLS (public read, no anon write) |

## Licence

MIT — see [LICENSE](LICENSE). The mascot artwork (`public/logo*`) is **not**
covered by it and remains the property of its author.

## Third-party

The bundled webfonts (Anton, Barlow Condensed) are licensed under the SIL Open
Font License 1.1; their license texts are in `public/fonts/`.

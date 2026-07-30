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
never depends on the network. Supabase is a downstream publisher for the public
live page, not the source of truth.

**RFID-ready:** the crossings log is append-only with a `source` field
(`tap` | `rfid` | `manual`). A future RFID bridge writes crossings with
`source:'rfid'` into the exact same shape — every screen already understands
them. No rework needed to add hands-off chip timing later.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. Create an event → paste a start list → **Auto-split**
into heats → open a heat → **START** → tap tiles as runners cross → **Results**.

Works offline with zero configuration. Data lives in your browser.

## Publishing to the website (optional)

1. Run `supabase/schema.sql` in the Supabase SQL Editor (safe to re-run).
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` +
   `VITE_SUPABASE_ANON_KEY` (the `sb_publishable_...` key).

The anon key can **read** published results (for the public live page) but not
write — publishing needs a service-role context or Supabase Auth (see
`src/lib/sync.js`). That wiring is the next milestone.

## Roadmap

- [x] Software core: start list, tap timing, laps, undo, live standings (offline)
- [ ] Publish results live to beermilenorge.no (`/live`)
- [ ] RFID input module: reader bridge → same crossings log → hands-off + lap splits
- [ ] Drinking-zone splits, multi-operator cross-check, results export

## Structure

| Path | What |
|---|---|
| `src/lib/store.js` | Local-first data model + the append-only crossings log |
| `src/lib/time.js` | Race time formatting / elapsed helpers |
| `src/lib/sync.js` | Supabase publish + public read/realtime (gated on write access) |
| `src/pages/Home.jsx` | Event list / create |
| `src/pages/Setup.jsx` | Start list + heats |
| `src/pages/Timing.jsx` | The tap-timing tile grid (the heart) |
| `src/pages/Live.jsx` | Standings + splits |
| `supabase/schema.sql` | `tk_*` tables, RLS (public read, no anon write) |

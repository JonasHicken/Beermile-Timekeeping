# Beermile Timekeeping

> **🚧 Still in development.** The core works end to end and runs offline, but
> it has not yet timed a real race. Expect rough edges and breaking changes to
> the data format until it has.

Mobile-first race timing for beer miles. **Tap timing, live results, RFID-ready.**

## What it's for

A beer mile is four laps of a 400 m track, with a beer finished before each
lap. Races run in heats of 25–30 people starting together, and every runner
needs four lap times and a finish time — plus penalty laps for anyone who
doesn't keep their beer down.

Timing that properly has meant hiring a professional timing crew, which is
expensive for a small volunteer-run event. This app exists to replace that
crew with phones the organisers already own, while ending up just as accurate
and a lot more hands-off.

It was built for the Norwegian championship run by Norges Beermile Forbund,
but nothing in it is specific to one event: any organiser can create a race,
load a start list and time it.

## The idea

Timing is really two problems:

- **The clock** — an exact timestamp when someone crosses the line. Easy, but
  it must be perfect.
- **The identity** — *which* runner crossed. This is the hard part.

Camera and bib-recognition approaches try to solve both at once and fail on
the second: bibs get covered, crumpled and blocked by the runner in front. So
this app splits them. Right now a person is the identity engine — they tap the
runner's tile as they cross — and the tap is the clock. That is reliable today
and needs no hardware.

The data model is designed so that later, an **RFID chip reader** at the line
can replace the person doing the tapping without changing the app. Crossings
land in the same log whether they came from a tap or a chip, so the goal —
fully hands-off timing with per-lap splits — is an added input, not a rewrite.

Underneath that is one rule: **the network is never in the timing path.** A
track rarely has good signal, so every tap is saved on the phone first and
published afterwards. Losing signal mid-heat loses nothing.

## How that shows up in the code

**Local-first:** every tap writes to `localStorage` synchronously, so timing
never waits on the network. Supabase is a downstream publisher, not the source
of truth. A service worker caches the app itself, so it also reloads with no
signal.

**RFID-ready:** the crossings log is append-only with a `source` field
(`tap` | `rfid` | `manual`). An RFID bridge writes crossings with
`source:'rfid'` into the exact same shape, and every screen already
understands them.

**Corrections never delete.** A mis-tap is voided, not removed, so the log
stays auditable and can be reconciled against chip data. Lap numbers are
re-derived from chronological order when read, so voiding one lap renumbers the
ones after it.

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

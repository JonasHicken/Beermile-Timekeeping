-- Beermile Timekeeping — database schema
-- Run in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Tables are prefixed `tk_` so they can share a project with
-- the main beermilenorge.no site without colliding.
--
-- Trust model (matches the main site's pattern):
--   * The public anon key may READ everything here (the live results page is
--     public) but may NOT write. Timing is authored on the operator's device
--     and PUBLISHED by an authenticated operator, so the anon key can never
--     forge or corrupt crossings.
--   * Until you wire Supabase Auth into the timing app, publishing is done with
--     the SERVICE ROLE key from a trusted context (never shipped to the browser)
--     — e.g. a tiny publish step, or later the RFID bridge. See sync.js.

-- ============================================================
-- EVENTS
-- ============================================================
create table if not exists public.tk_events (
  id          uuid primary key,
  name        text not null,
  date        date,
  num_laps    integer not null default 4,
  published   boolean not null default true,   -- show on public live page
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.tk_events drop constraint if exists tk_events_len;
alter table public.tk_events add constraint tk_events_len check (
  char_length(name) <= 120 and num_laps between 1 and 40
);

-- ============================================================
-- RUNNERS (start list)
-- ============================================================
create table if not exists public.tk_runners (
  id          uuid primary key,
  event_id    uuid not null references public.tk_events(id) on delete cascade,
  bib         text not null,
  name        text not null default '',
  category    text not null default '',
  heat_id     uuid,
  epc         text,                            -- reserved: RFID tag EPC -> bib map
  created_at  timestamptz not null default now()
);
create index if not exists tk_runners_event on public.tk_runners(event_id);

alter table public.tk_runners drop constraint if exists tk_runners_len;
alter table public.tk_runners add constraint tk_runners_len check (
  char_length(bib) <= 16 and char_length(name) <= 80 and char_length(category) <= 40
);

-- ============================================================
-- HEATS
-- ============================================================
create table if not exists public.tk_heats (
  id          uuid primary key,
  event_id    uuid not null references public.tk_events(id) on delete cascade,
  name        text not null,
  "order"     integer not null default 0,
  status      text not null default 'pending', -- pending | running | done
  started_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists tk_heats_event on public.tk_heats(event_id);

-- ============================================================
-- CROSSINGS (append-only timing log — the system of record)
-- ============================================================
-- `source` is the whole RFID-readiness story: 'tap' today, 'rfid' when the
-- bridge lands, 'manual' for review edits. `void` marks corrections without
-- deleting, so the log stays auditable and reconcilable against chip data.
create table if not exists public.tk_crossings (
  id           uuid primary key,
  event_id     uuid not null references public.tk_events(id) on delete cascade,
  heat_id      uuid not null,
  runner_id    uuid not null,
  bib          text,
  lap          integer not null,
  captured_at  timestamptz not null,           -- absolute wall-clock of the crossing
  source       text not null default 'tap',    -- tap | rfid | manual
  rssi         integer,                         -- reserved: RFID signal strength
  void         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists tk_crossings_event on public.tk_crossings(event_id);
create index if not exists tk_crossings_heat on public.tk_crossings(heat_id);

alter table public.tk_crossings drop constraint if exists tk_crossings_src;
alter table public.tk_crossings add constraint tk_crossings_src
  check (source in ('tap', 'rfid', 'manual'));

-- ============================================================
-- ROW LEVEL SECURITY: anon may READ (public live page), never WRITE.
-- ============================================================
alter table public.tk_events    enable row level security;
alter table public.tk_runners   enable row level security;
alter table public.tk_heats     enable row level security;
alter table public.tk_crossings enable row level security;

-- Public read of published events only, and of the rows belonging to them.
drop policy if exists tk_events_read on public.tk_events;
create policy tk_events_read on public.tk_events
  for select to anon using (published = true);

drop policy if exists tk_runners_read on public.tk_runners;
create policy tk_runners_read on public.tk_runners
  for select to anon using (
    exists (select 1 from public.tk_events e where e.id = event_id and e.published)
  );

drop policy if exists tk_heats_read on public.tk_heats;
create policy tk_heats_read on public.tk_heats
  for select to anon using (
    exists (select 1 from public.tk_events e where e.id = event_id and e.published)
  );

drop policy if exists tk_crossings_read on public.tk_crossings;
create policy tk_crossings_read on public.tk_crossings
  for select to anon using (
    exists (select 1 from public.tk_events e where e.id = event_id and e.published)
  );

-- NOTE: no INSERT/UPDATE/DELETE policies for anon on purpose. The service role
-- bypasses RLS and is what publishes (see sync.js). When you add Supabase Auth
-- to the app, add operator-scoped write policies here (e.g. `to authenticated`).

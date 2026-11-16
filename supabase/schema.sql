-- Beermile Timekeeping: database for shared races
-- ============================================================
-- Run in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run again after an update: it only adds and replaces.
--
-- What it is for. The app times a race on one phone without any of this.
-- With it, a race is SHARED: an organiser (logged in by email) creates it,
-- gets an admin link for themselves and a timer link for helpers, and every
-- phone sees the same start list, heats and laps.
--
-- Who may do what.
--   * Organisers log in with Supabase Auth (a link by email). Logged in, they
--     can create races, list their own, and delete them.
--   * Everything about one race goes through its two links. The ADMIN link's
--     token starts and finishes heats, edits the start list and names the
--     timers. The TIMER link records laps, and only for the runners the admin
--     gave that timer; it also needs the timer's name typed in, so a leaked
--     link is no use on its own.
--   * Nothing here is readable or writable by table: no grants to anon or
--     authenticated. Only the functions below touch the tables, and each
--     checks the link or the login first.
--   * A race's results are public only while its admin has switched them on
--     (tk_offentlig), so a test heat on race morning shows nowhere.
--
-- Several phones. Each phone works without signal and sends its taps when it
-- can. Laps are rows with ids made on the phone, so phones never overwrite
-- each other's laps; where two phones touch the same thing (a heat's start, a
-- runner's status), the newer change wins by `endret_ms`. `rev` is a server
-- counter so a phone asks only for laps changed since it last looked, and
-- `versjon` lets it skip the start list when nothing in it changed.
--
-- Personal data. Runners' names are kept for the race and deleted with it:
-- tk_rydd() removes races three months after their date, and runs every
-- time a race is created and from the scheduled keep-awake job.

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.tk_events (
  id          uuid primary key default gen_random_uuid(),
  eier        uuid references auth.users(id) on delete cascade,
  name        text not null,
  date        date,
  tid         text,                       -- start time, free text ("18:00")
  sted        text,                       -- venue
  num_laps    integer not null default 4, -- the number of timing points
  oppsett     jsonb,                      -- the app's format: kind, distance, points
  published   boolean not null default false, -- results public (tk_offentlig)
  eksport     jsonb,                      -- where results can be sent (set by a linked website)
  versjon     bigint not null default 0,  -- bumped when the start list, heats or race change
  created_at  timestamptz not null default now()
);
alter table public.tk_events drop constraint if exists tk_events_len;
alter table public.tk_events add constraint tk_events_len check (
  char_length(name) between 1 and 120 and num_laps between 1 and 40 and
  char_length(coalesce(tid, '')) <= 60 and char_length(coalesce(sted, '')) <= 160 and
  length(coalesce(oppsett::text, '')) <= 4000 and length(coalesce(eksport::text, '')) <= 2000
);
create index if not exists tk_events_eier on public.tk_events (eier);

create table if not exists public.tk_runners (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.tk_events(id) on delete cascade,
  bib        text not null,
  name       text not null default '',
  category   text,
  heat_id    uuid,
  status     text not null default 'ok',
  straffe    int not null default 0,     -- penalty laps (beer mile)
  tidtaker   text,                       -- the timer timing this runner
  endret_ms  bigint not null default 0
);
alter table public.tk_runners drop constraint if exists tk_runners_ok;
alter table public.tk_runners add constraint tk_runners_ok check (
  status in ('ok', 'dnf', 'dns', 'dq') and straffe between 0 and 9 and
  char_length(bib) between 1 and 10 and char_length(name) <= 100 and char_length(coalesce(category, '')) <= 40
);
create index if not exists tk_runners_event on public.tk_runners (event_id);
create unique index if not exists tk_runners_bib on public.tk_runners (event_id, bib);

create table if not exists public.tk_heats (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.tk_events(id) on delete cascade,
  name        text not null,
  "order"     int not null,
  status      text not null default 'pending' check (status in ('pending', 'running', 'done')),
  started_at  timestamptz,
  endret_ms   bigint not null default 0
);
create index if not exists tk_heats_event on public.tk_heats (event_id);

create sequence if not exists public.tk_rev_seq;
create table if not exists public.tk_crossings (
  id           uuid primary key,
  event_id     uuid not null references public.tk_events(id) on delete cascade,
  heat_id      uuid not null,
  runner_id    uuid not null,
  bib          text,
  lap          integer not null,
  punkt        integer,                  -- which timing point (from 0); null: counted in time order
  captured_at  timestamptz not null,
  source       text not null default 'tap' check (source in ('tap', 'rfid', 'manual')),
  void         boolean not null default false,
  enhet        text,                     -- the phone that made it
  endret_ms    bigint not null default 0,
  rev          bigint not null default nextval('public.tk_rev_seq'),
  created_at   timestamptz not null default now()
);
alter table public.tk_crossings add column if not exists punkt integer;
create index if not exists tk_crossings_rev on public.tk_crossings (event_id, rev);
create index if not exists tk_crossings_runner on public.tk_crossings (runner_id);

-- The race's two links and its timers' names (the names are the timer codes).
create table if not exists public.tk_tilgang (
  event_id     uuid primary key references public.tk_events(id) on delete cascade,
  token        text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  admin_token  text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  tidtakere    jsonb not null default '[]'::jsonb,
  -- Timers placed at a timing point: { "name": point index from 0 }. A timer
  -- at a point taps every runner who passes it; one without times only the
  -- runners the admin gave them.
  stasjoner    jsonb not null default '{}'::jsonb
);
alter table public.tk_tilgang add column if not exists stasjoner jsonb not null default '{}'::jsonb;

-- Nothing by table, for anyone: only the functions below.
alter table public.tk_events    enable row level security;
alter table public.tk_runners   enable row level security;
alter table public.tk_heats     enable row level security;
alter table public.tk_crossings enable row level security;
alter table public.tk_tilgang   enable row level security;
revoke all on table public.tk_events, public.tk_runners, public.tk_heats, public.tk_crossings, public.tk_tilgang
  from anon, authenticated;
revoke all on sequence public.tk_rev_seq from anon, authenticated;

-- The start list's version: any change to runners, heats, the race or its
-- timers bumps it, so tk_hent can leave the start list out when a phone has it.
create or replace function public.tk_ny_versjon()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_event uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
begin
  update public.tk_events set versjon = nextval('public.tk_rev_seq') where id = v_event;
  return null;
end $$;
create or replace function public.tk_ny_versjon_event()
returns trigger language plpgsql as $$
begin
  if row(new.name, new.date, new.num_laps, new.oppsett, new.eksport, new.published)
     is distinct from row(old.name, old.date, old.num_laps, old.oppsett, old.eksport, old.published) then
    new.versjon := nextval('public.tk_rev_seq');
  end if;
  return new;
end $$;
drop trigger if exists tk_runners_versjon on public.tk_runners;
create trigger tk_runners_versjon after insert or update or delete on public.tk_runners
  for each row execute function public.tk_ny_versjon();
drop trigger if exists tk_heats_versjon on public.tk_heats;
create trigger tk_heats_versjon after insert or update or delete on public.tk_heats
  for each row execute function public.tk_ny_versjon();
drop trigger if exists tk_tilgang_versjon on public.tk_tilgang;
create trigger tk_tilgang_versjon after insert or update on public.tk_tilgang
  for each row execute function public.tk_ny_versjon();
drop trigger if exists tk_events_versjon on public.tk_events;
create trigger tk_events_versjon before update on public.tk_events
  for each row execute function public.tk_ny_versjon_event();

-- ============================================================
-- HELPERS
-- ============================================================

create or replace function public.tk_ms(t timestamptz)
returns bigint language sql immutable as $$ select (extract(epoch from t) * 1000)::bigint $$;
revoke all on function public.tk_ms(timestamptz) from public, anon, authenticated;
revoke all on function public.tk_ny_versjon() from public, anon, authenticated;
revoke all on function public.tk_ny_versjon_event() from public, anon, authenticated;

-- 'admin' or 'timer' for a link's token, or raises.
create or replace function public.tk_rolle(p_event uuid, p_token text)
returns text language plpgsql security definer stable set search_path = public as $$
declare
  v text;
begin
  select case when t.admin_token = p_token then 'admin' when t.token = p_token then 'timer' end
    into v from public.tk_tilgang t where t.event_id = p_event;
  if p_token is null or v is null then
    raise exception 'ugyldig tidtakerlenke' using hint = 'ingen_tilgang';
  end if;
  return v;
end $$;
revoke all on function public.tk_rolle(uuid, text) from public, anon, authenticated;

-- Raises unless the token is the race's admin link.
create or replace function public.tk_krev_admin(p_event uuid, p_token text)
returns void language plpgsql security definer stable set search_path = public as $$
begin
  if public.tk_rolle(p_event, p_token) <> 'admin' then
    raise exception 'bare admin-lenken kan gjøre dette' using hint = 'ikke_admin';
  end if;
end $$;
revoke all on function public.tk_krev_admin(uuid, text) from public, anon, authenticated;

-- The admin's spelling of the name a timer typed, or null for the admin link.
-- Raises for a timer link without a name on the list.
create or replace function public.tk_tidtakernavn(p_event uuid, p_token text, p_tidtaker text)
returns text language plpgsql security definer stable set search_path = public as $$
declare
  v_liste jsonb;
  v_navn  text;
begin
  if public.tk_rolle(p_event, p_token) = 'admin' then return null; end if;
  select tidtakere into v_liste from public.tk_tilgang where event_id = p_event;
  if jsonb_array_length(coalesce(v_liste, '[]'::jsonb)) = 0 then
    raise exception 'Arrangøren har ikke lagt inn tidtakere ennå.' using hint = 'ingen_tidtakere';
  end if;
  if nullif(btrim(coalesce(p_tidtaker, '')), '') is null then
    raise exception 'Skriv navnet ditt for å komme inn.' using hint = 'trenger_navn';
  end if;
  select v into v_navn from jsonb_array_elements_text(v_liste) v where lower(v) = lower(btrim(p_tidtaker)) limit 1;
  if v_navn is null then
    raise exception 'Navnet står ikke på listen over tidtakere.' using hint = 'feil_navn';
  end if;
  return v_navn;
end $$;
revoke all on function public.tk_tidtakernavn(uuid, text, text) from public, anon, authenticated;

-- The category a class gets: Kvinner, Menn or Stafett.
create or replace function public.tk_kategori(p_klasse text, p_kjonn text)
returns text language sql immutable as $$
  select case when p_klasse = 'stafett' then 'Stafett' when p_kjonn = 'kvinne' then 'Kvinner' else 'Menn' end
$$;
revoke all on function public.tk_kategori(text, text) from public, anon, authenticated;

-- ============================================================
-- ORGANISERS (logged in)
-- ============================================================

-- Deletes races three months after their date (or after they were made, for
-- one without a date). Anyone may run it: it only removes what has expired.
create or replace function public.tk_rydd()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v int;
begin
  delete from public.tk_events
   where coalesce(date, created_at::date) < current_date - interval '3 months';
  get diagnostics v = row_count;
  return jsonb_build_object('slettet', v, 'naa', public.tk_ms(clock_timestamp()));
end $$;
revoke all on function public.tk_rydd() from public;
grant execute on function public.tk_rydd() to anon, authenticated;

-- A new shared race for the logged-in organiser. At most 10 a day and 30 at
-- once per organiser, so a stolen login cannot fill the database.
create or replace function public.tk_opprett_lop(p_navn text, p_dato date default null, p_oppsett jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_eier  uuid := auth.uid();
  v_navn  text := nullif(btrim(coalesce(p_navn, '')), '');
  v_punkt int := coalesce(jsonb_array_length(p_oppsett->'points'), 4);
  v_id    uuid;
begin
  if v_eier is null then raise exception 'Logg inn for å lage et delt løp.' using hint = 'ikke_innlogget'; end if;
  if v_navn is null or char_length(v_navn) > 120 then raise exception 'Gi løpet et navn.' using hint = 'ugyldig'; end if;
  if v_punkt < 1 or v_punkt > 40 then raise exception 'Ugyldig oppsett.' using hint = 'ugyldig'; end if;
  perform public.tk_rydd();
  if (select count(*) from public.tk_events where eier = v_eier and created_at > now() - interval '1 day') >= 10
     or (select count(*) from public.tk_events where eier = v_eier) >= 30 then
    raise exception 'Du har laget mange løp. Slett noen gamle, eller vent til i morgen.' using hint = 'for_mange';
  end if;
  insert into public.tk_events (eier, name, date, num_laps, oppsett)
  values (v_eier, v_navn, p_dato, v_punkt, p_oppsett) returning id into v_id;
  insert into public.tk_tilgang (event_id) values (v_id);
  return (select jsonb_build_object('id', v_id, 'admin_token', t.admin_token, 'token', t.token)
            from public.tk_tilgang t where t.event_id = v_id);
end $$;
revoke all on function public.tk_opprett_lop(text, date, jsonb) from public, anon;
grant execute on function public.tk_opprett_lop(text, date, jsonb) to authenticated;

-- The logged-in organiser's races, with their links: how they get back in on
-- a new phone.
create or replace function public.tk_mine_lop()
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Logg inn først.' using hint = 'ikke_innlogget'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'name', e.name, 'date', e.date, 'admin_token', t.admin_token,
      'runners', (select count(*) from public.tk_runners r where r.event_id = e.id))
      order by e.date desc nulls last, e.created_at desc)
    from public.tk_events e join public.tk_tilgang t on t.event_id = e.id
   where e.eier = auth.uid()), '[]'::jsonb);
end $$;
revoke all on function public.tk_mine_lop() from public, anon;
grant execute on function public.tk_mine_lop() to authenticated;

-- Deletes one of the organiser's races, with everything in it.
create or replace function public.tk_slett_lop(p_event uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from public.tk_events where id = p_event and eier = auth.uid() and auth.uid() is not null;
  if not found then raise exception 'Fant ikke løpet.' using hint = 'ugyldig'; end if;
  return jsonb_build_object('slettet', true);
end $$;
revoke all on function public.tk_slett_lop(uuid) from public, anon;
grant execute on function public.tk_slett_lop(uuid) to authenticated;

-- A new link for the race's timers (the old one stops working), or, with
-- p_admin, a new admin link: for the owner, logged in, after one leaked.
create or replace function public.tk_ny_lenke(p_event uuid, p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ny text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not exists (select 1 from public.tk_events where id = p_event and eier = auth.uid() and auth.uid() is not null) then
    raise exception 'Bare den som laget løpet kan gjøre dette.' using hint = 'ikke_eier';
  end if;
  if p_admin then update public.tk_tilgang set admin_token = v_ny where event_id = p_event;
  else update public.tk_tilgang set token = v_ny where event_id = p_event; end if;
  return (select jsonb_build_object('admin_token', admin_token, 'token', token) from public.tk_tilgang where event_id = p_event);
end $$;
revoke all on function public.tk_ny_lenke(uuid, boolean) from public, anon;
grant execute on function public.tk_ny_lenke(uuid, boolean) to authenticated;

-- ============================================================
-- THE PHONES: fetch and send
-- ============================================================

-- Everything a phone needs. The start list and heats come only when they have
-- changed since p_versjon (what the phone has); the laps changed since p_siden.
drop function if exists public.tk_hent(uuid, text, bigint, text);
create or replace function public.tk_hent(
  p_event uuid, p_token text, p_siden bigint default 0, p_tidtaker text default null, p_versjon bigint default 0
)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_rolle  text := public.tk_rolle(p_event, p_token);
  v_navn   text := public.tk_tidtakernavn(p_event, p_token, p_tidtaker);
  v_admin  boolean := v_rolle = 'admin';
  v_versjon bigint := (select versjon from public.tk_events where id = p_event);
  v_alt    boolean := coalesce(p_versjon, 0) = 0 or v_versjon is distinct from p_versjon;
  v_svar   jsonb;
begin
  v_svar := jsonb_build_object(
    'naa', public.tk_ms(clock_timestamp()),
    'rolle', v_rolle,
    'meg', v_navn,
    'versjon', v_versjon,
    'crossings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'heat_id', c.heat_id, 'runner_id', c.runner_id, 'bib', c.bib, 'lap', c.lap,
        'punkt', c.punkt, 'captured_at', public.tk_ms(c.captured_at), 'source', c.source, 'void', c.void,
        'enhet', c.enhet, 'endret_ms', c.endret_ms, 'rev', c.rev) order by c.rev)
      from public.tk_crossings c where c.event_id = p_event and c.rev > coalesce(p_siden, 0)), '[]'::jsonb)
  );
  if not v_alt then return v_svar; end if;
  return v_svar || jsonb_build_object(
    -- The names are the timers' codes: the admin's eyes only.
    'tidtakere', case when v_admin then (select t.tidtakere from public.tk_tilgang t where t.event_id = p_event) end,
    'tidtakertoken', case when v_admin then (select t.token from public.tk_tilgang t where t.event_id = p_event) end,
    -- Timing points: the admin sees where everyone stands, a timer only their own.
    'stasjoner', case when v_admin then (select t.stasjoner from public.tk_tilgang t where t.event_id = p_event) end,
    'stasjon', case when v_navn is not null then
      (select (t.stasjoner ->> v_navn)::int from public.tk_tilgang t where t.event_id = p_event) end,
    'event', (select jsonb_build_object('id', e.id, 'name', e.name, 'date', e.date, 'num_laps', e.num_laps,
                       'oppsett', e.oppsett, 'eksport', case when v_admin then e.eksport end)
                from public.tk_events e where e.id = p_event),
    'runners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'bib', r.bib, 'name', r.name, 'category', r.category, 'heat_id', r.heat_id,
        'status', r.status, 'straffe', r.straffe, 'endret_ms', r.endret_ms,
        'tidtaker', case when v_admin or r.tidtaker = v_navn then r.tidtaker end,
        'annen', not v_admin and r.tidtaker is not null and r.tidtaker <> v_navn))
      from public.tk_runners r where r.event_id = p_event), '[]'::jsonb),
    'heats', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'name', h.name, 'order', h."order", 'status', h.status,
        'started_at', public.tk_ms(h.started_at), 'endret_ms', h.endret_ms))
      from public.tk_heats h where h.event_id = p_event), '[]'::jsonb)
  );
end $$;
revoke all on function public.tk_hent(uuid, text, bigint, text, bigint) from public;
grant execute on function public.tk_hent(uuid, text, bigint, text, bigint) to anon, authenticated;

-- A phone sending what it has done. Laps are inserted or, if the phone changed
-- one, updated when newer. Heats change only from the admin link; a timer's
-- laps and runner changes count only for the runners given to that timer.
create or replace function public.tk_send(
  p_event uuid, p_token text, p_enhet text,
  p_crossings jsonb default '[]', p_heats jsonb default '[]', p_runners jsonb default '[]',
  p_tidtaker text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rolle   text := public.tk_rolle(p_event, p_token);
  v_navn    text := public.tk_tidtakernavn(p_event, p_token, p_tidtaker);
  -- The timing point this timer stands at, if the admin placed them at one.
  v_stasjon int := case when v_navn is not null then
    (select (t.stasjoner ->> v_navn)::int from public.tk_tilgang t where t.event_id = p_event) end;
begin
  if jsonb_array_length(coalesce(p_crossings, '[]')) > 500
     or jsonb_array_length(coalesce(p_heats, '[]')) > 50
     or jsonb_array_length(coalesce(p_runners, '[]')) > 500 then
    raise exception 'for mye på en gang' using hint = 'ugyldig';
  end if;

  insert into public.tk_crossings as c
    (id, event_id, heat_id, runner_id, bib, lap, punkt, captured_at, source, void, enhet, endret_ms, rev)
  select x.id, p_event, x.heat_id, x.runner_id, r.bib, greatest(1, least(x.lap, 49)),
         case when x.punkt between 0 and 48 then x.punkt end,
         to_timestamp(x.captured_at / 1000.0),
         case when x.source in ('tap', 'rfid', 'manual') then x.source else 'tap' end,
         coalesce(x.void, false), left(p_enhet, 40), x.endret_ms, nextval('public.tk_rev_seq')
    from jsonb_to_recordset(coalesce(p_crossings, '[]')) as x(
           id uuid, heat_id uuid, runner_id uuid, lap int, punkt int, captured_at bigint,
           source text, void boolean, endret_ms bigint)
    join public.tk_runners r on r.id = x.runner_id and r.event_id = p_event
    join public.tk_heats h on h.id = x.heat_id and h.event_id = p_event
   where x.id is not null and x.captured_at is not null and x.endret_ms is not null
     -- A timer at a timing point taps everyone passing it, at that point only.
     and (v_rolle = 'admin' or r.tidtaker = v_navn or (v_stasjon is not null and x.punkt = v_stasjon))
  on conflict (id) do update
     set runner_id = excluded.runner_id, bib = excluded.bib, captured_at = excluded.captured_at,
         source = excluded.source, void = excluded.void, endret_ms = excluded.endret_ms,
         rev = nextval('public.tk_rev_seq')
   where c.event_id = p_event and c.endret_ms < excluded.endret_ms
     -- A timer changes only laps of their own runners, or at their own timing
     -- point, never another timer's.
     and (v_rolle = 'admin'
          or exists (select 1 from public.tk_runners o where o.id = c.runner_id and o.tidtaker = v_navn)
          or (v_stasjon is not null and c.punkt = v_stasjon and excluded.punkt = v_stasjon));

  if v_rolle = 'admin' then
    update public.tk_heats h
       set status = x.status,
           started_at = case when x.started_at is null then null else to_timestamp(x.started_at / 1000.0) end,
           endret_ms = x.endret_ms
      from jsonb_to_recordset(coalesce(p_heats, '[]')) as x(id uuid, status text, started_at bigint, endret_ms bigint)
     where h.id = x.id and h.event_id = p_event and x.endret_ms is not null
       and x.status in ('pending', 'running', 'done') and h.endret_ms < x.endret_ms;
  end if;

  update public.tk_runners r
     set status = x.status, straffe = greatest(0, least(coalesce(x.straffe, 0), 9)), endret_ms = x.endret_ms
    from jsonb_to_recordset(coalesce(p_runners, '[]')) as x(id uuid, status text, straffe int, endret_ms bigint)
   where r.id = x.id and r.event_id = p_event and x.endret_ms is not null
     and x.status in ('ok', 'dnf', 'dns', 'dq') and r.endret_ms < x.endret_ms
     and (v_rolle = 'admin' or r.tidtaker = v_navn);

  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()));
end $$;
revoke all on function public.tk_send(uuid, text, text, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.tk_send(uuid, text, text, jsonb, jsonb, jsonb, text) to anon, authenticated;

-- ============================================================
-- RACE ADMIN (the admin link)
-- ============================================================

-- The race itself.
create or replace function public.tk_admin_lopsinfo(p_event uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.tk_krev_admin(p_event, p_token);
  return (select jsonb_build_object('naa', public.tk_ms(clock_timestamp()),
            'tittel', e.name, 'dato', e.date, 'tid', e.tid, 'sted', e.sted, 'vis_resultater', e.published,
            'koblet', e.eksport->>'navn')
            from public.tk_events e where e.id = p_event);
end $$;
revoke all on function public.tk_admin_lopsinfo(uuid, text) from public;
grant execute on function public.tk_admin_lopsinfo(uuid, text) to anon, authenticated;

-- Changes the race: only the keys present (tittel, dato, tid, sted, vis_resultater).
create or replace function public.tk_admin_sett_lop(p_event uuid, p_token text, p_endring jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tittel text := nullif(btrim(coalesce(p_endring->>'tittel', '')), '');
  v_dato   date;
begin
  perform public.tk_krev_admin(p_event, p_token);
  if p_endring ? 'tittel' then
    if v_tittel is null or char_length(v_tittel) > 120 then raise exception 'Navnet må ha 1 til 120 tegn.' using hint = 'ugyldig'; end if;
    update public.tk_events set name = v_tittel where id = p_event;
  end if;
  if p_endring ? 'dato' then
    begin v_dato := nullif(p_endring->>'dato', '')::date;
    exception when others then raise exception 'Ugyldig dato.' using hint = 'ugyldig'; end;
    update public.tk_events set date = v_dato where id = p_event;
  end if;
  if p_endring ? 'tid' then
    if char_length(coalesce(p_endring->>'tid', '')) > 60 then raise exception 'Tidspunktet er for langt.' using hint = 'ugyldig'; end if;
    update public.tk_events set tid = nullif(btrim(p_endring->>'tid'), '') where id = p_event;
  end if;
  if p_endring ? 'sted' then
    if char_length(coalesce(p_endring->>'sted', '')) > 160 then raise exception 'Stedet er for langt.' using hint = 'ugyldig'; end if;
    update public.tk_events set sted = nullif(btrim(p_endring->>'sted'), '') where id = p_event;
  end if;
  if p_endring ? 'vis_resultater' then
    update public.tk_events set published = coalesce((p_endring->>'vis_resultater')::boolean, published) where id = p_event;
  end if;
  return public.tk_admin_lopsinfo(p_event, p_token);
end $$;
revoke all on function public.tk_admin_sett_lop(uuid, text, jsonb) from public;
grant execute on function public.tk_admin_sett_lop(uuid, text, jsonb) to anon, authenticated;

-- What is timed: the timing points decide num_laps.
create or replace function public.tk_admin_sett_format(p_event uuid, p_token text, p_oppsett jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_punkt int := coalesce(jsonb_array_length(p_oppsett->'points'), 0);
begin
  perform public.tk_krev_admin(p_event, p_token);
  if jsonb_typeof(p_oppsett) <> 'object' or v_punkt < 1 or v_punkt > 40 or length(p_oppsett::text) > 4000 then
    raise exception 'Ugyldig oppsett: 1 til 40 tidtakingspunkter.' using hint = 'ugyldig';
  end if;
  update public.tk_events set oppsett = p_oppsett, num_laps = v_punkt where id = p_event;
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()), 'runder', v_punkt);
end $$;
revoke all on function public.tk_admin_sett_format(uuid, text, jsonb) from public;
grant execute on function public.tk_admin_sett_format(uuid, text, jsonb) to anon, authenticated;

-- Where the Results tab can send results: set by a website the race is linked
-- to ({navn, url, key, kode, nokkel}: the site's name, its database address
-- and publishable key, and this race's code and key there). Null unlinks.
create or replace function public.tk_admin_sett_eksport(p_event uuid, p_token text, p_eksport jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.tk_krev_admin(p_event, p_token);
  if p_eksport is not null and (jsonb_typeof(p_eksport) <> 'object' or length(p_eksport::text) > 2000
     or coalesce(p_eksport->>'url', '') !~ '^https://') then
    raise exception 'Ugyldig kobling.' using hint = 'ugyldig';
  end if;
  update public.tk_events set eksport = p_eksport where id = p_event;
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()));
end $$;
revoke all on function public.tk_admin_sett_eksport(uuid, text, jsonb) from public;
grant execute on function public.tk_admin_sett_eksport(uuid, text, jsonb) to anon, authenticated;

-- The timers: p_tidtakere (when not null) replaces the list of names; runners
-- given to a name no longer on it go back to nobody. p_tildeling is
-- [{runner_id, tidtaker}], tidtaker null or '' for nobody.
create or replace function public.tk_admin_tidtakere(
  p_event uuid, p_token text, p_tidtakere jsonb default null, p_tildeling jsonb default '[]'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_navn jsonb;
begin
  perform public.tk_krev_admin(p_event, p_token);
  if p_tidtakere is not null then
    if jsonb_typeof(p_tidtakere) <> 'array' or jsonb_array_length(p_tidtakere) > 30 then
      raise exception 'ugyldig liste' using hint = 'ugyldig';
    end if;
    select coalesce(jsonb_agg(n order by i), '[]'::jsonb) into v_navn
      from (select distinct on (lower(n)) n, i
              from (select left(btrim(e #>> '{}'), 30) as n, i
                      from jsonb_array_elements(p_tidtakere) with ordinality as a(e, i)) s
             where n <> '' order by lower(n), i) d;
    update public.tk_tilgang t set tidtakere = v_navn,
           stasjoner = coalesce((select jsonb_object_agg(k, v) from jsonb_each(t.stasjoner) as s(k, v)
                                  where exists (select 1 from jsonb_array_elements_text(v_navn) n where n = k)), '{}'::jsonb)
     where event_id = p_event;
    update public.tk_runners r set tidtaker = null
     where r.event_id = p_event and r.tidtaker is not null
       and not exists (select 1 from jsonb_array_elements_text(v_navn) v where v = r.tidtaker);
  end if;
  select tidtakere into v_navn from public.tk_tilgang where event_id = p_event;
  update public.tk_runners r set tidtaker = nullif(btrim(x.tidtaker), '')
    from jsonb_to_recordset(coalesce(p_tildeling, '[]')) as x(runner_id uuid, tidtaker text)
   where r.id = x.runner_id and r.event_id = p_event
     and (nullif(btrim(x.tidtaker), '') is null
          or exists (select 1 from jsonb_array_elements_text(v_navn) v where v = btrim(x.tidtaker)));
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()), 'tidtakere', v_navn);
end $$;
revoke all on function public.tk_admin_tidtakere(uuid, text, jsonb, jsonb) from public;
grant execute on function public.tk_admin_tidtakere(uuid, text, jsonb, jsonb) to anon, authenticated;

-- Timing points: p_stasjoner { "name": point index from 0, or null to take
-- them off their point }. Only names on the timer list and points the race
-- has are kept. Returns the whole map.
create or replace function public.tk_admin_sett_stasjoner(p_event uuid, p_token text, p_stasjoner jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_navn   jsonb;
  v_punkter int;
  v_ny     jsonb;
begin
  perform public.tk_krev_admin(p_event, p_token);
  if jsonb_typeof(p_stasjoner) is distinct from 'object' then
    raise exception 'ugyldig liste' using hint = 'ugyldig';
  end if;
  select tidtakere into v_navn from public.tk_tilgang where event_id = p_event;
  select coalesce(jsonb_array_length(e.oppsett -> 'points'), e.num_laps) into v_punkter
    from public.tk_events e where e.id = p_event;
  -- The old map with the given names replaced (null takes a name off).
  select coalesce(jsonb_object_agg(m.k, m.v), '{}'::jsonb) into v_ny
    from (select s.k, s.v from public.tk_tilgang t, jsonb_each(t.stasjoner) as s(k, v)
           where t.event_id = p_event and not p_stasjoner ? s.k
          union all
          select s.k, s.v from jsonb_each(p_stasjoner) as s(k, v)
           where jsonb_typeof(s.v) = 'number') m;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_ny
    from jsonb_each(v_ny) as s(k, v)
   where exists (select 1 from jsonb_array_elements_text(v_navn) n where n = k)
     and (v #>> '{}') ~ '^[0-9]+$' and (v #>> '{}')::int < v_punkter;
  update public.tk_tilgang set stasjoner = v_ny where event_id = p_event;
  return v_ny;
end $$;
revoke all on function public.tk_admin_sett_stasjoner(uuid, text, jsonb) from public;
grant execute on function public.tk_admin_sett_stasjoner(uuid, text, jsonb) to anon, authenticated;

-- Heats: [{runner_id, heat}] with heat a number from 1, or null for none.
-- Heats are made as "Heat 1", "Heat 2"... as needed and empty ones that have
-- not started are removed. Nobody moves out of or into a heat that has started.
create or replace function public.tk_admin_fordel_heat(p_event uuid, p_token text, p_fordeling jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_maks   int;
  v_endret bigint := public.tk_ms(clock_timestamp());
begin
  perform public.tk_krev_admin(p_event, p_token);
  perform 1 from public.tk_events where id = p_event for update;
  select coalesce(max(x.heat), 0) into v_maks from jsonb_to_recordset(p_fordeling) as x(runner_id uuid, heat int);
  if v_maks > 40 then raise exception 'for mange heat' using hint = 'ugyldig'; end if;

  insert into public.tk_heats (id, event_id, name, "order", status, endret_ms)
  select gen_random_uuid(), p_event, 'Heat ' || n, n - 1, 'pending', v_endret
    from generate_series(1, v_maks) n
   where not exists (select 1 from public.tk_heats h where h.event_id = p_event and h."order" = n - 1);

  update public.tk_runners r
     set heat_id = (select h.id from public.tk_heats h where h.event_id = p_event and h."order" = x.heat - 1),
         endret_ms = greatest(r.endret_ms, v_endret)
    from jsonb_to_recordset(p_fordeling) as x(runner_id uuid, heat int)
   where r.id = x.runner_id and r.event_id = p_event
     and not exists (select 1 from public.tk_heats h where h.id = r.heat_id and h.status <> 'pending')
     and not exists (select 1 from public.tk_heats h where h.event_id = p_event and h."order" = x.heat - 1 and h.status <> 'pending');

  delete from public.tk_heats h
   where h.event_id = p_event and h.status = 'pending'
     and not exists (select 1 from public.tk_runners r where r.heat_id = h.id);
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()));
end $$;
revoke all on function public.tk_admin_fordel_heat(uuid, text, jsonb) from public;
grant execute on function public.tk_admin_fordel_heat(uuid, text, jsonb) to anon, authenticated;

-- One runner or relay team, with the next free bib (or p_startnummer when it
-- is free). p_heat puts them in a heat that has not started, made if needed.
-- A name already in the race is refused: most likely the same person twice.
create or replace function public.tk_admin_legg_til_loper(
  p_event uuid, p_token text, p_klasse text, p_navn text, p_kjonn text default null,
  p_lagnavn text default null, p_partner_navn text default null,
  p_heat int default null, p_startnummer int default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_navn    text := nullif(btrim(coalesce(p_navn, '')), '');
  v_lag     text := nullif(btrim(coalesce(p_lagnavn, '')), '');
  v_partner text := nullif(btrim(coalesce(p_partner_navn, '')), '');
  v_stafett boolean := p_klasse = 'stafett';
  v_fullt   text;
  v_nr      int;
  v_heat    uuid;
  v_status  text;
  v_endret  bigint := public.tk_ms(clock_timestamp());
begin
  perform public.tk_krev_admin(p_event, p_token);
  perform 1 from public.tk_events where id = p_event for update;
  if coalesce(p_klasse, '') not in ('individuell', 'stafett') or v_navn is null
     or (v_stafett and (v_lag is null or v_partner is null))
     or (p_klasse = 'individuell' and coalesce(p_kjonn, '') not in ('kvinne', 'mann')) then
    raise exception 'Fyll inn navn og klasse.' using hint = 'ugyldig';
  end if;
  if p_heat is not null and (p_heat < 1 or p_heat > 40) then raise exception 'Ugyldig heat.' using hint = 'ugyldig'; end if;

  v_fullt := left(case when v_stafett then v_lag || ' (' || v_navn || ' og ' || v_partner || ')' else v_navn end, 100);
  if exists (select 1 from public.tk_runners r where r.event_id = p_event
               and (lower(r.name) = lower(v_fullt)
                    or (not v_stafett and lower(r.name) = lower(v_navn))
                    or position(' (' || lower(v_navn) || ' og ' in lower(r.name)) > 0
                    or right(lower(r.name), char_length(v_navn) + 5) = ' og ' || lower(v_navn) || ')')) then
    raise exception 'Navnet er allerede påmeldt.' using hint = 'navn_finnes';
  end if;

  if p_heat is not null then
    select id, status into v_heat, v_status from public.tk_heats where event_id = p_event and "order" = p_heat - 1;
    if v_heat is null then
      v_heat := gen_random_uuid();
      insert into public.tk_heats (id, event_id, name, "order", status, endret_ms)
      values (v_heat, p_event, 'Heat ' || p_heat, p_heat - 1, 'pending', v_endret);
    elsif v_status <> 'pending' then
      raise exception 'Heat % har startet. Velg et heat som ikke har startet.', p_heat using hint = 'heat_startet';
    end if;
  end if;

  if p_startnummer between 1 and 9999
     and not exists (select 1 from public.tk_runners where event_id = p_event and bib = p_startnummer::text) then
    v_nr := p_startnummer;
  else
    select coalesce(max(nullif(regexp_replace(bib, '\D', '', 'g'), '')::int), 0) + 1 into v_nr
      from public.tk_runners where event_id = p_event;
  end if;

  insert into public.tk_runners (event_id, bib, name, category, heat_id, endret_ms)
  values (p_event, v_nr::text, v_fullt, public.tk_kategori(p_klasse, p_kjonn), v_heat, v_endret);
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()), 'ny_bib', v_nr::text);
end $$;
revoke all on function public.tk_admin_legg_til_loper(uuid, text, text, text, text, text, text, int, int) from public;
grant execute on function public.tk_admin_legg_til_loper(uuid, text, text, text, text, text, text, int, int) to anon, authenticated;

-- Removes a runner who has not run a lap (DNS/DNF is for one who has).
-- Returns what undo needs to put them back.
create or replace function public.tk_admin_fjern_loper(p_event uuid, p_token text, p_runner_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_runner public.tk_runners;
  v_heat   int;
  v_m      text[];
begin
  perform public.tk_krev_admin(p_event, p_token);
  select * into v_runner from public.tk_runners where id = p_runner_id and event_id = p_event;
  if not found then return jsonb_build_object('naa', public.tk_ms(clock_timestamp())); end if;
  if exists (select 1 from public.tk_crossings where runner_id = p_runner_id and not void) then
    raise exception 'Løperen har registrerte runder og kan ikke fjernes. Marker løperen som DNS eller DNF i stedet.'
      using hint = 'har_runder';
  end if;
  select "order" + 1 into v_heat from public.tk_heats where id = v_runner.heat_id;
  delete from public.tk_runners where id = p_runner_id;
  v_m := regexp_match(v_runner.name, '^(.+) \((.+) og (.+)\)$');
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()), 'fjernet_heat', v_heat,
    'fjernet', jsonb_build_object(
      'klasse', case when v_runner.category = 'Stafett' then 'stafett' else 'individuell' end,
      'navn', case when v_runner.category = 'Stafett' and v_m is not null then v_m[2] else v_runner.name end,
      'partner_navn', case when v_runner.category = 'Stafett' and v_m is not null then v_m[3] end,
      'lagnavn', case when v_runner.category = 'Stafett' and v_m is not null then v_m[1] end,
      'kjonn', case v_runner.category when 'Kvinner' then 'kvinne' when 'Menn' then 'mann' end,
      'startnummer', nullif(regexp_replace(v_runner.bib, '\D', '', 'g'), '')::int));
end $$;
revoke all on function public.tk_admin_fjern_loper(uuid, text, uuid) from public;
grant execute on function public.tk_admin_fjern_loper(uuid, text, uuid) to anon, authenticated;

-- A whole start list (Import, or a linked website sending its sign-ups):
-- each row added like one runner; a row that cannot be (a name already in)
-- is skipped and reported.
create or replace function public.tk_admin_importer_lopere(p_event uuid, p_token text, p_rader jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rad  jsonb;
  v_i    int := 0;
  v_svar jsonb;
  v_lagt jsonb := '[]'::jsonb;
  v_hopp jsonb := '[]'::jsonb;
begin
  perform public.tk_krev_admin(p_event, p_token);
  if jsonb_typeof(p_rader) <> 'array' or jsonb_array_length(p_rader) > 500 then
    raise exception 'Høyst 500 rader om gangen.' using hint = 'ugyldig';
  end if;
  for v_rad in select * from jsonb_array_elements(p_rader) loop
    v_i := v_i + 1;
    begin
      v_svar := public.tk_admin_legg_til_loper(p_event, p_token,
        v_rad->>'klasse', v_rad->>'navn', v_rad->>'kjonn', v_rad->>'lagnavn', v_rad->>'partner_navn', null,
        case when (v_rad->>'startnummer') ~ '^\d{1,4}$' then (v_rad->>'startnummer')::int end);
      v_lagt := v_lagt || jsonb_build_object('rad', v_i, 'bib', v_svar->>'ny_bib');
    exception when others then
      v_hopp := v_hopp || jsonb_build_object('rad', v_i, 'grunn', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()), 'lagt_til', v_lagt, 'hoppet_over', v_hopp);
end $$;
revoke all on function public.tk_admin_importer_lopere(uuid, text, jsonb) from public;
grant execute on function public.tk_admin_importer_lopere(uuid, text, jsonb) to anon, authenticated;

-- Undoing an import: removes these bibs, except anyone who has run a lap since.
create or replace function public.tk_admin_fjern_lopere(p_event uuid, p_token text, p_bibs text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_fjernet int := 0;
  v_beholdt int := 0;
begin
  perform public.tk_krev_admin(p_event, p_token);
  for v_id in select id from public.tk_runners where event_id = p_event and bib = any (p_bibs) loop
    if exists (select 1 from public.tk_crossings where runner_id = v_id and not void) then
      v_beholdt := v_beholdt + 1;
    else
      delete from public.tk_runners where id = v_id;
      v_fjernet := v_fjernet + 1;
    end if;
  end loop;
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()), 'fjernet', v_fjernet, 'beholdt', v_beholdt);
end $$;
revoke all on function public.tk_admin_fjern_lopere(uuid, text, text[]) from public;
grant execute on function public.tk_admin_fjern_lopere(uuid, text, text[]) to anon, authenticated;

-- One bib: p_fra becomes p_til; with p_bytt, whoever has p_til gets p_fra.
create or replace function public.tk_admin_sett_startnummer(
  p_event uuid, p_token text, p_fra int, p_til int, p_bytt boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_a uuid;
  v_b uuid;
  v_bnavn text;
begin
  perform public.tk_krev_admin(p_event, p_token);
  if p_til is null or p_til < 1 or p_til > 9999 then
    raise exception 'Startnummeret må være et tall fra 1 til 9999.' using hint = 'ugyldig';
  end if;
  perform 1 from public.tk_events where id = p_event for update;
  if p_fra = p_til then return jsonb_build_object('naa', public.tk_ms(clock_timestamp())); end if;
  select id into v_a from public.tk_runners where event_id = p_event and bib = p_fra::text;
  if v_a is null then raise exception 'Fant ingen med startnummer %.', p_fra using hint = 'ugyldig'; end if;
  select id, name into v_b, v_bnavn from public.tk_runners where event_id = p_event and bib = p_til::text;
  if v_b is not null and not coalesce(p_bytt, false) then
    raise exception 'Startnummer % er allerede tatt av %.', p_til, v_bnavn using hint = 'opptatt', detail = v_bnavn;
  end if;
  -- Through a free placeholder: (event_id, bib) is unique.
  update public.tk_runners set bib = '#' || p_fra where id = v_a;
  if v_b is not null then update public.tk_runners set bib = p_fra::text where id = v_b; end if;
  update public.tk_runners set bib = p_til::text where id = v_a;
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()), 'byttet_med', v_bnavn);
end $$;
revoke all on function public.tk_admin_sett_startnummer(uuid, text, int, int, boolean) from public;
grant execute on function public.tk_admin_sett_startnummer(uuid, text, int, int, boolean) to anon, authenticated;

-- Many bibs at once, [{fra, til}]: all or nothing.
create or replace function public.tk_admin_tildel_startnummer(p_event uuid, p_token text, p_tildeling jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  perform public.tk_krev_admin(p_event, p_token);
  perform 1 from public.tk_events where id = p_event for update;
  select count(*) into v_n
    from jsonb_to_recordset(coalesce(p_tildeling, '[]')) as x(fra int, til int)
    join public.tk_runners r on r.event_id = p_event and r.bib = x.fra::text;
  if v_n <> jsonb_array_length(coalesce(p_tildeling, '[]')) then
    raise exception 'Startlisten er endret siden forhåndsvisningen. Prøv igjen.' using hint = 'endret';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_tildeling) as x(fra int, til int) where x.til is null or x.til < 1 or x.til > 9999) then
    raise exception 'Startnumrene må være fra 1 til 9999.' using hint = 'ugyldig';
  end if;
  if (select count(distinct x.til) from jsonb_to_recordset(p_tildeling) as x(fra int, til int)) <> v_n then
    raise exception 'Samme startnummer kan ikke gis to ganger.' using hint = 'ugyldig';
  end if;
  if exists (select 1 from public.tk_runners r, jsonb_to_recordset(p_tildeling) as x(fra int, til int)
              where r.event_id = p_event and r.bib = x.til::text
                and r.bib not in (select y.fra::text from jsonb_to_recordset(p_tildeling) as y(fra int, til int))) then
    raise exception 'Et av de nye numrene har allerede noen som ikke er med i tildelingen.' using hint = 'opptatt';
  end if;
  update public.tk_runners r set bib = '#' || x.fra
    from jsonb_to_recordset(p_tildeling) as x(fra int, til int) where r.event_id = p_event and r.bib = x.fra::text;
  update public.tk_runners r set bib = x.til::text
    from jsonb_to_recordset(p_tildeling) as x(fra int, til int) where r.event_id = p_event and r.bib = '#' || x.fra;
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()), 'n', v_n);
end $$;
revoke all on function public.tk_admin_tildel_startnummer(uuid, text, jsonb) from public;
grant execute on function public.tk_admin_tildel_startnummer(uuid, text, jsonb) to anon, authenticated;

-- A runner's name and/or class (women or men; a relay team keeps its class).
create or replace function public.tk_admin_rett_loper(
  p_event uuid, p_token text, p_runner_id uuid, p_navn text default null, p_kjonn text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_runner public.tk_runners;
  v_navn   text := nullif(btrim(coalesce(p_navn, '')), '');
begin
  perform public.tk_krev_admin(p_event, p_token);
  select * into v_runner from public.tk_runners where id = p_runner_id and event_id = p_event;
  if not found then raise exception 'Fant ikke løperen.' using hint = 'ugyldig'; end if;
  if v_navn is not null then
    if char_length(v_navn) > 100 then raise exception 'Navnet er for langt.' using hint = 'ugyldig'; end if;
    update public.tk_runners set name = v_navn where id = p_runner_id;
  end if;
  if p_kjonn is not null then
    if p_kjonn not in ('kvinne', 'mann') then raise exception 'Ugyldig klasse.' using hint = 'ugyldig'; end if;
    if v_runner.category = 'Stafett' then raise exception 'Et stafettlag kan ikke bytte klasse.' using hint = 'ugyldig'; end if;
    update public.tk_runners set category = public.tk_kategori('individuell', p_kjonn) where id = p_runner_id;
  end if;
  return jsonb_build_object('naa', public.tk_ms(clock_timestamp()));
end $$;
revoke all on function public.tk_admin_rett_loper(uuid, text, uuid, text, text) from public;
grant execute on function public.tk_admin_rett_loper(uuid, text, uuid, text, text) to anon, authenticated;

-- ============================================================
-- PUBLIC: live results on a web page
-- ============================================================

-- A race's results, while its admin has them switched on. No timer names, no
-- links. Any web page can show them with the race's id.
create or replace function public.tk_offentlig(p_event uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not exists (select 1 from public.tk_events where id = p_event and published) then return null; end if;
  return jsonb_build_object(
    'naa', public.tk_ms(clock_timestamp()),
    'event', (select jsonb_build_object('id', e.id, 'name', e.name, 'date', e.date, 'tid', e.tid, 'sted', e.sted,
                       'num_laps', e.num_laps, 'oppsett', e.oppsett)
                from public.tk_events e where e.id = p_event),
    'runners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'bib', r.bib, 'name', r.name, 'category', r.category, 'heat_id', r.heat_id,
        'status', r.status, 'straffe', r.straffe))
      from public.tk_runners r where r.event_id = p_event), '[]'::jsonb),
    'heats', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'name', h.name, 'order', h."order", 'status', h.status, 'started_at', public.tk_ms(h.started_at)))
      from public.tk_heats h where h.event_id = p_event), '[]'::jsonb),
    'crossings', coalesce((select jsonb_agg(jsonb_build_object(
        'heat_id', c.heat_id, 'runner_id', c.runner_id, 'punkt', c.punkt, 'captured_at', public.tk_ms(c.captured_at))
        order by c.captured_at)
      from public.tk_crossings c where c.event_id = p_event and not c.void), '[]'::jsonb)
  );
end $$;
revoke all on function public.tk_offentlig(uuid) from public;
grant execute on function public.tk_offentlig(uuid) to anon, authenticated;

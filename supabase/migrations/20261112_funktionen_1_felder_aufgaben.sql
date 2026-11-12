-- Funktionen Teil 1: Cutter + Deadlines pro Dreh, Dashboard-Zugang, Aufgaben (inkl. automatische Deadline-Aufgaben)
-- Nur ERGÄNZUNGEN: neue Spalten (leer bzw. false), neue Tabelle, neue Funktionen/Trigger.
-- Bestehende Daten werden nicht verändert (einzige Ausnahme: dashboard = true für Felix, Pia, Ana, Maurice – auf Felix' Wunsch).

-- ── 1) Dreh: Cutter + zwei Deadlines ──────────────────────────────────────
alter table public.proj_drehs
  add column if not exists cutter_id uuid references public.profiles(id) on delete set null,
  add column if not exists deadline_raw timestamptz,
  add column if not exists deadline_cutting timestamptz;

-- dreh_felder_setzen: die neuen Felder dürfen gesetzt werden (Rest unverändert)
create or replace function public.dreh_felder_setzen(p_tabelle text, p_id uuid, p_felder jsonb, p_erwartete_version bigint default null::bigint)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare erlaubt text[]; leer_null text[] := array['datum', 'kunde_id', 'zustaendig_id', 'darsteller_id', 'drehtag', 'cutter_id', 'deadline_raw', 'deadline_cutting'];
        k text; cols text := ''; r jsonb; cur_ver bigint; felder jsonb;
begin
  perform os_intern.tabelle_pruefen(p_tabelle);
  if p_felder is null or jsonb_typeof(p_felder) <> 'object' then raise exception 'Felder fehlen'; end if;
  erlaubt := case when p_tabelle = 'proj_drehs' then
      array['datum', 'kunde_id', 'kunde_name', 'status', 'zustaendig_id', 'darsteller_id', 'darsteller_name', 'nas_gesichert',
            'abnahme_bestaetigt', 'video_count', 'erlaeuterungen_cutter', 'requisiten', 'recruiting', 'dauer',
            'raw_gesichert', 'final_gesichert', 'erlaeuterungen_videograph',
            'cutter_id', 'deadline_raw', 'deadline_cutting']
    else array['titel', 'drehtag', 'status', 'zustaendig', 'video_planung', 'requisiten', 'drehort'] end;
  select coalesce(jsonb_object_agg(key, case when value = '""'::jsonb and key = any(leer_null) then 'null'::jsonb else value end), '{}'::jsonb)
    into felder from jsonb_each(p_felder);
  for k in select jsonb_object_keys(felder) loop
    if not k = any(erlaubt) then raise exception 'Feld % darf hier nicht gesetzt werden', k; end if;
    cols := cols || case when cols = '' then '' else ', ' end || format('%I = r.%I', k, k);
  end loop;
  execute format('select version from public.%I where id = $1 for update', p_tabelle) into cur_ver using p_id;
  if cur_ver is null then raise exception 'Datensatz nicht gefunden oder keine Berechtigung' using errcode = 'PV404'; end if;
  if p_erwartete_version is not null and cur_ver <> p_erwartete_version then
    raise exception 'Wurde gerade von jemand anderem geändert' using errcode = 'PV409';
  end if;
  if cols = '' then
    execute format('select to_jsonb(t.*) from public.%I t where t.id = $1', p_tabelle) into r using p_id;
    return r;
  end if;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2 returning to_jsonb(t.*)',
                 p_tabelle, cols, p_tabelle) into r using felder, p_id;
  if r is null then raise exception 'Keine Berechtigung zum Speichern' using errcode = 'PV403'; end if;
  return r;
end $function$;

-- ── 2) Dashboard-Zugang pro Person ───────────────────────────────────────
alter table public.profiles add column if not exists dashboard boolean not null default false;

-- Nur Admins dürfen den Dashboard-Zugang ändern (wie Rolle/Rechte)
create or replace function public.protect_profile_privileged()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare privilegiert boolean;
begin
  privilegiert :=
    coalesce(auth.role(), '') = 'service_role'
    or current_user in ('postgres', 'supabase_admin', 'service_role')
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
  if privilegiert then return NEW; end if;

  if TG_OP = 'INSERT' then
    raise exception 'Profile werden nur vom System bzw. von Admins angelegt';
  end if;

  if NEW.id is distinct from OLD.id
     or NEW.role is distinct from OLD.role
     or NEW.permissions is distinct from OLD.permissions
     or NEW.email is distinct from OLD.email
     or NEW.aktiv is distinct from OLD.aktiv
     or NEW.soll_stunden is distinct from OLD.soll_stunden
     or NEW.soll_modus is distinct from OLD.soll_modus
     or NEW.arbeitstage is distinct from OLD.arbeitstage
     or NEW.urlaub_anspruch_tage is distinct from OLD.urlaub_anspruch_tage
     or NEW.zeiterfassung is distinct from OLD.zeiterfassung
     or NEW.dashboard is distinct from OLD.dashboard then
    raise exception 'Keine Berechtigung, Rolle/Rechte/Vertragsdaten zu ändern';
  end if;
  return NEW;
end $function$;

update public.profiles set dashboard = true
 where full_name in ('Felix Brehl', 'Pia Pallgen', 'Ana Peck', 'Maurice Nacken') and dashboard = false;

-- ── 3) Aufgaben ──────────────────────────────────────────────────────────
create table if not exists public.os_aufgaben (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  beschreibung text,
  assignee_id uuid references public.profiles(id) on delete set null,
  faellig_am timestamptz,
  ganztags boolean not null default false,
  erledigt boolean not null default false,
  erledigt_am timestamptz,
  dreh_id uuid references public.proj_drehs(id) on delete cascade,
  quelle text not null default 'manuell' check (quelle in ('manuell', 'deadline_raw', 'deadline_cutting')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists os_aufgaben_auto_uniq on public.os_aufgaben (dreh_id, quelle) where quelle <> 'manuell';
create index if not exists os_aufgaben_assignee_idx on public.os_aufgaben (assignee_id, faellig_am);

alter table public.os_aufgaben enable row level security;
-- Admin: alles. Alle anderen: nur eigene Aufgaben lesen – und nur mit Dashboard-Zugang.
create policy os_aufgaben_admin on public.os_aufgaben for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy os_aufgaben_eigene_lesen on public.os_aufgaben for select to authenticated
  using (assignee_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.dashboard));
revoke all on public.os_aufgaben from anon;
grant select, insert, update, delete on public.os_aufgaben to authenticated;

-- Abhaken: Admin oder die zuständige Person selbst
create or replace function public.aufgabe_erledigt_setzen(p_id uuid, p_wert boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet' using errcode = 'PV401'; end if;
  update public.os_aufgaben
     set erledigt = p_wert, erledigt_am = case when p_wert then now() end, updated_at = now()
   where id = p_id
     and (public.app_role() = 'admin'
          or (assignee_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.dashboard)));
  if not found then raise exception 'Keine Berechtigung' using errcode = 'PV403'; end if;
end $function$;
revoke all on function public.aufgabe_erledigt_setzen(uuid, boolean) from public, anon;
grant execute on function public.aufgabe_erledigt_setzen(uuid, boolean) to authenticated;

-- ── 4) Deadlines → automatische Aufgaben ─────────────────────────────────
create or replace function os_intern.deadline_aufgabe(d public.proj_drehs, p_quelle text, p_faellig timestamptz, p_wer uuid, p_was text, p_fertig boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_titel text := p_was || ' – ' || coalesce(d.kunde_name, 'Dreh') || coalesce(' (Dreh ' || to_char(d.datum, 'DD.MM.') || ')', '');
begin
  if p_faellig is null then
    -- Deadline entfernt → automatische Aufgabe weg (nicht in den Papierkorb, sie entsteht neu, sobald wieder eine Deadline gesetzt wird)
    perform set_config('app.papierkorb_aus', '1', true);
    delete from public.os_aufgaben where dreh_id = d.id and quelle = p_quelle;
    perform set_config('app.papierkorb_aus', '', true);
    return;
  end if;
  insert into public.os_aufgaben (titel, assignee_id, faellig_am, dreh_id, quelle, erledigt, erledigt_am, created_by)
  values (v_titel, p_wer, p_faellig, d.id, p_quelle, p_fertig, case when p_fertig then now() end, null)
  on conflict (dreh_id, quelle) where quelle <> 'manuell' do update
     set titel = excluded.titel,
         assignee_id = excluded.assignee_id,
         faellig_am = excluded.faellig_am,
         erledigt = os_aufgaben.erledigt or excluded.erledigt,
         erledigt_am = case when os_aufgaben.erledigt or excluded.erledigt then coalesce(os_aufgaben.erledigt_am, now()) end,
         updated_at = now()
   where (os_aufgaben.titel, os_aufgaben.assignee_id, os_aufgaben.faellig_am, os_aufgaben.erledigt)
         is distinct from (excluded.titel, excluded.assignee_id, excluded.faellig_am, os_aufgaben.erledigt or excluded.erledigt);
end $function$;

create or replace function os_intern.deadline_aufgaben()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- RAW: Videograph, erledigt sobald „RAW gesichert“ angehakt ist
  perform os_intern.deadline_aufgabe(NEW, 'deadline_raw', NEW.deadline_raw, NEW.zustaendig_id,
                                     'RAW hochladen', coalesce(NEW.raw_gesichert, false));
  -- Cutting: Cutter, erledigt sobald der Dreh auf Posting/Abgeschlossen steht
  perform os_intern.deadline_aufgabe(NEW, 'deadline_cutting', NEW.deadline_cutting, NEW.cutter_id,
                                     'Videos fertig, an Kunden & Metricool', NEW.status in ('posting', 'abgeschlossen'));
  return null;
end $function$;

create trigger trg_z_deadline_aufgaben
  after insert or update of deadline_raw, deadline_cutting, zustaendig_id, cutter_id, raw_gesichert, status, kunde_name, datum
  on public.proj_drehs
  for each row execute function os_intern.deadline_aufgaben();

-- Realtime für Aufgaben (Dashboard aktualisiert sich live)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'os_aufgaben') then
    alter publication supabase_realtime add table public.os_aufgaben;
  end if;
end $$;

-- Chefbereich Teil 4: Erinnerungen pro ZEITRAUM (Monat / Quartal / Halbjahr / Jahr statt fester Tag),
-- echter Steuertarif (Einstellungen), Lexware-Zahlungsdatum (Geldeingang). Nur Ergänzungen + Felix' gewünschte Umstellung.

-- Sicherung vorher
create table if not exists os_backup.chef_erinnerungen_20261117 as select * from public.os_chef_erinnerungen;
create table if not exists os_backup.chef_aufgaben_20261117 as select * from public.os_aufgaben where erinnerung_id is not null;

-- ── Einstellungen: Steuer-Modus (tarif | baender), Hebesatz (Köln 475 %), Kirchensteuer %, Abzüge/Jahr ──
alter table public.os_finanz_einstellungen add column if not exists steuer jsonb not null
  default '{"modus":"tarif","hebesatz":475,"kirche":0,"abzuege":0}'::jsonb;

-- ── Lexware: Datum des Geldeingangs/-ausgangs ──
alter table public.os_finanz_belege add column if not exists bezahlt_am date;
create index if not exists os_finanz_belege_bezahlt_idx on public.os_finanz_belege (bezahlt_am);

-- ── Erinnerungen: Zeitraum-Logik ──
-- naechster_termin = Beginn des Zeitraums (immer der 1. eines Monats, außer wöchentlich)
create or replace function os_intern.erinnerung_monatsanfang()
 returns trigger language plpgsql as $f$
begin
  if NEW.rhythmus <> 'woechentlich' then NEW.naechster_termin := date_trunc('month', NEW.naechster_termin)::date; end if;
  return NEW;
end $f$;
create trigger trg_erinnerung_monatsanfang before insert or update of naechster_termin, rhythmus on public.os_chef_erinnerungen
  for each row execute function os_intern.erinnerung_monatsanfang();

-- Ende des Zeitraums
create or replace function os_intern.periode_ende(p_start date, p_rhythmus text)
 returns date language sql immutable as $f$ select os_intern.termin_weiter(p_start, p_rhythmus) - 1 $f$;

-- Lesbarer Name des Zeitraums („November 2026“, „Jan–Jun 2027“, „Q1 2027“ …)
create or replace function os_intern.periode_text(p_start date, p_rhythmus text)
 returns text language sql immutable as $f$
  with m(n) as (select array['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']),
       z(ende) as (select os_intern.periode_ende(p_start, p_rhythmus))
  select case
    when p_rhythmus = 'monatlich' then (array['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'])[extract(month from p_start)::int] || ' ' || extract(year from p_start)::int
    when p_rhythmus in ('quartalsweise', 'halbjaehrlich') then
      m.n[extract(month from p_start)::int]
      || case when extract(year from p_start) <> extract(year from z.ende) then ' ' || extract(year from p_start)::int else '' end
      || '–' || m.n[extract(month from z.ende)::int] || ' ' || extract(year from z.ende)::int
    when p_rhythmus = 'jaehrlich' then case when extract(month from p_start) = 1 then extract(year from p_start)::int::text
                                          else m.n[extract(month from p_start)::int] || ' ' || extract(year from p_start)::int || '–' || m.n[extract(month from z.ende)::int] || ' ' || extract(year from z.ende)::int end
    else 'Woche ab ' || to_char(p_start, 'DD.MM.') end
  from m, z
$f$;

-- Prüfen (beim Öffnen des Dashboards): verpasste Zeiträume überspringen, für den laufenden Zeitraum ab dem 1. eine Aufgabe anlegen
-- (fällig am letzten Tag des Zeitraums, Titel mit Zeitraum, z. B. „Firmenessen … – November 2026“)
create or replace function public.chef_erinnerungen_pruefen()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n integer := 0; heute date := (now() at time zone 'Europe/Berlin')::date;
begin
  if coalesce(public.app_role(), '') <> 'admin' then raise exception 'Keine Berechtigung' using errcode = 'PV403'; end if;
  perform os_intern.erinnerungen_aufgaben(auth.uid());
  get diagnostics n = row_count;
  return n;
end $function$;

create or replace function os_intern.erinnerungen_aufgaben(p_user uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare heute date := (now() at time zone 'Europe/Berlin')::date; e record;
begin
  for e in select * from public.os_chef_erinnerungen where aktiv loop
    -- Zeiträume, die komplett vorbei sind, überspringen (die alte Aufgabe bleibt offen im Dashboard stehen)
    while os_intern.periode_ende(e.naechster_termin, e.rhythmus) < heute loop
      e.naechster_termin := os_intern.termin_weiter(e.naechster_termin, e.rhythmus);
    end loop;
    update public.os_chef_erinnerungen set naechster_termin = e.naechster_termin, updated_at = now()
     where id = e.id and naechster_termin <> e.naechster_termin;
    if e.naechster_termin <= heute then
      insert into public.os_aufgaben (titel, beschreibung, assignee_id, faellig_am, ganztags, quelle, erinnerung_id, created_by)
      values (e.titel || ' – ' || os_intern.periode_text(e.naechster_termin, e.rhythmus), e.notiz, p_user,
              (os_intern.periode_ende(e.naechster_termin, e.rhythmus) + time '12:00') at time zone 'Europe/Berlin', true, 'manuell', e.id, p_user)
      on conflict (erinnerung_id, faellig_am) where erinnerung_id is not null do nothing;
    end if;
  end loop;
end $function$;
revoke all on function os_intern.erinnerungen_aufgaben(uuid) from public, anon, authenticated;

-- Abhaken einer Aufgabe → Erinnerung springt in den nächsten Zeitraum (wenn die Aufgabe zum laufenden Zeitraum gehört)
create or replace function os_intern.erinnerung_weiter()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare d date;
begin
  if NEW.erinnerung_id is not null and NEW.erledigt and not coalesce(OLD.erledigt, false) then
    d := (NEW.faellig_am at time zone 'Europe/Berlin')::date;
    update public.os_chef_erinnerungen e
       set naechster_termin = os_intern.termin_weiter(e.naechster_termin, e.rhythmus),
           zuletzt_erledigt = (now() at time zone 'Europe/Berlin')::date, updated_at = now()
     where e.id = NEW.erinnerung_id
       and d between e.naechster_termin and os_intern.periode_ende(e.naechster_termin, e.rhythmus);
  end if;
  return null;
end $function$;

-- „Erledigt“ im Chefbereich: Aufgabe des laufenden Zeitraums anlegen/finden und abhaken
create or replace function os_intern.erinnerung_abhaken(p_id uuid, p_user uuid)
 returns date language plpgsql security definer set search_path to 'public'
as $function$
declare e public.os_chef_erinnerungen%rowtype; f timestamptz; aid uuid;
begin
  select * into e from public.os_chef_erinnerungen where id = p_id;
  if not found then raise exception 'Erinnerung nicht gefunden'; end if;
  f := (os_intern.periode_ende(e.naechster_termin, e.rhythmus) + time '12:00') at time zone 'Europe/Berlin';
  insert into public.os_aufgaben (titel, beschreibung, assignee_id, faellig_am, ganztags, quelle, erinnerung_id, created_by)
  values (e.titel || ' – ' || os_intern.periode_text(e.naechster_termin, e.rhythmus), e.notiz, p_user, f, true, 'manuell', e.id, p_user)
  on conflict (erinnerung_id, faellig_am) where erinnerung_id is not null do nothing;
  select id into aid from public.os_aufgaben where erinnerung_id = e.id and faellig_am = f;
  update public.os_aufgaben set erledigt = true, erledigt_am = now(), updated_at = now() where id = aid and not erledigt;
  return (select naechster_termin from public.os_chef_erinnerungen where id = p_id);
end $function$;
revoke all on function os_intern.erinnerung_abhaken(uuid, uuid) from public, anon, authenticated;

create or replace function public.chef_erinnerung_erledigt(p_id uuid)
 returns date language plpgsql security definer set search_path to 'public'
as $function$
begin
  if coalesce(public.app_role(), '') <> 'admin' then raise exception 'Keine Berechtigung' using errcode = 'PV403'; end if;
  return os_intern.erinnerung_abhaken(p_id, auth.uid());
end $function$;

-- ── Bestehende Erinnerungen umstellen (Felix' Wunsch): Monatsanfang, kein Vorlauf ──
update public.os_chef_erinnerungen set naechster_termin = date_trunc('month', naechster_termin)::date, vorlauf_tage = 0, updated_at = now();
-- offene Aufgabe aus der alten Logik auf das Zeitraum-Ende + Zeitraum-Titel umstellen (statt doppelt anzulegen)
update public.os_aufgaben a
   set faellig_am = (os_intern.periode_ende(e.naechster_termin, e.rhythmus) + time '12:00') at time zone 'Europe/Berlin',
       titel = e.titel || ' – ' || os_intern.periode_text(e.naechster_termin, e.rhythmus), updated_at = now()
  from public.os_chef_erinnerungen e
 where a.erinnerung_id = e.id and not a.erledigt
   and (a.faellig_am at time zone 'Europe/Berlin')::date between e.naechster_termin and os_intern.periode_ende(e.naechster_termin, e.rhythmus);

-- ── Claude-Chat (os_finanz_api): Erledigt über dieselbe Logik, Termin auch als „YYYY-MM“ ──
do $mig$
declare d text; alt1 text; alt2 text;
begin
  d := pg_get_functiondef('public.os_finanz_api(text,text,jsonb)'::regprocedure);
  alt1 := $a$(a->>'naechster_termin')::date$a$;
  alt2 := substring(d from $r$(    select id into v_admin from profiles where role = 'admin' order by created_at limit 1;.*?'naechster_termin', \(select naechster_termin from os_chef_erinnerungen where id = e.id\)\);)$r$);
  if position(alt1 in d) = 0 or alt2 is null then raise exception 'os_finanz_api: Stelle nicht gefunden'; end if;
  d := replace(d, alt1, $a$(case when length(a->>'naechster_termin') = 7 then (a->>'naechster_termin') || '-01' else a->>'naechster_termin' end)::date$a$);
  d := replace(d, alt2, $a$    select id into v_admin from profiles where role = 'admin' order by created_at limit 1;
    perform os_intern.erinnerung_abhaken(e.id, v_admin);
    return jsonb_build_object('titel', e.titel, 'erledigt_fuer', os_intern.periode_text(e.naechster_termin, e.rhythmus),
      'naechster_zeitraum', (select os_intern.periode_text(naechster_termin, rhythmus) from os_chef_erinnerungen where id = e.id));$a$);
  d := replace(d, $a$'vorlauf_tage', vorlauf_tage, 'aktiv'$a$, $a$'zeitraum', os_intern.periode_text(naechster_termin, rhythmus), 'aktiv'$a$);
  execute d;
end $mig$;

-- Chefbereich Teil 1: wiederkehrende Erinnerungen (nur Admin)
-- Nur ERGÄNZUNGEN: neue Tabelle, neue Spalte os_aufgaben.erinnerung_id, neue Funktionen/Trigger.
-- Sichtbarkeit: Tabelle per RLS ausschließlich für Admin. Die daraus erzeugten Aufgaben gehören dem Admin
-- (assignee = Admin) – andere sehen in os_aufgaben ohnehin nur ihre eigenen Aufgaben.

create table if not exists public.os_chef_erinnerungen (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  notiz text,
  rhythmus text not null default 'monatlich'
    check (rhythmus in ('woechentlich', 'monatlich', 'quartalsweise', 'halbjaehrlich', 'jaehrlich')),
  naechster_termin date not null,
  vorlauf_tage integer not null default 7 check (vorlauf_tage between 0 and 90),
  aktiv boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.os_chef_erinnerungen enable row level security;
create policy chef_erinnerungen_nur_admin on public.os_chef_erinnerungen for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
revoke all on public.os_chef_erinnerungen from anon;
grant select, insert, update, delete on public.os_chef_erinnerungen to authenticated;

-- Gelöschte Erinnerungen landen im Papierkorb
create trigger trg_zz_papierkorb before delete on public.os_chef_erinnerungen
  for each row execute function os_intern.in_papierkorb();

alter table public.os_aufgaben add column if not exists erinnerung_id uuid references public.os_chef_erinnerungen(id) on delete set null;
create unique index if not exists os_aufgaben_erinnerung_uniq on public.os_aufgaben (erinnerung_id, faellig_am) where erinnerung_id is not null;

create or replace function os_intern.termin_weiter(p_datum date, p_rhythmus text)
 returns date language sql immutable
as $function$
  select (case p_rhythmus
    when 'woechentlich' then p_datum + 7
    when 'monatlich' then (p_datum + interval '1 month')::date
    when 'quartalsweise' then (p_datum + interval '3 months')::date
    when 'halbjaehrlich' then (p_datum + interval '6 months')::date
    else (p_datum + interval '1 year')::date end)
$function$;

-- Fällige Erinnerungen als Aufgabe für den Admin anlegen (wird beim Öffnen von Dashboard/Chefbereich aufgerufen)
create or replace function public.chef_erinnerungen_pruefen()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer := 0; heute date := (now() at time zone 'Europe/Berlin')::date;
begin
  if coalesce(public.app_role(), '') <> 'admin' then raise exception 'Keine Berechtigung' using errcode = 'PV403'; end if;
  insert into public.os_aufgaben (titel, beschreibung, assignee_id, faellig_am, ganztags, quelle, erinnerung_id, created_by)
  select e.titel, e.notiz, auth.uid(), (e.naechster_termin + time '12:00') at time zone 'Europe/Berlin', true, 'manuell', e.id, auth.uid()
    from public.os_chef_erinnerungen e
   where e.aktiv and e.naechster_termin - e.vorlauf_tage <= heute
  on conflict (erinnerung_id, faellig_am) where erinnerung_id is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.chef_erinnerungen_pruefen() from public, anon;
grant execute on function public.chef_erinnerungen_pruefen() to authenticated;

-- Aufgabe aus Erinnerung abgehakt → nächsten Termin weiterschalten (nur einmal pro Termin)
create or replace function os_intern.erinnerung_weiter()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if NEW.erinnerung_id is not null and NEW.erledigt and not coalesce(OLD.erledigt, false) then
    update public.os_chef_erinnerungen e
       set naechster_termin = os_intern.termin_weiter(e.naechster_termin, e.rhythmus), updated_at = now()
     where e.id = NEW.erinnerung_id
       and e.naechster_termin = (NEW.faellig_am at time zone 'Europe/Berlin')::date;
  end if;
  return null;
end $function$;

create trigger trg_erinnerung_weiter after update of erledigt on public.os_aufgaben
  for each row execute function os_intern.erinnerung_weiter();

-- Papierkorb darf Erinnerungen wiederherstellen
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.papierkorb_wiederherstellen(bigint)'::regprocedure);
  if position('''os_chef_erinnerungen''' in d) = 0 then
    d := replace(d, $a$'zeiteintraege', 'minijob_stunden', 'urlaubsantraege', 'spesen', 'os_aufgaben'];$a$,
                    $a$'zeiteintraege', 'minijob_stunden', 'urlaubsantraege', 'spesen', 'os_aufgaben', 'os_chef_erinnerungen'];$a$);
    if position('''os_chef_erinnerungen''' in d) = 0 then raise exception 'papierkorb_wiederherstellen: Ersetzung fehlgeschlagen'; end if;
    execute d;
  end if;
end $mig$;

-- Erste zwei Erinnerungen (Felix, 17.11.2026) – Termine im Chefbereich anpassbar
insert into public.os_chef_erinnerungen (titel, notiz, rhythmus, naechster_termin, vorlauf_tage)
select * from (values
  ('Firmenessen mit Pia, Ana & Maurice',
   'Einmal im Monat richtig schön essen gehen und Danke sagen – Mitarbeiterbindung. Termin abstimmen, Restaurant reservieren.',
   'monatlich', date '2026-11-27', 10),
  ('Hausparty fürs Team',
   'Jedes halbe Jahr eine kleine Hausparty – Termin früh ankündigen, Einladung rausschicken, Essen & Getränke planen.',
   'halbjaehrlich', date '2027-01-23', 30)
) v(titel, notiz, rhythmus, naechster_termin, vorlauf_tage)
where not exists (select 1 from public.os_chef_erinnerungen);

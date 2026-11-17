-- Chefbereich Teil 2: Finanzen (ersetzt Felix' Excel „Finanzen.numbers“), Lexware-Netto-Speicher, Erinnerungen abhaken,
-- Dreh-/Kundenzuordnung für Minijob-Stunden. Nur ERGÄNZUNGEN. Alle neuen Finanz-Tabellen: RLS ausschließlich Admin.

-- ── Minijob-Stunden: Dreh zuordnen (Kunde ergibt sich daraus) ─────────────
alter table public.minijob_stunden add column if not exists dreh_id uuid references public.proj_drehs(id) on delete set null;

-- ── Finanz-Posten (Einnahmen, Business-Ausgaben, Lohn, Privat, Invest) ─────
create table if not exists public.os_finanz_posten (
  id uuid primary key default gen_random_uuid(),
  bereich text not null check (bereich in ('einnahme', 'business', 'lohn', 'privat', 'invest')),
  name text not null,
  betrag numeric(12,2) not null default 0,          -- netto (Business/Einnahme) bzw. Betrag (Lohn/Privat/Invest)
  betrag_brutto numeric(12,2),                      -- nur Business-Ausgaben
  rhythmus text not null default 'monatlich' check (rhythmus in ('monatlich', 'jaehrlich')),
  konto text,
  kunde_id uuid references public.proj_kunden(id) on delete set null,
  notiz text,
  aktiv boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.os_finanz_posten enable row level security;
create policy finanz_posten_nur_admin on public.os_finanz_posten for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
revoke all on public.os_finanz_posten from anon;
grant select, insert, update, delete on public.os_finanz_posten to authenticated;
create trigger trg_zz_papierkorb before delete on public.os_finanz_posten for each row execute function os_intern.in_papierkorb();

-- ── Einstellungen (eine Zeile): Steuer-Bänder, Sicherheitsrücklage, Firmenwagen ──
create table if not exists public.os_finanz_einstellungen (
  id integer primary key default 1 check (id = 1),
  steuerbaender jsonb not null default '[{"bis":10000,"satz":0},{"bis":40000,"satz":25},{"bis":80000,"satz":33},{"bis":120000,"satz":38},{"bis":250000,"satz":46},{"bis":null,"satz":48}]'::jsonb,
  sicherheit_prozent numeric(5,2) not null default 10,
  firmenwagen jsonb not null default '{"aktiv":true,"name":"Hyundai Tucson N-Line","listenpreis":45260,"prozent":1}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.os_finanz_einstellungen enable row level security;
create policy finanz_einstellungen_nur_admin on public.os_finanz_einstellungen for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
revoke all on public.os_finanz_einstellungen from anon;
grant select, insert, update on public.os_finanz_einstellungen to authenticated;
insert into public.os_finanz_einstellungen (id) values (1) on conflict (id) do nothing;

-- ── Lexware-Belege mit Netto-Beträgen (Zwischenspeicher, wird von api/lexoffice.js gefüllt) ──
create table if not exists public.os_finanz_belege (
  id uuid primary key,
  art text not null check (art in ('einnahme', 'ausgabe')),
  typ text, status text, nummer text,
  datum date, faellig date,
  kontakt text, kontakt_id uuid,
  brutto numeric(12,2), netto numeric(12,2), steuer numeric(12,2), offen numeric(12,2),
  lx_updated timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists os_finanz_belege_datum_idx on public.os_finanz_belege (datum);
alter table public.os_finanz_belege enable row level security;
create policy finanz_belege_nur_admin on public.os_finanz_belege for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
revoke all on public.os_finanz_belege from anon;
grant select, insert, update on public.os_finanz_belege to authenticated;

-- ── Erinnerungen: direkt abhaken („diesen Monat erledigt“) + zuletzt erledigt ──
alter table public.os_chef_erinnerungen add column if not exists zuletzt_erledigt date;

create or replace function os_intern.erinnerung_weiter()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if NEW.erinnerung_id is not null and NEW.erledigt and not coalesce(OLD.erledigt, false) then
    update public.os_chef_erinnerungen e
       set naechster_termin = os_intern.termin_weiter(e.naechster_termin, e.rhythmus),
           zuletzt_erledigt = (now() at time zone 'Europe/Berlin')::date, updated_at = now()
     where e.id = NEW.erinnerung_id
       and e.naechster_termin = (NEW.faellig_am at time zone 'Europe/Berlin')::date;
  end if;
  return null;
end $function$;

create or replace function public.chef_erinnerung_erledigt(p_id uuid)
 returns date language plpgsql security definer set search_path to 'public'
as $function$
declare e public.os_chef_erinnerungen%rowtype; f timestamptz; aid uuid;
begin
  if coalesce(public.app_role(), '') <> 'admin' then raise exception 'Keine Berechtigung' using errcode = 'PV403'; end if;
  select * into e from public.os_chef_erinnerungen where id = p_id;
  if not found then raise exception 'Erinnerung nicht gefunden'; end if;
  f := (e.naechster_termin + time '12:00') at time zone 'Europe/Berlin';
  insert into public.os_aufgaben (titel, beschreibung, assignee_id, faellig_am, ganztags, quelle, erinnerung_id, created_by)
  values (e.titel, e.notiz, auth.uid(), f, true, 'manuell', e.id, auth.uid())
  on conflict (erinnerung_id, faellig_am) where erinnerung_id is not null do nothing;
  select id into aid from public.os_aufgaben where erinnerung_id = e.id and faellig_am = f;
  update public.os_aufgaben set erledigt = true, erledigt_am = now(), updated_at = now() where id = aid and not erledigt;
  return (select naechster_termin from public.os_chef_erinnerungen where id = p_id);
end $function$;
revoke all on function public.chef_erinnerung_erledigt(uuid) from public, anon;
grant execute on function public.chef_erinnerung_erledigt(uuid) to authenticated;

-- ── Papierkorb darf Finanz-Posten wiederherstellen ──
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.papierkorb_wiederherstellen(bigint)'::regprocedure);
  if position('''os_finanz_posten''' in d) = 0 then
    d := replace(d, $a$'os_aufgaben', 'os_chef_erinnerungen'];$a$, $a$'os_aufgaben', 'os_chef_erinnerungen', 'os_finanz_posten'];$a$);
    if position('''os_finanz_posten''' in d) = 0 then raise exception 'papierkorb_wiederherstellen: Ersetzung fehlgeschlagen'; end if;
    execute d;
  end if;
end $mig$;

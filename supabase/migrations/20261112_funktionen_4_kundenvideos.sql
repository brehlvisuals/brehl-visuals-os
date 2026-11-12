-- Funktionen Teil 4: Kundenvideos (Metricool-Übersicht)
-- Nur ERGÄNZUNGEN an proj_kunden: Metricool-Marke(n), Videos pro Monat (Ziel), Vorlauf für Freigabe-Warnung.
-- Bestehende Kundendaten bleiben unverändert. Die Metricool-Zuordnung wird für eindeutige Namen vorbelegt.

alter table public.proj_kunden
  add column if not exists metricool_brand_ids bigint[] not null default '{}',
  add column if not exists videos_pro_monat integer check (videos_pro_monat is null or videos_pro_monat between 0 and 200),
  add column if not exists freigabe_vorlauf_tage integer not null default 3 check (freigabe_vorlauf_tage between 0 and 30);

-- Ziel, Zuordnung und Vorlauf darf nur der Admin ändern (proj_kunden ist sonst für alle Angemeldeten beschreibbar)
create or replace function os_intern.kunden_ziel_schuetzen()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or coalesce(public.app_role(), '') = 'admin' then return NEW; end if;
  if TG_OP = 'UPDATE' and (NEW.metricool_brand_ids is distinct from OLD.metricool_brand_ids
       or NEW.videos_pro_monat is distinct from OLD.videos_pro_monat
       or NEW.freigabe_vorlauf_tage is distinct from OLD.freigabe_vorlauf_tage) then
    raise exception 'Nur Admins können Videoziel und Metricool-Zuordnung ändern' using errcode = 'PV403';
  end if;
  if TG_OP = 'INSERT' and (coalesce(array_length(NEW.metricool_brand_ids, 1), 0) > 0 or NEW.videos_pro_monat is not null) then
    raise exception 'Nur Admins können Videoziel und Metricool-Zuordnung setzen' using errcode = 'PV403';
  end if;
  return NEW;
end $function$;

create trigger trg_kunden_ziel_schuetzen before insert or update on public.proj_kunden
  for each row execute function os_intern.kunden_ziel_schuetzen();

-- Metricool-Marken vorbelegen (nur wo noch nichts eingetragen ist)
update public.proj_kunden k set metricool_brand_ids = v.ids
  from (values
    ('Auto Bierschneider', array[6313181]::bigint[]),
    ('Auto Thüllen',       array[5941043]::bigint[]),
    ('Autohaus Bataille',  array[5941086]::bigint[]),
    ('Autohaus Ellmann',   array[5940746]::bigint[]),
    ('Autohaus Westkamp',  array[5941073]::bigint[]),
    ('LIX-UP',             array[6094488]::bigint[]),
    ('Milz & Lindemann',   array[6926423]::bigint[]),
    ('SHI Gastro',         array[7839935]::bigint[]),
    ('TLS Bornheim',       array[8004777]::bigint[])
  ) as v(name, ids)
 where k.name = v.name and k.metricool_brand_ids = '{}';

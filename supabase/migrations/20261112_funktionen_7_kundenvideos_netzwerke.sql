-- Funktionen Teil 7: Kundenvideos – pro Kunde festlegen, welche Plattformen fürs Monatsziel zählen
-- Leer = alle Video-Plattformen (Instagram, TikTok, YouTube, Facebook); reine LinkedIn-Beiträge zählen nie.
-- Nur ERGÄNZUNG (neue Spalte) + Vorbelegung Bierschneider = nur TikTok (Felix-Vorgabe 12.11.2026).

alter table public.proj_kunden add column if not exists zaehl_netzwerke text[] not null default '{}';

create or replace function os_intern.kunden_ziel_schuetzen()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or coalesce(public.app_role(), '') = 'admin' then return NEW; end if;
  if TG_OP = 'UPDATE' and (NEW.metricool_brand_ids is distinct from OLD.metricool_brand_ids
       or NEW.videos_pro_monat is distinct from OLD.videos_pro_monat
       or NEW.freigabe_vorlauf_tage is distinct from OLD.freigabe_vorlauf_tage
       or NEW.zaehl_netzwerke is distinct from OLD.zaehl_netzwerke) then
    raise exception 'Nur Admins können Videoziel und Metricool-Zuordnung ändern' using errcode = 'PV403';
  end if;
  if TG_OP = 'INSERT' and (coalesce(array_length(NEW.metricool_brand_ids, 1), 0) > 0 or NEW.videos_pro_monat is not null
       or coalesce(array_length(NEW.zaehl_netzwerke, 1), 0) > 0) then
    raise exception 'Nur Admins können Videoziel und Metricool-Zuordnung setzen' using errcode = 'PV403';
  end if;
  return NEW;
end $function$;

update public.proj_kunden set zaehl_netzwerke = array['tiktok'] where name = 'Auto Bierschneider' and zaehl_netzwerke = '{}';

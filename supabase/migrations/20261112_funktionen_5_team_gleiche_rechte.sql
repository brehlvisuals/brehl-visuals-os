-- Funktionen Teil 5: Pia, Ana und Maurice (Videograph) sehen und können dasselbe.
-- Ausnahme: CRM-Kunden & Leads nur mit Berechtigung 'crm' (Team → Schalter „Kunden & Leads“, aktuell Ana + Felix).
-- Auf Felix' ausdrücklichen Wunsch (12.11.2026). Rechte-Änderung, aber KEINE Daten werden verändert
-- (einzige Ausnahme: Maurice bekommt die Berechtigung 'crm_darsteller' wie Pia/Ana).
-- Keine Policy wird gelöscht: Videograph-Sperren werden per ALTER POLICY aufgehoben (Name bleibt, Bedingung = true).
-- Darsteller (extern) bleiben unverändert eingeschränkt.

-- 1) „no_extern“-Sperren gelten nur noch für Darsteller (vorher auch für Videograph)
do $$
declare r record;
begin
  for r in select tablename from pg_policies
            where schemaname = 'public' and policyname = 'no_extern'
              and qual = '(COALESCE(app_role(), ''''::text) <> ALL (ARRAY[''extern''::text, ''videograph''::text]))' loop
    execute format('alter policy no_extern on public.%I using (coalesce(public.app_role(), '''') <> ''extern'') with check (coalesce(public.app_role(), '''') <> ''extern'')', r.tablename);
  end loop;
end $$;

-- 2) Drehs/Konzepte: Videograph darf auch Abgeschlossene sehen und löschen (Papierkorb fängt alles auf)
alter policy videograph_drehs on public.proj_drehs using (true) with check (true);
alter policy videograph_no_delete on public.proj_drehs using (true);
alter policy videograph_no_delete on public.proj_intern using (true);
alter policy write_only_staff_del on public.proj_drehs using (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph']));
alter policy write_only_staff_del on public.proj_intern using (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph']));

-- 3) Verlauf (Tab „Verlauf“ im Dreh) und Verfügbarkeiten auch für Videograph
alter policy sel on public.proj_verlauf using (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph']));
alter policy vfb_sel on public.verfuegbarkeiten using ((user_id = auth.uid()) or (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph'])));
alter policy vfb_ins on public.verfuegbarkeiten with check ((user_id = auth.uid()) or (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph'])));
alter policy vfb_upd on public.verfuegbarkeiten using ((user_id = auth.uid()) or (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph'])))
  with check ((user_id = auth.uid()) or (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph'])));
alter policy vfb_del on public.verfuegbarkeiten using ((user_id = auth.uid()) or (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph'])));

-- 4) Dateien: Darsteller-Dokumente + Dreh-Dateien auch für Videograph
alter policy darsteller_dok_staff on storage.objects
  using ((bucket_id = 'darsteller-dok') and (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph'])))
  with check ((bucket_id = 'darsteller-dok') and (public.app_role() = any (array['admin', 'mitarbeiter', 'videograph'])));
alter policy dreh_dateien_select on storage.objects
  using ((bucket_id = 'dreh-dateien') and ((public.app_role() = any (array['admin', 'mitarbeiter', 'videograph']))
         or (split_part(name, '/', 1) in (select proj_drehs.id::text from public.proj_drehs union select proj_intern.id::text from public.proj_intern))));

-- 5) Funktionen: Videograph wie Mitarbeiter
create or replace function public.dreh_loeschen(p_dreh_id uuid, p_codewort text)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare v_info text;
begin
  if coalesce(public.app_role(), '') not in ('admin', 'mitarbeiter', 'videograph') then
    raise exception 'Keine Berechtigung zum Löschen' using errcode = 'PV403';
  end if;
  if p_codewort is distinct from 'LOESCHEN' then
    raise exception 'Falsches Codewort. Zum Loeschen muss LOESCHEN eingegeben werden.';
  end if;
  select datum || ' / ' || coalesce(kunde_name, 'ohne Kunde') into v_info from public.proj_drehs where id = p_dreh_id;
  if v_info is null then raise exception 'Dreh % nicht gefunden', p_dreh_id; end if;
  perform set_config('app.loeschen_bestaetigt', 'LOESCHEN', true);
  delete from public.proj_drehs where id = p_dreh_id;
  perform set_config('app.loeschen_bestaetigt', '', true);
  return 'Geloescht: ' || v_info || ' - liegt im Papierkorb und ist wiederherstellbar.';
end;
$function$;

create or replace function public.dreh_wiederherstellen(p_dreh_id uuid)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_daten jsonb; v_neue_id uuid;
begin
  if coalesce(public.app_role(), '') not in ('admin', 'mitarbeiter', 'videograph') then
    raise exception 'Keine Berechtigung' using errcode = 'PV403';
  end if;
  select daten into v_daten from public.proj_drehs_papierkorb where dreh_id = p_dreh_id order by geloescht_am desc limit 1;
  if v_daten is null then raise exception 'Kein Eintrag im Papierkorb fuer Dreh %', p_dreh_id; end if;
  if exists (select 1 from public.proj_drehs where id = p_dreh_id) then raise exception 'Dreh % existiert bereits - nichts wiederhergestellt', p_dreh_id; end if;
  insert into public.proj_drehs select * from jsonb_populate_record(null::public.proj_drehs, v_daten) returning id into v_neue_id;
  return v_neue_id;
end;
$function$;

create or replace function public.video_erledigt_setzen(p_tabelle text, p_id uuid, p_video_id uuid, p_wert boolean)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare rolle text := public.app_role(); st text; kid uuid; ok boolean; v jsonb; pos int; r jsonb;
begin
  perform os_intern.tabelle_pruefen(p_tabelle);
  if auth.uid() is null or rolle is null then raise exception 'Nicht angemeldet' using errcode = 'PV401'; end if;
  if p_tabelle = 'proj_drehs' then
    select status, kunde_id, coalesce(videos, '[]'::jsonb) into st, kid, v from public.proj_drehs where id = p_id for update;
    if not found then raise exception 'Datensatz nicht gefunden' using errcode = 'PV404'; end if;
    ok := rolle in ('admin', 'mitarbeiter', 'videograph')
       or (rolle = 'extern' and st = 'dreh' and kid in (select ek.kunde_id from public.extern_kunden ek where ek.user_id = auth.uid()));
  else
    select coalesce(videos, '[]'::jsonb) into v from public.proj_intern where id = p_id for update;
    if not found then raise exception 'Datensatz nicht gefunden' using errcode = 'PV404'; end if;
    ok := rolle in ('admin', 'mitarbeiter', 'videograph');
  end if;
  if not ok then raise exception 'Keine Berechtigung' using errcode = 'PV403'; end if;
  pos := os_intern.video_pos(v, p_video_id);
  if pos is null then raise exception 'Dieses Video gibt es nicht mehr' using errcode = 'PV410'; end if;
  v := jsonb_set(v, array[pos::text, 'erledigt'], to_jsonb(coalesce(p_wert, false)));
  execute format('update public.%I t set videos = $1 where t.id = $2 returning to_jsonb(t.*)', p_tabelle) into r using v, p_id;
  return r;
end $function$;

-- 6) Maurice: Darsteller-CRM wie Pia/Ana (Kunden & Leads weiterhin nur mit 'crm')
update public.profiles set permissions = array_append(coalesce(permissions, '{}'), 'crm_darsteller')
 where role = 'videograph' and full_name = 'Maurice Nacken' and not ('crm_darsteller' = any(coalesce(permissions, '{}')));

-- Mehrbenutzer-Sync, Teil 1: Felder ergänzen, Video-IDs, atomare RPCs, Verlauf, Version.
-- Grundsatz: Es werden nur Felder ERGÄNZT (videos[].id, version, updated_at, os_upload_tickets.video_id).
-- Keine bestehenden Texte, Dateien, Videos, Reihenfolgen oder Status werden verändert.

-- ---------------------------------------------------------------------------
-- 1) Neue Spalten
-- ---------------------------------------------------------------------------
alter table public.proj_drehs  add column if not exists version bigint not null default 1,
                               add column if not exists updated_at timestamptz not null default now();
alter table public.proj_intern add column if not exists version bigint not null default 1,
                               add column if not exists updated_at timestamptz not null default now();
alter table public.os_upload_tickets add column if not exists video_id uuid;

-- ---------------------------------------------------------------------------
-- 2) Interne Hilfsfunktionen (eigenes Schema, nicht über die API aufrufbar)
-- ---------------------------------------------------------------------------
create schema if not exists os_intern;
revoke all on schema os_intern from public;
grant usage on schema os_intern to authenticated;

create or replace function os_intern.tabelle_pruefen(p text) returns void
language plpgsql immutable as $$
begin
  if p is null or p not in ('proj_drehs', 'proj_intern') then raise exception 'Ungültige Tabelle %', p; end if;
end $$;

-- Jedes Video-Objekt bekommt eine feste id (uuid), falls es noch keine (gültige, eindeutige) hat.
-- Alle anderen Inhalte bleiben unverändert.
create or replace function os_intern.videos_mit_ids(p jsonb) returns jsonb
language plpgsql volatile as $$
declare res jsonb := '[]'::jsonb; e jsonb; vid text; gesehen text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' then return p; end if;
  for e in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(e) = 'object' then
      vid := e->>'id';
      if vid is null or vid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or vid = any(gesehen) then
        vid := gen_random_uuid()::text;
        e := e || jsonb_build_object('id', vid);
      end if;
      gesehen := gesehen || vid;
    end if;
    res := res || jsonb_build_array(e);
  end loop;
  return res;
end $$;

-- Position (0-basiert) eines Videos im Array anhand seiner id
create or replace function os_intern.video_pos(p_videos jsonb, p_video_id uuid) returns int
language sql immutable as $$
  select (n - 1)::int from jsonb_array_elements(coalesce(p_videos, '[]'::jsonb)) with ordinality t(e, n)
  where e->>'id' = p_video_id::text limit 1
$$;

-- Anzeige-Reihenfolge wie in der App: offene Videos zuerst, erledigte unten (jeweils stabil)
create or replace function os_intern.anzeige(p_videos jsonb)
returns table(nr int, pos int, e jsonb) language sql immutable as $$
  select (row_number() over (order by coalesce((t.e->>'erledigt')::boolean, false), t.n))::int, (t.n - 1)::int, t.e
  from jsonb_array_elements(coalesce(p_videos, '[]'::jsonb)) with ordinality t(e, n)
$$;

-- Struktur der Videos (Reihenfolge der ids + Dateien) – Änderungen daran werden im Verlauf immer einzeln gesichert
create or replace function os_intern.struktur(p_videos jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_array(t.e->>'id', t.e->'dateien') order by t.n), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_videos) = 'array' then p_videos else '[]'::jsonb end) with ordinality t(e, n)
$$;

-- Zeile sperren (Row-Lock) und Videos lesen – läuft mit den Rechten des Aufrufers (RLS greift)
create or replace function os_intern.sperren(p_tabelle text, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v jsonb; gefunden boolean;
begin
  perform os_intern.tabelle_pruefen(p_tabelle);
  execute format('select true, coalesce(videos, ''[]''::jsonb) from public.%I where id = $1 for update', p_tabelle)
    into gefunden, v using p_id;
  if gefunden is null then raise exception 'Datensatz nicht gefunden oder keine Berechtigung' using errcode = 'PV404'; end if;
  return v;
end $$;

-- Videos schreiben (nur aus den RPCs heraus erlaubt) und die neue Zeile zurückgeben
create or replace function os_intern.schreiben(p_tabelle text, p_id uuid, p_videos jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare r jsonb;
begin
  perform set_config('app.videos_rpc', '1', true);
  execute format('update public.%I t set videos = $1 where t.id = $2 returning to_jsonb(t.*)', p_tabelle) into r using p_videos, p_id;
  perform set_config('app.videos_rpc', '', true);
  if r is null then raise exception 'Keine Berechtigung zum Speichern' using errcode = 'PV403'; end if;
  return r;
end $$;

revoke all on all functions in schema os_intern from public;
grant execute on all functions in schema os_intern to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Trigger: ids sicherstellen, version/updated_at pflegen,
--    und Ganz-Array-Schreiben der Videos aus dem Browser sperren (nur noch über RPCs)
-- ---------------------------------------------------------------------------
create or replace function os_intern.vor_schreiben() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    NEW.videos := os_intern.videos_mit_ids(NEW.videos);
    NEW.version := 1;
    NEW.updated_at := now();
    return NEW;
  end if;
  if NEW.videos is distinct from OLD.videos then
    if current_user in ('authenticated', 'anon') and coalesce(current_setting('app.videos_rpc', true), '') <> '1' then
      raise exception 'Videos werden jetzt feldgenau gespeichert – bitte die App neu laden.' using errcode = 'PV426';
    end if;
    NEW.videos := os_intern.videos_mit_ids(NEW.videos);
  end if;
  if (to_jsonb(NEW) - 'version' - 'updated_at') is distinct from (to_jsonb(OLD) - 'version' - 'updated_at') then
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  else
    NEW.version := OLD.version;
    NEW.updated_at := OLD.updated_at;
  end if;
  return NEW;
end $$;
grant execute on function os_intern.vor_schreiben() to authenticated;

drop trigger if exists trg_a_vor_schreiben on public.proj_drehs;
create trigger trg_a_vor_schreiben before insert or update on public.proj_drehs
  for each row execute function os_intern.vor_schreiben();
drop trigger if exists trg_a_vor_schreiben on public.proj_intern;
create trigger trg_a_vor_schreiben before insert or update on public.proj_intern
  for each row execute function os_intern.vor_schreiben();

-- ---------------------------------------------------------------------------
-- 4) Verlauf: Struktur-Änderungen immer sichern, Tipp-Serien derselben Person (<2 Min.) zusammenfassen,
--    Aufbewahrung von 60 auf 200 Stände pro Datensatz erhöht.
-- ---------------------------------------------------------------------------
create or replace function public.log_proj_change() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_by uuid; v_at timestamptz;
begin
  if (to_jsonb(OLD) - 'version' - 'updated_at') is distinct from (to_jsonb(NEW) - 'version' - 'updated_at') then
    if os_intern.struktur(OLD.videos) is not distinct from os_intern.struktur(NEW.videos) then
      select changed_by, changed_at into v_by, v_at from public.proj_verlauf
        where tabelle = TG_TABLE_NAME and ref_id = OLD.id and aktion = 'update' order by id desc limit 1;
      if v_at is not null and v_by is not distinct from auth.uid() and v_at > now() - interval '2 minutes' then
        return NEW;   -- gleiche Person tippt weiter: der Stand davor ist bereits gesichert
      end if;
    end if;
    insert into public.proj_verlauf(tabelle, ref_id, videos, snapshot, changed_by)
      values (TG_TABLE_NAME, OLD.id, OLD.videos, to_jsonb(OLD), auth.uid());
    -- Historie pro Datensatz auf die letzten 200 Stände begrenzen (vorher 60)
    delete from public.proj_verlauf pv
      where pv.tabelle = TG_TABLE_NAME and pv.ref_id = OLD.id and pv.aktion = 'update'
        and pv.id < (select min(id) from (select id from public.proj_verlauf
                       where tabelle = TG_TABLE_NAME and ref_id = OLD.id and aktion = 'update' order by id desc limit 200) t);
  end if;
  return NEW;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Atomare RPCs für den Client (SECURITY INVOKER → RLS greift, Row-Lock per FOR UPDATE)
--    Alle geben die neue Zeile (to_jsonb) zurück, damit der Client sofort den Serverstand hat.
-- ---------------------------------------------------------------------------
create or replace function public.video_feld_setzen(p_tabelle text, p_id uuid, p_video_id uuid, p_feld text, p_wert jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v jsonb; pos int;
begin
  if p_feld not in ('titel', 'planung', 'datei_url', 'datei_name') then raise exception 'Feld % ist nicht erlaubt', p_feld; end if;
  v := os_intern.sperren(p_tabelle, p_id);
  pos := os_intern.video_pos(v, p_video_id);
  if pos is null then raise exception 'Dieses Video gibt es nicht mehr' using errcode = 'PV410'; end if;
  v := jsonb_set(v, array[pos::text, p_feld], coalesce(p_wert, 'null'::jsonb));
  return os_intern.schreiben(p_tabelle, p_id, v);
end $$;

create or replace function public.video_hinzufuegen(p_tabelle text, p_id uuid, p_video jsonb default '{}'::jsonb, p_position int default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v jsonb; neu jsonb; n int;
begin
  v := os_intern.sperren(p_tabelle, p_id);
  neu := jsonb_build_object('titel', '', 'planung', '', 'datei_url', '', 'datei_name', '', 'dateien', '[]'::jsonb)
         || coalesce(p_video, '{}'::jsonb);
  if not (neu ? 'id') or os_intern.video_pos(v, (neu->>'id')::uuid) is not null then
    neu := neu || jsonb_build_object('id', gen_random_uuid());
  end if;
  n := jsonb_array_length(v);
  if p_position is null or p_position >= n or p_position < 0 then
    v := v || jsonb_build_array(neu);
  else
    v := jsonb_insert(v, array[p_position::text], neu);
  end if;
  return os_intern.schreiben(p_tabelle, p_id, v);
end $$;

create or replace function public.video_entfernen(p_tabelle text, p_id uuid, p_video_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v jsonb; pos int;
begin
  v := os_intern.sperren(p_tabelle, p_id);
  pos := os_intern.video_pos(v, p_video_id);
  if pos is null then
    return os_intern.schreiben(p_tabelle, p_id, v);   -- schon weg: nichts zu tun, aktuellen Stand zurückgeben
  end if;
  return os_intern.schreiben(p_tabelle, p_id, v - pos);
end $$;

-- Neue Reihenfolge: zuerst die übergebenen ids (soweit noch vorhanden), dann alle übrigen in bisheriger Reihenfolge
create or replace function public.videos_sortieren(p_tabelle text, p_id uuid, p_video_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v jsonb; neu jsonb;
begin
  v := os_intern.sperren(p_tabelle, p_id);
  select coalesce(jsonb_agg(e order by sortier, n), '[]'::jsonb) into neu from (
    select t.e, t.n, coalesce(array_position(p_video_ids, (t.e->>'id')::uuid), 1000000 + t.n::int) sortier
    from jsonb_array_elements(v) with ordinality t(e, n)) s;
  return os_intern.schreiben(p_tabelle, p_id, neu);
end $$;

create or replace function public.datei_anhaengen(p_tabelle text, p_id uuid, p_video_id uuid, p_datei jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v jsonb; pos int; arr jsonb;
begin
  if p_datei is null or jsonb_typeof(p_datei) <> 'object' then raise exception 'Datei fehlt'; end if;
  v := os_intern.sperren(p_tabelle, p_id);
  pos := os_intern.video_pos(v, p_video_id);
  if pos is null then raise exception 'Dieses Video gibt es nicht mehr' using errcode = 'PV410'; end if;
  arr := case when jsonb_typeof(v->pos->'dateien') = 'array' then v->pos->'dateien' else '[]'::jsonb end;
  if p_datei ? 'path' and exists (select 1 from jsonb_array_elements(arr) f where f->>'path' = p_datei->>'path') then
    return os_intern.schreiben(p_tabelle, p_id, v);   -- schon angehängt
  end if;
  v := jsonb_set(v, array[pos::text, 'dateien'], arr || jsonb_build_array(p_datei));
  return os_intern.schreiben(p_tabelle, p_id, v);
end $$;

create or replace function public.datei_entfernen(p_tabelle text, p_id uuid, p_video_id uuid, p_path text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v jsonb; pos int; arr jsonb;
begin
  v := os_intern.sperren(p_tabelle, p_id);
  pos := os_intern.video_pos(v, p_video_id);
  if pos is null then return os_intern.schreiben(p_tabelle, p_id, v); end if;
  arr := case when jsonb_typeof(v->pos->'dateien') = 'array' then v->pos->'dateien' else '[]'::jsonb end;
  select coalesce(jsonb_agg(f order by n), '[]'::jsonb) into arr
    from jsonb_array_elements(arr) with ordinality t(f, n) where f->>'path' is distinct from p_path;
  v := jsonb_set(v, array[pos::text, 'dateien'], arr);
  return os_intern.schreiben(p_tabelle, p_id, v);
end $$;

-- Top-Level-Felder setzen (mehrere auf einmal). Optional mit erwarteter Version (Optimistic Locking).
create or replace function public.dreh_felder_setzen(p_tabelle text, p_id uuid, p_felder jsonb, p_erwartete_version bigint default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare erlaubt text[]; leer_null text[] := array['datum', 'kunde_id', 'zustaendig_id', 'darsteller_id', 'drehtag'];
        k text; cols text := ''; r jsonb; cur_ver bigint; felder jsonb;
begin
  perform os_intern.tabelle_pruefen(p_tabelle);
  if p_felder is null or jsonb_typeof(p_felder) <> 'object' then raise exception 'Felder fehlen'; end if;
  erlaubt := case when p_tabelle = 'proj_drehs' then
      array['datum', 'kunde_id', 'kunde_name', 'status', 'zustaendig_id', 'darsteller_id', 'darsteller_name', 'nas_gesichert',
            'abnahme_bestaetigt', 'video_count', 'erlaeuterungen_cutter', 'requisiten', 'recruiting', 'dauer',
            'raw_gesichert', 'final_gesichert', 'erlaeuterungen_videograph']
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
end $$;

create or replace function public.dreh_feld_setzen(p_tabelle text, p_id uuid, p_feld text, p_wert jsonb)
returns jsonb language sql security invoker set search_path = public as $$
  select public.dreh_felder_setzen(p_tabelle, p_id, jsonb_build_object(p_feld, p_wert), null)
$$;

-- Ganze Video-Liste ersetzen (z. B. "Videos wiederherstellen" aus dem Verlauf) – NUR mit passender Version.
-- Videos ohne id übernehmen die id eines aktuellen Videos mit gleichem Titel (sonst neue id).
create or replace function public.videos_ersetzen(p_tabelle text, p_id uuid, p_videos jsonb, p_erwartete_version bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v jsonb; cur_ver bigint; res jsonb := '[]'::jsonb; e jsonb; vergeben text[] := '{}'; kandidat text;
begin
  if p_videos is null or jsonb_typeof(p_videos) <> 'array' then raise exception 'Videos fehlen'; end if;
  v := os_intern.sperren(p_tabelle, p_id);
  execute format('select version from public.%I where id = $1', p_tabelle) into cur_ver using p_id;
  if p_erwartete_version is null or cur_ver <> p_erwartete_version then
    raise exception 'Wurde gerade von jemand anderem geändert' using errcode = 'PV409';
  end if;
  for e in select value from jsonb_array_elements(p_videos) loop
    if jsonb_typeof(e) = 'object' and not (e ? 'id') then
      select x->>'id' into kandidat from jsonb_array_elements(v) x
        where coalesce(x->>'titel', '') = coalesce(e->>'titel', '') and x->>'id' is not null and not (x->>'id' = any(vergeben)) limit 1;
      if kandidat is not null then e := e || jsonb_build_object('id', kandidat); end if;
    end if;
    if jsonb_typeof(e) = 'object' and e ? 'id' then vergeben := vergeben || (e->>'id'); end if;
    res := res || jsonb_build_array(e);
  end loop;
  return os_intern.schreiben(p_tabelle, p_id, res);
end $$;

-- Erledigt-Haken: Darsteller dürfen die Tabelle sonst nicht ändern → SECURITY DEFINER mit eigener Rechteprüfung
create or replace function public.video_erledigt_setzen(p_tabelle text, p_id uuid, p_video_id uuid, p_wert boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rolle text := public.app_role(); st text; kid uuid; ok boolean; v jsonb; pos int; r jsonb;
begin
  perform os_intern.tabelle_pruefen(p_tabelle);
  if auth.uid() is null or rolle is null then raise exception 'Nicht angemeldet' using errcode = 'PV401'; end if;
  if p_tabelle = 'proj_drehs' then
    select status, kunde_id, coalesce(videos, '[]'::jsonb) into st, kid, v from public.proj_drehs where id = p_id for update;
    if not found then raise exception 'Datensatz nicht gefunden' using errcode = 'PV404'; end if;
    ok := rolle in ('admin', 'mitarbeiter')
       or (rolle = 'videograph' and st is distinct from 'abgeschlossen')
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
end $$;

-- Alte Abhak-Funktion (per Position): nur noch Hinweis zum Neuladen, nie mehr per Position schreiben
create or replace function public.toggle_video_done(p_table text, p_id uuid, p_index integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  raise exception 'Die App wurde aktualisiert – bitte einmal neu laden.' using errcode = 'PV426';
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'video_feld_setzen(text,uuid,uuid,text,jsonb)', 'video_hinzufuegen(text,uuid,jsonb,integer)', 'video_entfernen(text,uuid,uuid)',
    'videos_sortieren(text,uuid,uuid[])', 'datei_anhaengen(text,uuid,uuid,jsonb)', 'datei_entfernen(text,uuid,uuid,text)',
    'dreh_felder_setzen(text,uuid,jsonb,bigint)', 'dreh_feld_setzen(text,uuid,text,jsonb)', 'videos_ersetzen(text,uuid,jsonb,bigint)',
    'video_erledigt_setzen(text,uuid,uuid,boolean)', 'toggle_video_done(text,uuid,integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

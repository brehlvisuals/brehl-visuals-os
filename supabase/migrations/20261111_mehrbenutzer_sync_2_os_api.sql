-- Mehrbenutzer-Sync, Teil 2: Claude-Connector (os_api) und Upload-Tickets auf feste Video-IDs.
-- Nach außen: video_nr = Nummer wie in der App (offene zuerst, erledigte unten).
-- Geschrieben wird immer über die video_id. Kommt nur video_nr, muss video_titel passen.

-- Video aus den Argumenten bestimmen → Position im Array (0-basiert)
create or replace function os_intern.video_aufloesen(p_videos jsonb, a jsonb) returns int
language plpgsql stable as $$
declare pos int; v_nr int; titel_ist text;
begin
  if nullif(a->>'video_id', '') is not null then
    pos := os_intern.video_pos(p_videos, (a->>'video_id')::uuid);
    if pos is null then raise exception 'Das Video mit dieser video_id gibt es in diesem Dreh nicht (mehr). Bitte dreh_lesen erneut aufrufen.'; end if;
    return pos;
  end if;
  if nullif(a->>'video_nr', '') is null then raise exception 'video_id oder video_nr fehlt'; end if;
  v_nr := (a->>'video_nr')::int;
  select x.pos, x.e->>'titel' into pos, titel_ist from os_intern.anzeige(p_videos) x where x.nr = v_nr;
  if pos is null then raise exception 'Video Nr. % gibt es nicht (Dreh hat % Videos)', v_nr, jsonb_array_length(coalesce(p_videos, '[]'::jsonb)); end if;
  if not (a ? 'video_titel') then
    raise exception 'Bitte video_id (aus dreh_lesen) angeben – oder zusätzlich video_titel, damit nicht versehentlich das falsche Video bearbeitet wird. Video Nr. % heißt aktuell „%“ (video_id %).',
      v_nr, coalesce(titel_ist, ''), p_videos->pos->>'id';
  end if;
  if lower(regexp_replace(trim(coalesce(a->>'video_titel', '')), '\s+', ' ', 'g'))
     <> lower(regexp_replace(trim(coalesce(titel_ist, '')), '\s+', ' ', 'g')) then
    raise exception 'Video Nr. % heißt inzwischen „%“ (video_id %), nicht „%“. Die Reihenfolge hat sich geändert – bitte mit video_id arbeiten.',
      v_nr, coalesce(titel_ist, ''), p_videos->pos->>'id', a->>'video_titel';
  end if;
  return pos;
end $$;

-- App-Nummer eines Videos (Position → Anzeige-Nr.)
create or replace function os_intern.anzeige_nr(p_videos jsonb, p_pos int) returns int
language sql immutable as $$ select nr from os_intern.anzeige(p_videos) where pos = p_pos $$;

-- Datei an ein Video hängen (definer-Kontext), Video per id, alte Tickets per Position als Rückfall
create or replace function os_intern.datei_an_video(p_dreh uuid, p_video_id uuid, p_idx int, p_datei jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; pos int; arr jsonb;
begin
  select coalesce(videos, '[]'::jsonb) into v from public.proj_drehs where id = p_dreh for update;
  if not found then raise exception 'Dreh existiert nicht mehr'; end if;
  if p_video_id is not null then
    pos := os_intern.video_pos(v, p_video_id);
  elsif p_idx is not null and p_idx >= 0 and p_idx < jsonb_array_length(v) then
    pos := p_idx;
  end if;
  if pos is null then raise exception 'Das Video existiert nicht mehr'; end if;
  arr := case when jsonb_typeof(v->pos->'dateien') = 'array' then v->pos->'dateien' else '[]'::jsonb end;
  if not exists (select 1 from jsonb_array_elements(arr) f where f->>'path' = p_datei->>'path') then
    update public.proj_drehs set videos = jsonb_set(videos, array[pos::text, 'dateien'], arr || jsonb_build_array(p_datei)) where id = p_dreh;
  end if;
  return jsonb_build_object('pos', pos, 'video_id', v->pos->>'id', 'titel', v->pos->>'titel', 'video_nr', os_intern.anzeige_nr(v, pos));
end $$;
revoke all on function os_intern.datei_an_video(uuid, uuid, int, jsonb) from public, authenticated;

create or replace function public.os_ticket_abschliessen(p_path text, p_url text, p_name text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare t os_upload_tickets%rowtype; v_name text; r jsonb;
begin
  update os_upload_tickets set used = true where path = p_path and not used and expires_at > now() returning * into t;
  if t.path is null then raise exception 'Upload-Link ungültig, abgelaufen oder schon benutzt'; end if;
  v_name := coalesce(nullif(trim(p_name), ''), t.dateiname);
  r := os_intern.datei_an_video(t.dreh_id, t.video_id, case when t.video_id is null then t.video_idx end,
         jsonb_build_object('url', p_url, 'name', v_name, 'path', t.path));
  return jsonb_build_object('ok', true, 'dreh_id', t.dreh_id, 'video_nr', r->'video_nr', 'video_id', r->'video_id', 'datei', v_name);
end $$;

create or replace function public.os_ticket_info(p_path text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('kunde', coalesce(k.name, d.kunde_name), 'datum', d.datum,
           'video_nr', os_intern.anzeige_nr(d.videos, p.pos), 'titel', d.videos -> p.pos ->> 'titel', 'dateiname', t.dateiname)
  from os_upload_tickets t join proj_drehs d on d.id = t.dreh_id left join proj_kunden k on k.id = d.kunde_id
  cross join lateral (select coalesce(os_intern.video_pos(d.videos, t.video_id), case when t.video_id is null then t.video_idx end) pos) p
  where t.path = p_path and not t.used and t.expires_at > now()
$$;

create or replace function public.os_sammel_info(p_gruppe text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select case when count(*) = 0 then null else jsonb_build_object('kunde', min(coalesce(k.name, d.kunde_name)), 'datum', min(d.datum),
    'dateien', jsonb_agg(jsonb_build_object('t', t.path, 'video_nr', os_intern.anzeige_nr(d.videos, p.pos), 'titel', d.videos -> p.pos ->> 'titel',
      'dateiname', t.dateiname, 'original', t.original, 'offen', not t.used and t.expires_at > now() and p.pos is not null)
      order by os_intern.anzeige_nr(d.videos, p.pos), t.path)) end
  from os_upload_tickets t join proj_drehs d on d.id = t.dreh_id left join proj_kunden k on k.id = d.kunde_id
  cross join lateral (select coalesce(os_intern.video_pos(d.videos, t.video_id), case when t.video_id is null then t.video_idx end) pos) p
  where p_gruppe is not null and length(p_gruppe) >= 32 and t.gruppe = p_gruppe
$$;

create or replace function public.os_api(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_id uuid;
  d public.proj_drehs%rowtype;
  v_pos int;
  v_len int;
  v_video jsonb;
  v_modus text;
  v_feld text;
  v_neu text;
  v_path text;
  v_kunde uuid;
  v_kname text;
  v_vid uuid;
  v_videos jsonb;
begin
  if p_token is null or not exists (select 1 from os_api_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    raise exception 'Ungültiger Zugangsschlüssel';
  end if;
  update os_api_tokens set last_used_at = now() where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  if p_action not in ('kunden_auflisten', 'drehs_auflisten', 'dreh_anlegen') then
    v_id := nullif(a->>'dreh_id', '')::uuid;
    select * into d from proj_drehs where id = v_id for update;
    if not found then raise exception 'Dreh % nicht gefunden', a->>'dreh_id'; end if;
    d.videos := coalesce(d.videos, '[]'::jsonb);
    v_len := jsonb_array_length(d.videos);
  end if;

  case p_action
  when 'kunden_auflisten' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from proj_kunden);

  when 'drehs_auflisten' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'dreh_id', x.id, 'datum', x.datum, 'kunde', coalesce(k.name, x.kunde_name), 'status', x.status,
        'darsteller', x.darsteller_name, 'anzahl_videos', coalesce(jsonb_array_length(x.videos), 0),
        'video_titel', (select jsonb_agg(coalesce(z.e->>'titel', '') order by z.nr) from os_intern.anzeige(x.videos) z)
      ) order by x.datum nulls last), '[]')
      from proj_drehs x left join proj_kunden k on k.id = x.kunde_id
      where (a->>'ab_datum' is null or x.datum >= (a->>'ab_datum')::date)
        and (a->>'bis_datum' is null or x.datum <= (a->>'bis_datum')::date)
        and (a->>'status' is null or x.status = a->>'status')
        and (a->>'kunde' is null or coalesce(k.name, x.kunde_name) ilike '%' || (a->>'kunde') || '%')
        and (coalesce((a->>'abgeschlossene_zeigen')::boolean, false) or x.status <> 'abgeschlossen'));

  when 'dreh_lesen' then
    return jsonb_build_object(
      'dreh_id', d.id, 'datum', d.datum, 'status', d.status,
      'kunde', coalesce((select name from proj_kunden where id = d.kunde_id), d.kunde_name),
      'darsteller', d.darsteller_name, 'dauer', d.dauer,
      'erlaeuterungen_cutter', d.erlaeuterungen_cutter, 'erlaeuterungen_videograph', d.erlaeuterungen_videograph,
      'requisiten', d.requisiten, 'recruiting', d.recruiting,
      'hinweis', 'video_nr = Nummer wie in der App (erledigte Videos stehen unten). Zum Bearbeiten immer video_id verwenden.',
      'videos', (select coalesce(jsonb_agg(jsonb_build_object(
          'video_nr', z.nr, 'video_id', z.e->>'id', 'titel', z.e->>'titel', 'planung', z.e->>'planung',
          'erledigt', coalesce((z.e->>'erledigt')::boolean, false),
          'dateien', (select coalesce(jsonb_agg(f->>'name'), '[]') from jsonb_array_elements(case when jsonb_typeof(z.e->'dateien') = 'array' then z.e->'dateien' else '[]'::jsonb end) f)
        ) order by z.nr), '[]') from os_intern.anzeige(d.videos) z),
      'kommentare', (select coalesce(jsonb_agg(jsonb_build_object('text', n.text, 'am', n.created_at) order by n.created_at), '[]')
                     from proj_notizen n where n.dreh_id = d.id));

  when 'dreh_anlegen' then
    select id, name into v_kunde, v_kname from proj_kunden where name ilike '%' || (a->>'kunde') || '%' order by length(name) limit 1;
    if v_kunde is null then raise exception 'Kunde "%" nicht gefunden', a->>'kunde'; end if;
    insert into proj_drehs (datum, kunde_id, kunde_name, status, videos, video_count)
    values ((a->>'datum')::date, v_kunde, v_kname, coalesce(a->>'status', 'planung'), '[]'::jsonb, 0)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'dreh_id', v_id, 'kunde', v_kname, 'datum', a->>'datum');

  when 'infos_setzen' then
    v_modus := coalesce(a->>'modus', 'anhaengen');
    foreach v_feld in array array['erlaeuterungen_cutter', 'erlaeuterungen_videograph', 'requisiten', 'recruiting', 'dauer'] loop
      if a ? v_feld then
        v_neu := case when v_feld = 'dauer' then a->>v_feld else os_text_html(a->>v_feld) end;
        execute format(
          'update proj_drehs set %I = case when $2 = ''ersetzen'' or coalesce(%I, '''') = '''' or %L = ''dauer'' then $1 else %I || ''<div><br></div>'' || $1 end where id = $3',
          v_feld, v_feld, v_feld, v_feld) using v_neu, v_modus, d.id;
      end if;
    end loop;
    return jsonb_build_object('ok', true);

  when 'video_hinzufuegen' then
    v_vid := gen_random_uuid();
    v_video := jsonb_build_object('id', v_vid, 'titel', coalesce(a->>'titel', ''), 'planung', os_text_html(a->>'planung'),
                                  'datei_url', '', 'datei_name', '', 'dateien', '[]'::jsonb);
    -- video_nr = Position in der App-Anzeige: vor dem Video einfügen, das dort gerade steht
    v_pos := null;
    if nullif(a->>'video_nr', '') is not null then
      select pos into v_pos from os_intern.anzeige(d.videos) where nr = (a->>'video_nr')::int;
    end if;
    if v_pos is null then
      v_videos := d.videos || jsonb_build_array(v_video);
    else
      v_videos := jsonb_insert(d.videos, array[v_pos::text], v_video);
    end if;
    update proj_drehs set videos = v_videos, video_count = jsonb_array_length(v_videos) where id = d.id;
    return jsonb_build_object('ok', true, 'video_id', v_vid,
      'video_nr', (select nr from os_intern.anzeige(v_videos) where e->>'id' = v_vid::text));

  when 'video_bearbeiten' then
    v_pos := os_intern.video_aufloesen(d.videos, a);
    v_modus := coalesce(a->>'modus', 'ersetzen');
    v_video := d.videos -> v_pos;
    if a ? 'titel' then v_video := jsonb_set(v_video, '{titel}', to_jsonb(a->>'titel')); end if;
    if a ? 'planung' then
      v_neu := os_text_html(a->>'planung');
      if v_modus = 'anhaengen' and coalesce(v_video->>'planung', '') <> '' then
        v_neu := os_text_html(v_video->>'planung') || '<div><br></div>' || v_neu;
      end if;
      v_video := jsonb_set(v_video, '{planung}', to_jsonb(v_neu));
    end if;
    update proj_drehs set videos = jsonb_set(videos, array[v_pos::text], v_video) where id = d.id;
    return jsonb_build_object('ok', true, 'video_id', v_video->>'id', 'video_nr', os_intern.anzeige_nr(d.videos, v_pos), 'titel', v_video->>'titel');

  when 'kommentar_hinzufuegen' then
    if coalesce(trim(a->>'text'), '') = '' then raise exception 'Kommentartext fehlt'; end if;
    insert into proj_notizen (dreh_id, text) values (d.id, trim(a->>'text'));
    return jsonb_build_object('ok', true);

  when 'upload_ticket' then
    v_pos := os_intern.video_aufloesen(d.videos, a);
    v_path := os_ticket_pfad(d.id, v_pos, a->>'dateiname');
    insert into os_upload_tickets (path, dreh_id, video_idx, video_id, dateiname)
      values (v_path, d.id, v_pos, (d.videos->v_pos->>'id')::uuid, coalesce(nullif(a->>'dateiname', ''), 'datei'));
    return jsonb_build_object('path', v_path, 'video_id', d.videos->v_pos->>'id', 'titel', d.videos->v_pos->>'titel');

  when 'upload_sammel' then
    if jsonb_typeof(a->'dateien') is distinct from 'array' or jsonb_array_length(a->'dateien') = 0 then raise exception 'dateien (Liste) fehlt'; end if;
    v_neu := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    for v_video in select * from jsonb_array_elements(a->'dateien') loop
      v_pos := os_intern.video_aufloesen(d.videos, v_video);
      insert into os_upload_tickets (path, dreh_id, video_idx, video_id, dateiname, gruppe, original)
      values (os_ticket_pfad(d.id, v_pos, v_video->>'dateiname'), d.id, v_pos, (d.videos->v_pos->>'id')::uuid,
              coalesce(nullif(v_video->>'dateiname', ''), 'datei'), v_neu, nullif(v_video->>'original_dateiname', ''));
    end loop;
    return jsonb_build_object('gruppe', v_neu, 'anzahl', jsonb_array_length(a->'dateien'));

  when 'datei_registrieren' then
    update os_upload_tickets set used = true where path = a->>'path' and dreh_id = d.id and not used
      returning video_id, video_idx, dateiname into v_vid, v_pos, v_feld;
    if v_feld is null then raise exception 'Upload-Ticket ungültig oder schon benutzt'; end if;
    v_video := os_intern.datei_an_video(d.id, v_vid, case when v_vid is null then v_pos end,
                 jsonb_build_object('url', a->>'url', 'name', v_feld, 'path', a->>'path'));
    return jsonb_build_object('ok', true, 'video_nr', v_video->'video_nr', 'video_id', v_video->'video_id', 'titel', v_video->'titel', 'datei', v_feld);

  else
    raise exception 'Unbekannte Aktion %', p_action;
  end case;
end $$;

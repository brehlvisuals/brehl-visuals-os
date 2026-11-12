-- Funktionen Teil 3: feste Videonummern + Claude-Connector (os_api) für Deadlines und Aufgaben
-- Ändert keine Daten. Nur Funktionslogik:
--  * Videonummer = feste Position im Dreh (Video 7 bleibt 7, auch wenn es abgehakt wird)
--  * os_api: Hinweistext, dreh_lesen zeigt Videograph/Cutter/Deadlines, neue Aktionen für Deadlines + Aufgaben
--    (bestehende Aktionen und ihre Parameter bleiben unverändert)

create or replace function os_intern.anzeige(p_videos jsonb)
 returns table(nr integer, pos integer, e jsonb)
 language sql
 immutable
as $function$
  -- feste Nummer = Position im Dreh (erledigte Videos behalten ihre Nummer)
  select t.n::int, (t.n - 1)::int, t.e
  from jsonb_array_elements(coalesce(p_videos, '[]'::jsonb)) with ordinality t(e, n)
$function$;

-- Hilfen für Personen und Zeiten (Berliner Ortszeit)
create or replace function os_intern.person_finden(p_name text)
 returns uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select id from public.profiles
   where coalesce(aktiv, true) and full_name ilike '%' || trim(p_name) || '%'
   order by length(full_name) limit 1
$function$;

create or replace function os_intern.zeit_lesen(p text)
 returns timestamptz
 language sql
 stable
as $function$
  select case when nullif(trim(p), '') is null then null
              when length(trim(p)) <= 10 then (trim(p)::date + time '09:00') at time zone 'Europe/Berlin'
              else (trim(p)::timestamp) at time zone 'Europe/Berlin' end
$function$;

create or replace function os_intern.zeit_text(p timestamptz)
 returns text
 language sql
 stable
as $function$ select to_char(p at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') $function$;

do $mig$
declare d text; alt text;
begin
  d := pg_get_functiondef('public.os_api(text,text,jsonb)'::regprocedure);
  alt := d;

  -- 1) Aktionen ohne Dreh-Bezug
  d := replace(d, $a$if p_action not in ('kunden_auflisten', 'drehs_auflisten', 'dreh_anlegen') then$a$,
                  $a$if p_action not in ('kunden_auflisten', 'drehs_auflisten', 'dreh_anlegen', 'team_auflisten', 'aufgaben_auflisten', 'aufgabe_anlegen', 'aufgabe_bearbeiten', 'aufgabe_loeschen') then$a$);

  -- 2) Hinweistext zur festen Nummer
  d := replace(d, $a$'video_nr = Nummer wie in der App (erledigte Videos stehen unten). Zum Bearbeiten immer video_id verwenden.'$a$,
                  $a$'video_nr = feste Nummer wie in der App (bleibt gleich, auch wenn ein Video abgehakt wird). Zum Bearbeiten immer video_id verwenden.'$a$);

  -- 3) dreh_lesen: Videograph, Cutter, Deadlines
  d := replace(d, $a$'darsteller', d.darsteller_name, 'dauer', d.dauer,$a$,
                  $a$'darsteller', d.darsteller_name, 'dauer', d.dauer,
      'videograph', (select full_name from profiles where id = d.zustaendig_id),
      'cutter', (select full_name from profiles where id = d.cutter_id),
      'deadline_raw', os_intern.zeit_text(d.deadline_raw), 'deadline_cutting', os_intern.zeit_text(d.deadline_cutting),$a$);

  -- 4) neue Aktionen
  d := replace(d, $a$  when 'kommentar_hinzufuegen' then$a$,
$a$  when 'deadlines_setzen' then
    -- Videograph/Cutter per Name, Deadlines als 'YYYY-MM-DD HH:MM' (Berliner Zeit); leerer Text = entfernen
    if a ? 'videograph' then
      v_kunde := case when nullif(trim(a->>'videograph'), '') is null then null else os_intern.person_finden(a->>'videograph') end;
      if nullif(trim(a->>'videograph'), '') is not null and v_kunde is null then raise exception 'Person "%" nicht gefunden', a->>'videograph'; end if;
      update proj_drehs set zustaendig_id = v_kunde where id = d.id;
    end if;
    if a ? 'cutter' then
      v_kunde := case when nullif(trim(a->>'cutter'), '') is null then null else os_intern.person_finden(a->>'cutter') end;
      if nullif(trim(a->>'cutter'), '') is not null and v_kunde is null then raise exception 'Person "%" nicht gefunden', a->>'cutter'; end if;
      update proj_drehs set cutter_id = v_kunde where id = d.id;
    end if;
    if a ? 'deadline_raw' then update proj_drehs set deadline_raw = os_intern.zeit_lesen(a->>'deadline_raw') where id = d.id; end if;
    if a ? 'deadline_cutting' then update proj_drehs set deadline_cutting = os_intern.zeit_lesen(a->>'deadline_cutting') where id = d.id; end if;
    select * into d from proj_drehs where id = d.id;
    return jsonb_build_object('ok', true,
      'videograph', (select full_name from profiles where id = d.zustaendig_id),
      'cutter', (select full_name from profiles where id = d.cutter_id),
      'deadline_raw', os_intern.zeit_text(d.deadline_raw), 'deadline_cutting', os_intern.zeit_text(d.deadline_cutting));

  when 'kommentar_hinzufuegen' then$a$);

  d := replace(d, $a$  else
    raise exception 'Unbekannte Aktion %', p_action;$a$,
$a$  when 'team_auflisten' then
    return (select coalesce(jsonb_agg(jsonb_build_object('name', full_name, 'rolle', role, 'dashboard', dashboard) order by full_name), '[]')
              from profiles where coalesce(aktiv, true) and role <> 'extern');

  when 'aufgaben_auflisten' then
    v_kunde := case when nullif(trim(a->>'person'), '') is null then null else os_intern.person_finden(a->>'person') end;
    if nullif(trim(a->>'person'), '') is not null and v_kunde is null then raise exception 'Person "%" nicht gefunden', a->>'person'; end if;
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'aufgabe_id', t.id, 'titel', t.titel, 'beschreibung', t.beschreibung,
        'person', p.full_name, 'faellig_am', os_intern.zeit_text(t.faellig_am), 'erledigt', t.erledigt,
        'art', case t.quelle when 'manuell' then 'Aufgabe' when 'deadline_raw' then 'Deadline RAW (automatisch)' else 'Deadline Cutting (automatisch)' end,
        'dreh_id', t.dreh_id
      ) order by t.faellig_am nulls last), '[]')
      from os_aufgaben t left join profiles p on p.id = t.assignee_id
     where (v_kunde is null or t.assignee_id = v_kunde)
       and (coalesce((a->>'erledigte_zeigen')::boolean, false) or not t.erledigt)
       and (nullif(a->>'ab_datum', '') is null or t.faellig_am >= os_intern.zeit_lesen(a->>'ab_datum') - interval '9 hours')
       and (nullif(a->>'bis_datum', '') is null or t.faellig_am < os_intern.zeit_lesen(a->>'bis_datum') + interval '15 hours'));

  when 'aufgabe_anlegen' then
    if coalesce(trim(a->>'titel'), '') = '' then raise exception 'titel fehlt'; end if;
    v_kunde := os_intern.person_finden(a->>'person');
    if v_kunde is null then raise exception 'Person "%" nicht gefunden', a->>'person'; end if;
    insert into os_aufgaben (titel, beschreibung, assignee_id, faellig_am, ganztags, quelle, created_by)
    values (trim(a->>'titel'), nullif(trim(a->>'beschreibung'), ''), v_kunde, os_intern.zeit_lesen(a->>'faellig_am'),
            length(trim(coalesce(a->>'faellig_am', ''))) between 1 and 10, 'manuell', null)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'aufgabe_id', v_id);

  when 'aufgabe_bearbeiten' then
    v_id := nullif(a->>'aufgabe_id', '')::uuid;
    if not exists (select 1 from os_aufgaben where id = v_id) then raise exception 'Aufgabe nicht gefunden'; end if;
    if a ? 'titel' then update os_aufgaben set titel = trim(a->>'titel'), updated_at = now() where id = v_id; end if;
    if a ? 'beschreibung' then update os_aufgaben set beschreibung = nullif(trim(a->>'beschreibung'), ''), updated_at = now() where id = v_id; end if;
    if a ? 'faellig_am' then
      update os_aufgaben set faellig_am = os_intern.zeit_lesen(a->>'faellig_am'),
             ganztags = length(trim(coalesce(a->>'faellig_am', ''))) between 1 and 10, updated_at = now() where id = v_id;
    end if;
    if a ? 'person' then
      v_kunde := os_intern.person_finden(a->>'person');
      if v_kunde is null then raise exception 'Person "%" nicht gefunden', a->>'person'; end if;
      update os_aufgaben set assignee_id = v_kunde, updated_at = now() where id = v_id;
    end if;
    if a ? 'erledigt' then
      update os_aufgaben set erledigt = (a->>'erledigt')::boolean,
             erledigt_am = case when (a->>'erledigt')::boolean then now() end, updated_at = now() where id = v_id;
    end if;
    return jsonb_build_object('ok', true, 'aufgabe_id', v_id);

  when 'aufgabe_loeschen' then
    v_id := nullif(a->>'aufgabe_id', '')::uuid;
    delete from os_aufgaben where id = v_id;
    if not found then raise exception 'Aufgabe nicht gefunden'; end if;
    return jsonb_build_object('ok', true, 'hinweis', 'Liegt im Papierkorb und kann wiederhergestellt werden.');

  else
    raise exception 'Unbekannte Aktion %', p_action;$a$);

  -- Sicherheitsnetz: alle 6 Ersetzungen müssen gegriffen haben
  if d = alt
     or position('team_auflisten'' then' in d) = 0
     or position('deadlines_setzen'' then' in d) = 0
     or position('feste Nummer wie in der App' in d) = 0
     or position('''cutter'', (select full_name' in d) = 0
     or position('''aufgaben_auflisten'', ''aufgabe_anlegen''' in d) = 0 then
    raise exception 'os_api: Ersetzung unvollständig – Migration abgebrochen, nichts geändert';
  end if;
  execute d;
end $mig$;

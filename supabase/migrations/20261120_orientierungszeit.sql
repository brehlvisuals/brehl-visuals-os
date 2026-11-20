-- Orientierungszeit (geschätzte max. Dauer in Stunden) für Aufgaben + Cutting pro Dreh. Nur Ergänzungen.
alter table public.os_aufgaben add column if not exists dauer_std numeric(5,2) check (dauer_std is null or dauer_std > 0);
alter table public.proj_drehs add column if not exists cutting_dauer_std numeric(5,2) check (cutting_dauer_std is null or cutting_dauer_std > 0);

-- dreh_felder_setzen: cutting_dauer_std erlauben (leer = null)
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.dreh_felder_setzen(text,uuid,jsonb,bigint)'::regprocedure);
  if position('cutting_dauer_std' in d) = 0 then
    d := replace(d, $a$'cutter_id', 'deadline_raw', 'deadline_cutting'];$a$, $a$'cutter_id', 'deadline_raw', 'deadline_cutting', 'cutting_dauer_std'];$a$);
    d := replace(d, $a$'cutter_id', 'deadline_raw', 'deadline_cutting']
    else$a$, $a$'cutter_id', 'deadline_raw', 'deadline_cutting', 'cutting_dauer_std']
    else$a$);
    if (length(d) - length(replace(d, 'cutting_dauer_std', ''))) / length('cutting_dauer_std') <> 2 then raise exception 'dreh_felder_setzen: Ersetzung fehlgeschlagen'; end if;
    execute d;
  end if;
end $mig$;

-- Cutting-Deadline-Aufgabe übernimmt die Orientierungszeit aus dem Dreh
create or replace function os_intern.deadline_aufgaben()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform os_intern.deadline_aufgabe(NEW, 'deadline_raw', NEW.deadline_raw, NEW.zustaendig_id,
                                     'RAW hochladen', coalesce(NEW.raw_gesichert, false));
  perform os_intern.deadline_aufgabe(NEW, 'deadline_cutting', NEW.deadline_cutting, NEW.cutter_id,
                                     'Videos fertig, an Kunden & Metricool', NEW.status in ('posting', 'abgeschlossen'));
  update public.os_aufgaben set dauer_std = NEW.cutting_dauer_std, updated_at = now()
   where dreh_id = NEW.id and quelle = 'deadline_cutting' and dauer_std is distinct from NEW.cutting_dauer_std;
  return null;
end $function$;

-- Trigger zusätzlich bei Änderung der Orientierungszeit auslösen (gleicher Name, Spalte ergänzt)
create or replace trigger trg_z_deadline_aufgaben after insert or update of deadline_raw, deadline_cutting, zustaendig_id, cutter_id, raw_gesichert, status, kunde_name, datum, cutting_dauer_std
  on public.proj_drehs for each row execute function os_intern.deadline_aufgaben();

-- Claude-Chat (os_api): dauer_std bei Aufgaben, cutting_dauer_std bei deadlines_setzen / dreh_lesen
do $mig$
declare d text; n int := 0;
begin
  d := pg_get_functiondef('public.os_api(text,text,jsonb)'::regprocedure);
  if position('dauer_std' in d) > 0 then return; end if;
  -- aufgaben_auflisten
  d := replace(d, $a$'art', case t.quelle when 'manuell'$a$, $a$'orientierungszeit_std', t.dauer_std, 'art', case t.quelle when 'manuell'$a$);
  -- aufgabe_anlegen
  d := replace(d, $a$    insert into os_aufgaben (titel, beschreibung, assignee_id, faellig_am, ganztags, quelle, created_by)
    values (trim(a->>'titel'), nullif(trim(a->>'beschreibung'), ''), v_kunde, os_intern.zeit_lesen(a->>'faellig_am'),
            length(trim(coalesce(a->>'faellig_am', ''))) between 1 and 10, 'manuell', null)$a$,
$a$    insert into os_aufgaben (titel, beschreibung, assignee_id, faellig_am, ganztags, quelle, created_by, dauer_std)
    values (trim(a->>'titel'), nullif(trim(a->>'beschreibung'), ''), v_kunde, os_intern.zeit_lesen(a->>'faellig_am'),
            length(trim(coalesce(a->>'faellig_am', ''))) between 1 and 10, 'manuell', null, nullif(a->>'orientierungszeit_std', '')::numeric)$a$);
  -- aufgabe_bearbeiten
  d := replace(d, $a$    if a ? 'erledigt' then
      update os_aufgaben set erledigt = (a->>'erledigt')::boolean,$a$,
$a$    if a ? 'orientierungszeit_std' then update os_aufgaben set dauer_std = nullif(a->>'orientierungszeit_std', '')::numeric, updated_at = now() where id = v_id; end if;
    if a ? 'erledigt' then
      update os_aufgaben set erledigt = (a->>'erledigt')::boolean,$a$);
  -- deadlines_setzen
  d := replace(d, $a$    if a ? 'deadline_cutting' then update proj_drehs set deadline_cutting = os_intern.zeit_lesen(a->>'deadline_cutting') where id = d.id; end if;$a$,
$a$    if a ? 'deadline_cutting' then update proj_drehs set deadline_cutting = os_intern.zeit_lesen(a->>'deadline_cutting') where id = d.id; end if;
    if a ? 'cutting_orientierungszeit_std' then update proj_drehs set cutting_dauer_std = nullif(a->>'cutting_orientierungszeit_std', '')::numeric where id = d.id; end if;$a$);
  -- Rückgaben von deadlines_setzen und dreh_lesen
  d := replace(d, $a$'deadline_raw', os_intern.zeit_text(d.deadline_raw), 'deadline_cutting', os_intern.zeit_text(d.deadline_cutting)$a$,
                  $a$'deadline_raw', os_intern.zeit_text(d.deadline_raw), 'deadline_cutting', os_intern.zeit_text(d.deadline_cutting), 'cutting_orientierungszeit_std', d.cutting_dauer_std$a$);
  n := (length(d) - length(replace(d, 'orientierungszeit_std', ''))) / length('orientierungszeit_std');
  if n < 7 then raise exception 'os_api: nur % Ersetzungen', n; end if;
  execute d;
end $mig$;

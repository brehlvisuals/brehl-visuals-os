-- Chefbereich Teil 3: Finanzen & Chef-Erinnerungen auch über Claude Chat (MCP) pflegen.
-- Nur ERGÄNZUNGEN. Eigene Funktion os_finanz_api – funktioniert NUR mit einem Schlüssel, der ausdrücklich als „chef“ markiert ist.
-- Normale os_api-Schlüssel (Drehplanung) sehen keine Finanzdaten.

alter table public.os_api_tokens add column if not exists chef boolean not null default false;
-- Felix' eigener Claude-Chat-Schlüssel darf den Chefbereich nutzen
update public.os_api_tokens set chef = true where name = 'Claude Chat (Felix)' and not chef;

create or replace function public.os_finanz_api(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_id uuid;
  p public.os_finanz_posten%rowtype;
  e public.os_chef_erinnerungen%rowtype;
  v_admin uuid;
  f timestamptz;
  aid uuid;
begin
  if p_token is null or not exists (select 1 from os_api_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and chef) then
    raise exception 'Kein Zugriff auf den Chefbereich';
  end if;
  update os_api_tokens set last_used_at = now() where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  case p_action
  when 'finanzen_daten' then
    return jsonb_build_object(
      'posten', (select coalesce(jsonb_agg(jsonb_build_object(
          'posten_id', x.id, 'bereich', x.bereich, 'name', x.name, 'betrag', x.betrag, 'betrag_brutto', x.betrag_brutto,
          'rhythmus', x.rhythmus, 'konto', x.konto, 'kunde', k.name, 'notiz', x.notiz, 'aktiv', x.aktiv
        ) order by x.bereich, x.position, x.name), '[]')
        from os_finanz_posten x left join proj_kunden k on k.id = x.kunde_id
        where (a->>'bereich' is null or x.bereich = a->>'bereich')),
      'einstellungen', (select to_jsonb(s) - 'id' from os_finanz_einstellungen s where id = 1));

  when 'finanz_posten_anlegen' then
    insert into os_finanz_posten (bereich, name, betrag, betrag_brutto, rhythmus, konto, notiz, kunde_id, position)
    values (a->>'bereich', nullif(trim(a->>'name'), ''), coalesce((a->>'betrag')::numeric, 0), (a->>'betrag_brutto')::numeric,
            coalesce(a->>'rhythmus', 'monatlich'), nullif(a->>'konto', ''), nullif(a->>'notiz', ''),
            (select id from proj_kunden where a->>'kunde' is not null and name ilike '%' || (a->>'kunde') || '%' order by length(name) limit 1),
            coalesce((select max(position) + 1 from os_finanz_posten where bereich = a->>'bereich'), 0))
    returning * into p;
    return jsonb_build_object('posten_id', p.id, 'bereich', p.bereich, 'name', p.name, 'betrag', p.betrag, 'rhythmus', p.rhythmus);

  when 'finanz_posten_bearbeiten' then
    v_id := nullif(a->>'posten_id', '')::uuid;
    update os_finanz_posten set
      name = coalesce(nullif(trim(a->>'name'), ''), name),
      bereich = coalesce(a->>'bereich', bereich),
      betrag = coalesce((a->>'betrag')::numeric, betrag),
      betrag_brutto = case when a ? 'betrag_brutto' then (a->>'betrag_brutto')::numeric else betrag_brutto end,
      rhythmus = coalesce(a->>'rhythmus', rhythmus),
      konto = case when a ? 'konto' then nullif(a->>'konto', '') else konto end,
      notiz = case when a ? 'notiz' then nullif(a->>'notiz', '') else notiz end,
      aktiv = coalesce((a->>'aktiv')::boolean, aktiv),
      updated_at = now()
    where id = v_id returning * into p;
    if not found then raise exception 'Posten % nicht gefunden', a->>'posten_id'; end if;
    return jsonb_build_object('posten_id', p.id, 'bereich', p.bereich, 'name', p.name, 'betrag', p.betrag, 'rhythmus', p.rhythmus, 'aktiv', p.aktiv);

  when 'finanz_posten_loeschen' then
    v_id := nullif(a->>'posten_id', '')::uuid;
    delete from os_finanz_posten where id = v_id returning * into p;   -- Papierkorb-Trigger sichert die Zeile
    if not found then raise exception 'Posten % nicht gefunden', a->>'posten_id'; end if;
    return jsonb_build_object('geloescht', p.name, 'hinweis', 'Liegt im Papierkorb und kann dort wiederhergestellt werden.');

  when 'erinnerungen_auflisten' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'erinnerung_id', id, 'titel', titel, 'rhythmus', rhythmus, 'naechster_termin', naechster_termin,
        'vorlauf_tage', vorlauf_tage, 'aktiv', aktiv, 'zuletzt_erledigt', zuletzt_erledigt, 'notiz', notiz
      ) order by naechster_termin), '[]') from os_chef_erinnerungen);

  when 'erinnerung_anlegen' then
    insert into os_chef_erinnerungen (titel, notiz, rhythmus, naechster_termin, vorlauf_tage)
    values (nullif(trim(a->>'titel'), ''), nullif(a->>'notiz', ''), coalesce(a->>'rhythmus', 'monatlich'),
            (a->>'naechster_termin')::date, coalesce((a->>'vorlauf_tage')::int, 7))
    returning * into e;
    return jsonb_build_object('erinnerung_id', e.id, 'titel', e.titel, 'rhythmus', e.rhythmus, 'naechster_termin', e.naechster_termin);

  when 'erinnerung_erledigt' then
    select * into e from os_chef_erinnerungen where id = nullif(a->>'erinnerung_id', '')::uuid;
    if not found then raise exception 'Erinnerung nicht gefunden'; end if;
    select id into v_admin from profiles where role = 'admin' order by created_at limit 1;
    f := (e.naechster_termin + time '12:00') at time zone 'Europe/Berlin';
    insert into os_aufgaben (titel, beschreibung, assignee_id, faellig_am, ganztags, quelle, erinnerung_id, created_by)
    values (e.titel, e.notiz, v_admin, f, true, 'manuell', e.id, v_admin)
    on conflict (erinnerung_id, faellig_am) where erinnerung_id is not null do nothing;
    select id into aid from os_aufgaben where erinnerung_id = e.id and faellig_am = f;
    update os_aufgaben set erledigt = true, erledigt_am = now(), updated_at = now() where id = aid and not erledigt;
    return jsonb_build_object('titel', e.titel, 'erledigt_fuer', e.naechster_termin,
      'naechster_termin', (select naechster_termin from os_chef_erinnerungen where id = e.id));

  else
    raise exception 'Unbekannte Aktion %', p_action;
  end case;
end $function$;
revoke all on function public.os_finanz_api(text, text, jsonb) from public, authenticated;
grant execute on function public.os_finanz_api(text, text, jsonb) to anon;

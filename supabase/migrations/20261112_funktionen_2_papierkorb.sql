-- Funktionen Teil 2: Allgemeiner Papierkorb
-- Jeder gelöschte Datensatz (Projekte, CRM, Arbeitszeiten, Urlaub, Spesen, Aufgaben …) wird vor dem Löschen
-- 1:1 als JSON gesichert und kann vom Admin wiederhergestellt werden. Der Papierkorb wird nie automatisch geleert.
-- Nur ERGÄNZUNGEN (neue Tabelle, neue Funktionen, neue BEFORE-DELETE-Trigger). Bestehende Daten bleiben unverändert.

create table if not exists public.os_papierkorb (
  id bigserial primary key,
  tabelle text not null,
  datensatz_id text,
  daten jsonb not null,
  geloescht_am timestamptz not null default now(),
  geloescht_von uuid default auth.uid(),
  trx bigint not null default txid_current(),        -- gleiche Transaktion = gemeinsam gelöscht (z. B. Lead + Notizen)
  wiederhergestellt_am timestamptz,
  wiederhergestellt_von uuid
);
create index if not exists os_papierkorb_offen_idx on public.os_papierkorb (geloescht_am desc) where wiederhergestellt_am is null;
create index if not exists os_papierkorb_trx_idx on public.os_papierkorb (trx);

alter table public.os_papierkorb enable row level security;
create policy os_papierkorb_admin_lesen on public.os_papierkorb for select to authenticated using (public.app_role() = 'admin');
revoke all on public.os_papierkorb from anon;
grant select on public.os_papierkorb to authenticated;   -- schreiben nur über Trigger/Funktionen

create or replace function os_intern.in_papierkorb()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.papierkorb_aus', true), '') = '1' then return OLD; end if;
  insert into public.os_papierkorb (tabelle, datensatz_id, daten)
  values (TG_TABLE_NAME, to_jsonb(OLD) ->> 'id', to_jsonb(OLD));
  return OLD;
end $function$;

do $$
declare t text;
begin
  foreach t in array array[
    'proj_drehs', 'proj_intern', 'proj_notizen', 'proj_kunden',
    'crm_leads', 'crm_darsteller', 'crm_custom_entries', 'crm_categories', 'crm_notizen', 'crm_tasks',
    'kunden_calls', 'kunden_touchpoints', 'kunden_journal', 'portal_news', 'funnel_lps', 'funnel_intern',
    'zeiteintraege', 'minijob_stunden', 'urlaubsantraege', 'spesen', 'os_aufgaben'
  ] loop
    if to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_trigger where tgname = 'trg_zz_papierkorb' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger trg_zz_papierkorb before delete on public.%I for each row execute function os_intern.in_papierkorb()', t);
    end if;
  end loop;
end $$;

-- Wiederherstellen (nur Admin). Stellt den Eintrag her + alles, was in derselben Aktion mitgelöscht wurde (z. B. Notizen eines Leads).
create or replace function public.papierkorb_wiederherstellen(p_id bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare e record; x record; n int := 0;
        erlaubt text[] := array['proj_drehs', 'proj_intern', 'proj_notizen', 'proj_kunden',
          'crm_leads', 'crm_darsteller', 'crm_custom_entries', 'crm_categories', 'crm_notizen', 'crm_tasks',
          'kunden_calls', 'kunden_touchpoints', 'kunden_journal', 'portal_news', 'funnel_lps', 'funnel_intern',
          'zeiteintraege', 'minijob_stunden', 'urlaubsantraege', 'spesen', 'os_aufgaben'];
begin
  if coalesce(public.app_role(), '') <> 'admin' then raise exception 'Nur Admins können wiederherstellen' using errcode = 'PV403'; end if;
  select * into e from public.os_papierkorb where id = p_id;
  if not found then raise exception 'Eintrag nicht gefunden' using errcode = 'PV404'; end if;
  if e.wiederhergestellt_am is not null then raise exception 'Wurde schon wiederhergestellt'; end if;
  for x in select * from public.os_papierkorb
            where trx = e.trx and id >= e.id and wiederhergestellt_am is null order by id loop
    if not x.tabelle = any(erlaubt) then continue; end if;
    begin
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) on conflict do nothing', x.tabelle, x.tabelle)
        using x.daten;
    exception when foreign_key_violation then
      if x.id = e.id then
        raise exception 'Der zugehörige übergeordnete Eintrag (z. B. Lead, Kunde oder Dreh) ist noch gelöscht – bitte zuerst den wiederherstellen.';
      end if;
      continue;
    end;
    update public.os_papierkorb set wiederhergestellt_am = now(), wiederhergestellt_von = auth.uid() where id = x.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'wiederhergestellt', n);
end $function$;
revoke all on function public.papierkorb_wiederherstellen(bigint) from public, anon;
grant execute on function public.papierkorb_wiederherstellen(bigint) to authenticated;

-- Dreh löschen aus der App: läuft über dreh_loeschen (Löschsperre bleibt bestehen).
-- Sicherheitsfix: bisher durfte JEDER (auch ohne Login) diese Funktionen aufrufen. Jetzt nur Admin/Mitarbeiter.
create or replace function public.dreh_loeschen(p_dreh_id uuid, p_codewort text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_info text;
begin
  if coalesce(public.app_role(), '') not in ('admin', 'mitarbeiter') then
    raise exception 'Keine Berechtigung zum Löschen' using errcode = 'PV403';
  end if;
  if p_codewort is distinct from 'LOESCHEN' then
    raise exception 'Falsches Codewort. Zum Loeschen muss LOESCHEN eingegeben werden.';
  end if;

  select datum || ' / ' || coalesce(kunde_name, 'ohne Kunde')
    into v_info
  from public.proj_drehs where id = p_dreh_id;

  if v_info is null then
    raise exception 'Dreh % nicht gefunden', p_dreh_id;
  end if;

  perform set_config('app.loeschen_bestaetigt', 'LOESCHEN', true);
  delete from public.proj_drehs where id = p_dreh_id;
  perform set_config('app.loeschen_bestaetigt', '', true);

  return 'Geloescht: ' || v_info || ' - liegt im Papierkorb und ist wiederherstellbar.';
end;
$function$;
revoke all on function public.dreh_loeschen(uuid, text) from public, anon;
grant execute on function public.dreh_loeschen(uuid, text) to authenticated;

create or replace function public.dreh_wiederherstellen(p_dreh_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_daten jsonb;
  v_neue_id uuid;
begin
  if coalesce(public.app_role(), '') not in ('admin', 'mitarbeiter') then
    raise exception 'Keine Berechtigung' using errcode = 'PV403';
  end if;
  select daten into v_daten
  from public.proj_drehs_papierkorb
  where dreh_id = p_dreh_id
  order by geloescht_am desc
  limit 1;

  if v_daten is null then
    raise exception 'Kein Eintrag im Papierkorb fuer Dreh %', p_dreh_id;
  end if;

  if exists (select 1 from public.proj_drehs where id = p_dreh_id) then
    raise exception 'Dreh % existiert bereits - nichts wiederhergestellt', p_dreh_id;
  end if;

  insert into public.proj_drehs
  select * from jsonb_populate_record(null::public.proj_drehs, v_daten)
  returning id into v_neue_id;

  return v_neue_id;
end;
$function$;
revoke all on function public.dreh_wiederherstellen(uuid) from public, anon;
grant execute on function public.dreh_wiederherstellen(uuid) to authenticated;

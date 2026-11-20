-- Beim Abhaken: tatsächlich gebrauchte Zeit (Pflicht für Mitarbeiter) + Begründung, wenn über der Orientierungszeit. Nur Ergänzungen.
alter table public.os_aufgaben add column if not exists ist_std numeric(6,2) check (ist_std is null or ist_std > 0);
alter table public.os_aufgaben add column if not exists ist_grund text;
alter table public.os_aufgaben add column if not exists ist_erfasst_am timestamptz;

-- Abschließen mit Zeit (auch zum Nachtragen bei automatisch erledigten Deadline-Aufgaben)
create or replace function public.aufgabe_abschliessen(p_id uuid, p_ist_std numeric, p_grund text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare t public.os_aufgaben%rowtype; ist_admin boolean := coalesce(public.app_role(), '') = 'admin';
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet' using errcode = 'PV401'; end if;
  select * into t from public.os_aufgaben where id = p_id for update;
  if not found or not (ist_admin or (t.assignee_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.dashboard))) then
    raise exception 'Keine Berechtigung' using errcode = 'PV403';
  end if;
  if not ist_admin and (p_ist_std is null or p_ist_std <= 0) then
    raise exception 'Bitte angeben, wie lange du gebraucht hast' using errcode = 'PV422';
  end if;
  if not ist_admin and t.dauer_std is not null and p_ist_std > t.dauer_std and coalesce(trim(p_grund), '') = '' then
    raise exception 'Bitte kurz begründen, warum es länger gedauert hat' using errcode = 'PV422';
  end if;
  update public.os_aufgaben
     set erledigt = true, erledigt_am = coalesce(case when erledigt then erledigt_am end, now()),
         ist_std = p_ist_std, ist_grund = nullif(trim(coalesce(p_grund, '')), ''), ist_erfasst_am = now(), updated_at = now()
   where id = p_id;
end $function$;
revoke all on function public.aufgabe_abschliessen(uuid, numeric, text) from public, anon;
grant execute on function public.aufgabe_abschliessen(uuid, numeric, text) to authenticated;

-- Einfaches Abhaken ohne Zeit nur noch für Admin; Mitarbeiter dürfen hierüber nur wieder „öffnen“
create or replace function public.aufgabe_erledigt_setzen(p_id uuid, p_wert boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet' using errcode = 'PV401'; end if;
  if p_wert and coalesce(public.app_role(), '') <> 'admin' then
    raise exception 'Bitte beim Abhaken die gebrauchte Zeit angeben (App neu laden)' using errcode = 'PV422';
  end if;
  update public.os_aufgaben
     set erledigt = p_wert, erledigt_am = case when p_wert then now() end, updated_at = now()
   where id = p_id
     and (public.app_role() = 'admin'
          or (assignee_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.dashboard)));
  if not found then raise exception 'Keine Berechtigung' using errcode = 'PV403'; end if;
end $function$;

-- Claude-Chat: aufgaben_auflisten zeigt auch gebrauchte Zeit + Begründung
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.os_api(text,text,jsonb)'::regprocedure);
  if position('gebraucht_std' in d) > 0 then return; end if;
  d := replace(d, $a$'orientierungszeit_std', t.dauer_std, 'art'$a$, $a$'orientierungszeit_std', t.dauer_std, 'gebraucht_std', t.ist_std, 'begruendung_laenger', t.ist_grund, 'art'$a$);
  if position('gebraucht_std' in d) = 0 then raise exception 'os_api: Stelle nicht gefunden'; end if;
  execute d;
end $mig$;

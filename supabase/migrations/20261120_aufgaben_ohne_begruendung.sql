-- Felix: Begründung bei Überschreitung vorerst NICHT mehr Pflicht (Zeit bleibt Pflicht). Spalte ist_grund bleibt bestehen.
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
  update public.os_aufgaben
     set erledigt = true, erledigt_am = coalesce(case when erledigt then erledigt_am end, now()),
         ist_std = p_ist_std, ist_grund = nullif(trim(coalesce(p_grund, '')), ''), ist_erfasst_am = now(), updated_at = now()
   where id = p_id;
end $function$;

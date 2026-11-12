-- Funktionen Teil 6: Profilbilder
-- Nur ERGÄNZUNGEN: Spalte profiles.avatar_url, Storage-Bucket „avatare“ (öffentlich lesbar, zufällige Dateinamen),
-- neue Storage-Regeln: hochladen/ändern/löschen nur Admin oder die Person selbst (eigener Ordner = eigene user-id).

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatare', 'avatare', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy avatare_lesen on storage.objects for select to authenticated
  using (bucket_id = 'avatare');
create policy avatare_schreiben on storage.objects for insert to authenticated
  with check (bucket_id = 'avatare' and (public.app_role() = 'admin' or split_part(name, '/', 1) = auth.uid()::text));
create policy avatare_aendern on storage.objects for update to authenticated
  using (bucket_id = 'avatare' and (public.app_role() = 'admin' or split_part(name, '/', 1) = auth.uid()::text))
  with check (bucket_id = 'avatare' and (public.app_role() = 'admin' or split_part(name, '/', 1) = auth.uid()::text));
create policy avatare_loeschen on storage.objects for delete to authenticated
  using (bucket_id = 'avatare' and (public.app_role() = 'admin' or split_part(name, '/', 1) = auth.uid()::text));

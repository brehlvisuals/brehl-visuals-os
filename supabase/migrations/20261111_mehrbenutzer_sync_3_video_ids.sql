-- Mehrbenutzer-Sync, Teil 3: allen bestehenden Videos eine feste id geben.
-- Ergänzt NUR das Feld "id" in jedem Video-Objekt. Inhalte, Reihenfolge, Dateien, Status bleiben unverändert
-- (wird direkt danach mit dem Backup verglichen). Der Verlauf-Trigger sichert dabei automatisch den Stand davor.
update public.proj_drehs set videos = os_intern.videos_mit_ids(videos)
 where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(videos) = 'array' then videos else '[]'::jsonb end) e
               where jsonb_typeof(e) = 'object' and not (e ? 'id'));
update public.proj_intern set videos = os_intern.videos_mit_ids(videos)
 where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(videos) = 'array' then videos else '[]'::jsonb end) e
               where jsonb_typeof(e) = 'object' and not (e ? 'id'));
-- Offene Upload-Tickets (falls vorhanden) bekommen zusätzlich die video_id ihres Videos
update public.os_upload_tickets t set video_id = (d.videos -> t.video_idx ->> 'id')::uuid
  from public.proj_drehs d
 where d.id = t.dreh_id and t.video_id is null and not t.used and t.expires_at > now()
   and t.video_idx >= 0 and t.video_idx < jsonb_array_length(d.videos);

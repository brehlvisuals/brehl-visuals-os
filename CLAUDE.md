# Brehl Visuals OS – Regeln für Änderungen

Vite + React (kein Next.js), Vercel-Functions unter `api/`, Supabase-Projekt `xbbiqubuvwxevxdxfyby`.
Diese Regeln gelten für **jede** Änderung, egal wie klein. Sie wurden von Felix festgelegt (11.11.2026).

## Daten
- Bestehende Daten **nie löschen oder inhaltlich verändern**. Migrationen dürfen nur **ergänzen** (neue Spalten, Felder, Tabellen, Funktionen).
- **Keine `DROP`-, `DELETE`- oder `TRUNCATE`-Befehle auf Live-Tabellen** ohne Felix' ausdrückliches OK – auch nicht für Testdaten. Wenn so etwas nötig erscheint: stoppen und fragen.
- Gelöschte Drehs gehen nur in den Papierkorb (`proj_drehs_papierkorb`), nie endgültig.

## Vorgehen bei Datenbank-Migrationen
1. Erst einen **Supabase-Branch** anlegen und die Migration dort testen (mit realistischen, aus Live kopierten Testdaten).
   Achtung: Das Basisschema stammt aus `supabase-setup.sql` und steht nicht in den Migrationen → ein neuer Branch startet leer, betroffene Tabellen/Funktionen/Policies/Grants müssen vorher 1:1 von Live übernommen werden.
2. Vor Live: **Backup-Tabellen im Schema `os_backup`** anlegen (`<tabelle>_<JJJJMMTT>`, per Prüfsumme gegen Live verifizieren) und die Vorher-Zahlen festhalten.
3. Nach der Migration: **Vorher/Nachher-Vergleich** (Zeilen, Videos, Dateien, Inhalte pro Datensatz) und Felix zeigen.
4. **Live erst nach Felix' OK.**
5. Test-Branch danach löschen (kostet pro Stunde).

Das Schema `os_backup` (Stand 11.11.2026) bleibt mindestens bis **09.12.2026** – nicht löschen.

## Deploy
- **Push auf `main` = sofort live** (Vercel). Deshalb erst pushen, wenn Felix OK gegeben hat. Arbeiten auf einem eigenen Branch, `main` nur nach Freigabe.
- Git-Autor muss `felix.brehl@brehlvisuals.de` sein, sonst blockt Vercel den Deploy.

## Rechte
- **RLS-Policies, Grants und Rollenlogik nicht verändern, ohne Felix zu fragen.** Vorher/Nachher die Policies vergleichen (Snapshot z. B. in `os_backup.policies_vorher_*`).
- Rollen: `admin`, `mitarbeiter`, `videograph` (bearbeiten, nicht löschen, nicht „Abgeschlossen“), `extern` = Darsteller (nur eigene Drehs im Status „Dreh“ lesen + abhaken).

## Schreibzugriffe auf Drehs/Konzepte (`proj_drehs`, `proj_intern`)
- **Nur feldgenau über die RPC-Funktionen** schreiben – **nie das ganze `videos`-Array** (ein Trigger lehnt das aus dem Browser ab):
  - `video_feld_setzen`, `video_hinzufuegen`, `video_entfernen`, `videos_sortieren`
  - `datei_anhaengen`, `datei_entfernen`
  - `dreh_felder_setzen` / `dreh_feld_setzen` (Top-Level-Felder)
  - `video_erledigt_setzen` (Haken, auch für Darsteller)
  - `videos_ersetzen` (nur mit erwarteter `version`, z. B. Verlauf wiederherstellen)
- Im Client läuft das über `src/lib/useLiveDatensatz.js` (Realtime, feldgenaues Speichern, Konfliktschutz). Neue Bearbeitungsfunktionen dort anbinden, nicht direkt `supabase.from(...).update(...)`.
- **Videos immer über ihre feste `id` (video_id) ansprechen**, nie über die Position im Array. Upload-Tickets haben `video_id`.
- Claude-Connector (`api/mcp/[key].js` → DB-Funktion `os_api`): `video_nr` = Nummer wie in der App (offene zuerst, erledigte unten), geschrieben wird über `video_id` (oder `video_nr` + `video_titel` zur Kontrolle). Tool-Namen und Parameter nicht umbenennen – werden extern genutzt.

## Notfall: alten Stand wiederherstellen
- Einzelner Dreh: im OS Dreh öffnen → Tab „Verlauf“ → „Videos wiederherstellen“.
- Top-Level-Felder: `proj_verlauf.snapshot` des gewünschten Stands per `dreh_felder_setzen` zurückschreiben.
- Gelöschter Dreh: Verwalten → Papierkorb → Wiederherstellen.
- Komplett: `os_backup.*_20261111` bzw. die SQL-Dateien unter `~/Documents/Brehl-OS-Backups/`.

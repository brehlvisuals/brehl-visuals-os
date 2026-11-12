# Brehl Visuals OS – Regeln für Änderungen

Vite + React (kein Next.js), Vercel-Functions unter `api/`, Supabase-Projekt `xbbiqubuvwxevxdxfyby`.
Diese Regeln gelten für **jede** Änderung, egal wie klein. Sie wurden von Felix festgelegt (11.11.2026).

## Daten
- Bestehende Daten **nie löschen oder inhaltlich verändern**. Migrationen dürfen nur **ergänzen** (neue Spalten, Felder, Tabellen, Funktionen).
- **Keine `DROP`-, `DELETE`- oder `TRUNCATE`-Befehle auf Live-Tabellen** ohne Felix' ausdrückliches OK – auch nicht für Testdaten. Wenn so etwas nötig erscheint: stoppen und fragen.
- Gelöschtes landet automatisch im **Papierkorb** (`os_papierkorb`, BEFORE-DELETE-Trigger `trg_zz_papierkorb` auf allen Fach-Tabellen; Wiederherstellen per `papierkorb_wiederherstellen`, nur Admin). Der Papierkorb wird nie geleert. Neue Tabellen mit Nutzdaten bekommen ebenfalls diesen Trigger.
- Drehs löschen nur über `dreh_loeschen` (Löschsperre `a_trg_dreh_loeschsperre`), zusätzlich Kopie in `proj_drehs_papierkorb`.

## Vorgehen bei Datenbank-Migrationen
1. Erst einen **Supabase-Branch** anlegen und die Migration dort testen (mit realistischen, aus Live kopierten Testdaten).
   Achtung: Das Basisschema stammt aus `supabase-setup.sql` und steht nicht in den Migrationen → ein neuer Branch startet leer, betroffene Tabellen/Funktionen/Policies/Grants müssen vorher 1:1 von Live übernommen werden.
2. Vor Live: **Backup-Tabellen im Schema `os_backup`** anlegen (`<tabelle>_<JJJJMMTT>`, per Prüfsumme gegen Live verifizieren) und die Vorher-Zahlen festhalten.
3. Nach der Migration: **Vorher/Nachher-Vergleich** (Zeilen, Videos, Dateien, Inhalte pro Datensatz) und Felix zeigen.
4. **Live erst nach Felix' OK.**
5. Test-Branch danach löschen (kostet pro Stunde).

Das Schema `os_backup` (Stände 11.11. und 12.11.2026) bleibt mindestens bis **10.12.2026** – nicht löschen.

## Deploy
- **Push auf `main` = sofort live** (Vercel). Deshalb erst pushen, wenn Felix OK gegeben hat. Arbeiten auf einem eigenen Branch, `main` nur nach Freigabe.
- Git-Autor muss `felix.brehl@brehlvisuals.de` sein, sonst blockt Vercel den Deploy.

## Rechte
- **RLS-Policies, Grants und Rollenlogik nicht verändern, ohne Felix zu fragen.** Vorher/Nachher die Policies vergleichen (Snapshot z. B. in `os_backup.policies_vorher_*`).
- Rollen: `admin`, `mitarbeiter`, `videograph` (seit 12.11.2026 gleiche Rechte wie Mitarbeiter, erfasst Stunden aber als Minijob über „Meine Stunden“), `extern` = Darsteller (nur eigene Drehs im Status „Dreh“ lesen + abhaken).
- CRM „Kunden & Leads“ nur mit Berechtigung `crm` (Team-Schalter), Darsteller-Board mit `crm_darsteller` (oder `crm`).

## Schreibzugriffe auf Drehs/Konzepte (`proj_drehs`, `proj_intern`)
- **Nur feldgenau über die RPC-Funktionen** schreiben – **nie das ganze `videos`-Array** (ein Trigger lehnt das aus dem Browser ab):
  - `video_feld_setzen`, `video_hinzufuegen`, `video_entfernen`, `videos_sortieren`
  - `datei_anhaengen`, `datei_entfernen`
  - `dreh_felder_setzen` / `dreh_feld_setzen` (Top-Level-Felder, inkl. `cutter_id`, `deadline_raw`, `deadline_cutting`)
  - `video_erledigt_setzen` (Haken, auch für Darsteller)
  - `videos_ersetzen` (nur mit erwarteter `version`, z. B. Verlauf wiederherstellen)
- Im Client läuft das über `src/lib/useLiveDatensatz.js` (Realtime, feldgenaues Speichern, Konfliktschutz). Neue Bearbeitungsfunktionen dort anbinden, nicht direkt `supabase.from(...).update(...)`.
- **Videos immer über ihre feste `id` (video_id) ansprechen**, nie über die Position im Array. Upload-Tickets haben `video_id`.
- **Videonummer = feste Position im Dreh** (Video 7 bleibt 7, auch abgehakt; `os_intern.anzeige`). In der App stehen erledigte unten, behalten aber ihre Nummer.
- Claude-Connector (`api/mcp/[key].js` → DB-Funktion `os_api`): geschrieben wird über `video_id` (oder `video_nr` + `video_titel` zur Kontrolle). Tool-Namen und Parameter nicht umbenennen – werden extern genutzt.

## Aufgaben, Deadlines, Dashboards
- `os_aufgaben`: manuelle Aufgaben + automatische Deadline-Aufgaben (Trigger `trg_z_deadline_aufgaben` auf `proj_drehs`, je Dreh max. eine pro `quelle`). Abhaken für Nicht-Admins nur per `aufgabe_erledigt_setzen`.
- Dashboard-Zugang: `profiles.dashboard` (nur Admin änderbar). Admin = Master-Dashboard.
- Ab Status „Cutting“ muss `raw_gesichert` gesetzt sein (App-Regel).

## Kundenvideos (Metricool)
- `api/metricool.js` liest Metricool (nur lesend) mit `METRICOOL_USER_TOKEN` (Vercel-Env, nie im Browser). Zuordnung + Monatsziel in `proj_kunden` (`metricool_brand_ids`, `videos_pro_monat`, `freigabe_vorlauf_tage`; nur Admin änderbar).

## Notfall: alten Stand wiederherstellen
- Einzelner Dreh: im OS Dreh öffnen → Tab „Verlauf“ → „Videos wiederherstellen“.
- Top-Level-Felder: `proj_verlauf.snapshot` des gewünschten Stands per `dreh_felder_setzen` zurückschreiben.
- Gelöschter Dreh: Verwalten → Papierkorb → Wiederherstellen.
- Komplett: `os_backup.*_20261111` bzw. die SQL-Dateien unter `~/Documents/Brehl-OS-Backups/`.

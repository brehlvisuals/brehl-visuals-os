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

## Aufgaben: Orientierungszeit & gebrauchte Zeit
- `os_aufgaben.dauer_std` = Orientierungszeit (max. Dauer, Std.); Cutting-Deadline-Aufgaben übernehmen sie per Trigger aus `proj_drehs.cutting_dauer_std` (Videograph/RAW bewusst ohne).
- Mitarbeiter haken NUR über `aufgabe_abschliessen(p_id, p_ist_std, p_grund)` ab: Zeit Pflicht, über `dauer_std` zusätzlich Begründung Pflicht (`ist_std`, `ist_grund`). `aufgabe_erledigt_setzen(…, true)` ist nur noch für Admin. Auswertung: Chefbereich → Team & Erinnerungen → „Aufgaben-Zeiten“.

## Chefbereich (nur Admin)
- Seite `/chef` (adminOnly) + Tabelle `os_chef_erinnerungen` (RLS nur Admin). Fällige Erinnerungen legt `chef_erinnerungen_pruefen()` als Aufgabe für den Admin an (`os_aufgaben.erinnerung_id`), Abhaken schaltet per Trigger `trg_erinnerung_weiter` zum nächsten Termin. Nichts davon darf für andere Rollen sichtbar werden.
- Aufbau `/chef`: Startseite mit 2 Kacheln → „Finanzen“ (Tabs Plan & Ist | Kunden | Stundensatz | Posten | Einstellungen) und „Team & Erinnerungen“.
- Erinnerungen gelten pro ZEITRAUM: `naechster_termin` = Beginn (immer 1. des Monats, Trigger `trg_erinnerung_monatsanfang`), Aufgabe erscheint ab dem 1. und ist am Zeitraum-Ende fällig (`os_intern.periode_ende/periode_text`, `os_intern.erinnerungen_aufgaben`, `os_intern.erinnerung_abhaken`). Verpasste Zeiträume werden übersprungen.
- Steuer: Standard = echter Tarif 2026 (`steuerEcht` in finanzRechnung.js: § 32a, Soli, KiSt, GewSt Köln 475 % mit § 35-Anrechnung); Felix' Excel-Bänder nur noch zum Vergleich (`os_finanz_einstellungen.steuer.modus`).
- Lexware-Ist: Ausgaben an Finanzamt zählen NICHT als Kosten (USt/Lohnsteuer/Vorauszahlungen), Krankenkassen/Knappschaft = Sozialversicherung (`ausgabenArt`). Umschaltbar nach Rechnungsdatum oder Geldeingang (`os_finanz_belege.bezahlt_am` aus `/payments/{id}`).
- Sperre: `/chef` verlangt das OS-Passwort erneut (Re-Login per `signInWithPassword`), sobald der Tab >3 Min. verlassen wurde (`SPERRE_MS` in `src/pages/Chef.jsx`).
- Finanzen (ersetzt Felix' Excel „Finanzen.numbers“): `os_finanz_posten` (bereich einnahme|business|lohn|privat|invest, Beträge NETTO), `os_finanz_einstellungen` (Steuerbänder, Sicherheit %, Firmenwagen 1 %-Regel = nur steuerlicher Vorteil, kein Geldfluss), `os_finanz_belege` (Lexware-Netto-Cache, gefüllt von `api/lexoffice.js?aktion=sync`). Alles RLS nur Admin. Rechenlogik rein in `src/lib/finanzRechnung.js` (auch vom MCP genutzt).
- Stundensatz ab 09/2026 pro Kunde × Monat: (Lexware-Umsatz netto − Fahrtkosten) ÷ Stunden. Stunden/Fahrtkosten werden per Dreh-Auswahl (`src/components/DrehAuswahl.jsx`) dem Kunden zugeordnet (`minijob_stunden.dreh_id/kunde_id`, `spesen.dreh_id`).
- Claude-Chat: Finanz-/Erinnerungs-Tools laufen über `os_finanz_api` – nur mit Schlüssel `os_api_tokens.chef = true` (aktuell nur „Claude Chat (Felix)“). Neue Schlüssel nie mit chef=true anlegen, außer Felix will es ausdrücklich.

## Kundenvideos (Metricool)
- Zählregel Monatsziel: nur Video-Beiträge auf Instagram/TikTok/YouTube/Facebook (je Beitrag einmal), reine LinkedIn-Beiträge nie; pro Kunde einschränkbar über `proj_kunden.zaehl_netzwerke` (Bierschneider = nur TikTok). Freigabe-Warnungen zählen ALLE Beiträge (auch LinkedIn). Logik in `src/lib/kundenvideos.js` (`alsVideo`, `auswerten`).
- `api/metricool.js` liest Metricool (nur lesend) mit `METRICOOL_USER_TOKEN` (Vercel-Env, nie im Browser). Zuordnung + Monatsziel in `proj_kunden` (`metricool_brand_ids`, `videos_pro_monat`, `freigabe_vorlauf_tage`; nur Admin änderbar).

## Notfall: alten Stand wiederherstellen
- Einzelner Dreh: im OS Dreh öffnen → Tab „Verlauf“ → „Videos wiederherstellen“.
- Top-Level-Felder: `proj_verlauf.snapshot` des gewünschten Stands per `dreh_felder_setzen` zurückschreiben.
- Gelöschter Dreh: Verwalten → Papierkorb → Wiederherstellen.
- Komplett: `os_backup.*_20261111` bzw. die SQL-Dateien unter `~/Documents/Brehl-OS-Backups/`.

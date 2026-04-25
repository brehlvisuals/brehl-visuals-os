# Brehl Visuals OS v2

## Deployment

### 1. Supabase Setup
- Supabase SQL Editor → `supabase-setup.sql` ausführen
- Danach: Admin-Rechte vergeben (letzter Kommentar in SQL-Datei)

### 2. GitHub
- Neues Repository `brehl-visuals-os` anlegen
- Alle Dateien hochladen

### 3. Vercel
- Neues Projekt → GitHub Repository verbinden
- Environment Variables setzen:
  - `VITE_SUPABASE_URL` = https://xbbiqubuvwxevxdxfyby.supabase.co
  - `VITE_SUPABASE_ANON_KEY` = dein-anon-key

### 4. Supabase Auth URL
- Authentication → URL Configuration
- Site URL: https://dein-projekt.vercel.app

## Features
- Dashboard mit KPIs, Tasks, News
- Projekte (Kunden-Drehs mit Abnahme-Kunde-Spalte + Intern + Verwalten)
- CRM (Leads, Darsteller, eigene Kategorien)
- Tasks (eigene Seite)
- Funnels & LPs (Kunden + Intern)
- Kalender
- Team mit Berechtigungen
- Einstellungen
- Mobile-responsive mit Bottom Navigation

## Mobile als App speichern
iPhone: Safari → Teilen → "Zum Home-Bildschirm"
Android: Chrome → Menü → "Zum Startbildschirm"

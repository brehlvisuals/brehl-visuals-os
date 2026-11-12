// Gemeinsame Logik für „Kundenvideos“ (Seite + Warnungen im Dashboard)
import { supabase } from './supabase'

export const tagKey = d => { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}` }
// Metricool liefert Ortszeit Berlin ohne Offset – der Browser läuft in derselben Zone
export const alsDatum = s => s ? new Date(s.length <= 10 ? s + 'T12:00:00' : s) : null

export async function metricool(params) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(`/api/metricool?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
  let body = null
  try { body = await r.json() } catch { /* leer */ }
  if (!r.ok) { const e = new Error(body?.fehler || `Fehler ${r.status}`); e.code = body?.fehler; throw e }
  return body
}

// Welche Plattformen eines Beitrags zählen fürs Monatsziel?
// Nie LinkedIn (dort sind es Textbeiträge oder Duplikate). Optional pro Kunde eingeschränkt (z. B. Bierschneider = nur TikTok).
export function zaehlNetze(p, kunde) {
  const nur = kunde?.zaehl_netzwerke || []
  return (p.netzwerke || []).filter(n => n.netz !== 'linkedin' && (!nur.length || nur.includes(n.netz)))
}
// Zählt der Beitrag als Video fürs Monatsziel? Wenn ja, mit Status nur aus den zählenden Plattformen.
export function alsVideo(p, kunde) {
  const netze = zaehlNetze(p, kunde)
  if (!p.video || !netze.length) return null
  const st = netze.map(n => String(n.status || '').toUpperCase())
  const status = st.every(s => s === 'PUBLISHED') ? 'online'
    : st.some(s => s === 'PUBLISHED') ? 'teilweise'
    : st.some(s => ['ERROR', 'FAILED', 'REJECTED'].includes(s)) ? 'fehler' : 'geplant'
  return { ...p, status }
}

// Kennzahlen eines Kunden für einen Monat
// Monatsziel/Balken/Verlauf: nur Videos (siehe alsVideo). Freigaben: ALLE Beiträge (auch LinkedIn).
export function auswerten(kunde, alle, monat, drehs = []) {
  const posts = alle.map(p => alsVideo(p, kunde)).filter(Boolean)
  const jetzt = new Date()
  const mStart = new Date(monat.getFullYear(), monat.getMonth(), 1)
  const mEnde = new Date(monat.getFullYear(), monat.getMonth() + 1, 0, 23, 59, 59)
  const imMonat = posts.filter(p => { const d = alsDatum(p.datum); return d && d >= mStart && d <= mEnde })
  const online = imMonat.filter(p => p.status === 'online' || p.status === 'teilweise')
  const fehler = imMonat.filter(p => p.status === 'fehler')
  const geplant = imMonat.filter(p => p.status === 'geplant' && alsDatum(p.datum) >= jetzt)
  const verpasst = imMonat.filter(p => p.status === 'geplant' && alsDatum(p.datum) < jetzt)   // Termin vorbei, aber nicht online
  const offenAlle = posts.filter(p => p.status === 'geplant' && alsDatum(p.datum) >= new Date(jetzt.getTime() - 86400000))
  // Freigaben: alle noch nicht veröffentlichten Beiträge, egal ob Video oder LinkedIn-Text
  const ungepostet = alle.filter(p => p.status === 'geplant' && alsDatum(p.datum) >= new Date(jetzt.getTime() - 86400000))
  const freigabeOffen = ungepostet.filter(p => p.freigabe === 'pending')
  const abgelehnt = ungepostet.filter(p => p.freigabe === 'rejected')
  // Jede fehlende Freigabe ist rot – egal wie weit der Termin noch weg ist (Wunsch Felix, 2026-11-12).
  // (freigabe_vorlauf_tage bleibt in der DB, wird aber nicht mehr genutzt.)
  const dringend = [...freigabeOffen].sort((x, y) => alsDatum(x.datum) - alsDatum(y.datum))   // frühester zuerst
  const ziel = kunde.videos_pro_monat ?? null
  const summe = online.length + geplant.length
  const reichtBis = offenAlle.map(p => alsDatum(p.datum)).sort((a, b) => b - a)[0] || null
  const heute = tagKey(jetzt)
  const naechsterDreh = drehs.filter(d => d.kunde_id === kunde.id && d.datum && d.datum >= heute && d.status !== 'abgeschlossen')
    .sort((a, b) => a.datum.localeCompare(b.datum))[0] || null
  const inProduktion = drehs.filter(d => d.kunde_id === kunde.id && ['cutting', 'posting'].includes(d.status))
    .reduce((s, d) => s + (Array.isArray(d.videos) ? d.videos.filter(v => !v.erledigt).length : 0), 0)
  return {
    imMonat, alleImMonat: alle.filter(p => { const d = alsDatum(p.datum); return d && d >= mStart && d <= mEnde }), online, geplant, fehler, verpasst, freigabeOffen, abgelehnt, dringend,
    ziel, summe, fehlt: ziel != null ? Math.max(0, ziel - summe) : null, ueber: ziel != null ? Math.max(0, summe - ziel) : 0,
    reichtBis, naechsterDreh, inProduktion,
  }
}

// Ampel für eine Kundenkarte
export function ampel(a) {
  if (a.dringend.length || a.fehler.length || a.verpasst.length || a.abgelehnt.length) return 'rot'
  if (a.freigabeOffen.length || (a.fehlt != null && a.fehlt > 0)) return 'gelb'
  return 'gruen'
}

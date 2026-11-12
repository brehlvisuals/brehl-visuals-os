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

// Kennzahlen eines Kunden für einen Monat
export function auswerten(kunde, posts, monat, drehs = []) {
  const jetzt = new Date()
  const mStart = new Date(monat.getFullYear(), monat.getMonth(), 1)
  const mEnde = new Date(monat.getFullYear(), monat.getMonth() + 1, 0, 23, 59, 59)
  const imMonat = posts.filter(p => { const d = alsDatum(p.datum); return d && d >= mStart && d <= mEnde })
  const online = imMonat.filter(p => p.status === 'online' || p.status === 'teilweise')
  const fehler = imMonat.filter(p => p.status === 'fehler')
  const geplant = imMonat.filter(p => p.status === 'geplant' && alsDatum(p.datum) >= jetzt)
  const verpasst = imMonat.filter(p => p.status === 'geplant' && alsDatum(p.datum) < jetzt)   // Termin vorbei, aber nicht online
  const offenAlle = posts.filter(p => p.status === 'geplant' && alsDatum(p.datum) >= new Date(jetzt.getTime() - 86400000))
  const freigabeOffen = offenAlle.filter(p => p.freigabe === 'pending')
  const abgelehnt = offenAlle.filter(p => p.freigabe === 'rejected')
  const vorlauf = kunde.freigabe_vorlauf_tage ?? 3
  const grenze = new Date(jetzt.getTime() + vorlauf * 86400000)
  const dringend = freigabeOffen.filter(p => alsDatum(p.datum) <= grenze)
  const ziel = kunde.videos_pro_monat ?? null
  const summe = online.length + geplant.length
  const reichtBis = offenAlle.map(p => alsDatum(p.datum)).sort((a, b) => b - a)[0] || null
  const heute = tagKey(jetzt)
  const naechsterDreh = drehs.filter(d => d.kunde_id === kunde.id && d.datum && d.datum >= heute && d.status !== 'abgeschlossen')
    .sort((a, b) => a.datum.localeCompare(b.datum))[0] || null
  const inProduktion = drehs.filter(d => d.kunde_id === kunde.id && ['cutting', 'posting'].includes(d.status))
    .reduce((s, d) => s + (Array.isArray(d.videos) ? d.videos.filter(v => !v.erledigt).length : 0), 0)
  return {
    imMonat, online, geplant, fehler, verpasst, freigabeOffen, abgelehnt, dringend,
    ziel, summe, fehlt: ziel != null ? Math.max(0, ziel - summe) : null, ueber: ziel != null ? Math.max(0, summe - ziel) : 0,
    reichtBis, naechsterDreh, inProduktion, vorlauf,
  }
}

// Ampel für eine Kundenkarte
export function ampel(a) {
  if (a.dringend.length || a.fehler.length || a.verpasst.length || a.abgelehnt.length) return 'rot'
  if (a.freigabeOffen.length || (a.fehlt != null && a.fehlt > 0)) return 'gelb'
  return 'gruen'
}

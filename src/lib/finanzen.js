// Finanz-Logik des Chefbereichs (nachgebaut aus Felix' „Finanzen.numbers“)
import { supabase } from './supabase'

export const eur = (n, nachkomma = 0) => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: nachkomma, maximumFractionDigits: nachkomma })
export const BEREICHE = [
  { id: 'einnahme', label: 'Einnahmen', hinweis: 'Monatliche Einnahmen (netto, ohne USt.)' },
  { id: 'business', label: 'Business-Ausgaben', hinweis: 'Fixkosten Business – netto zählt' },
  { id: 'lohn', label: 'Lohnkosten', hinweis: 'Brutto-Lohnkosten pro Monat' },
  { id: 'privat', label: 'Privat-Fixkosten', hinweis: 'Private monatliche Kosten' },
  { id: 'invest', label: 'Festes Invest', hinweis: 'Monatliche Sparraten / Investments' },
]
export { monatlich, steuerJahr, firmenwagenVorteil, planRechnung } from './finanzRechnung'

// Lexware-Sync (läuft in Etappen, bis alle Netto-Beträge da sind)
export async function lexwareSync(jahr, onFortschritt) {
  const { data: { session } } = await supabase.auth.getSession()
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`/api/lexoffice?aktion=sync&jahr=${jahr}`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
    let body = null
    try { body = await r.json() } catch { /* leer */ }
    if (!r.ok) { const e = new Error(body?.fehler || `Fehler ${r.status}`); e.code = body?.fehler; throw e }
    onFortschritt?.(body)
    if (!body.offen) return body
  }
  return null
}
export async function lexwareUeberfaellig() {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch('/api/lexoffice?aktion=ueberfaellig', { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(body?.fehler || `Fehler ${r.status}`)
  return body.ueberfaellig || []
}

// Lexware-Kontaktname ↔ OS-Kunde
const norm = s => String(s || '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9äöü ]+/g, ' ')
  .replace(/\b(gmbh|co|kg|mbh|ag|ug|ohg|gbr|e ?k|inh|haftungsbeschränkt)\b/g, ' ').replace(/\s+/g, ' ').trim()
export function kundeFuer(kontakt, kunden) {
  const k = norm(kontakt)
  if (!k) return null
  let best = null
  for (const ku of kunden) {
    const n = norm(ku.name)
    if (!n) continue
    if (k.includes(n) || n.includes(k)) return ku
    const kern = n.split(' ').filter(w => w.length >= 4 && !['auto', 'autohaus'].includes(w)).sort((a, b) => b.length - a.length)[0]
    if (kern && k.includes(kern.replace(/-/g, ' ')) || (kern && k.replace(/ /g, '').includes(kern.replace(/-/g, '')))) best = best || ku
  }
  return best
}
export const zaehlt = b => !['draft', 'voided'].includes(b.status)

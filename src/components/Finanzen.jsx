// Finanzen im Chefbereich (nur Admin): Live-Daten aus Lexware Office + Stunden aus der Zeiterfassung.
// Beträge sind BRUTTO (so liefert die Belegliste von Lexware). Der Steuer-Rechner folgt mit Felix' Excel-Logik.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const GRUEN = '#34c759', ROT = '#ff3b30', LILA = '#7c3aed', ORANGE = '#ff6b01'
const eur = n => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

async function lexoffice(jahr) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(`/api/lexoffice?jahr=${jahr}`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
  let body = null
  try { body = await r.json() } catch { /* leer */ }
  if (!r.ok) { const e = new Error(body?.fehler || `Fehler ${r.status}`); e.code = body?.fehler; throw e }
  return body
}

// Lexware-Kontaktname ↔ OS-Kunde (z. B. „Autohaus Westkamp GmbH & Co. KG“ ↔ „Autohaus Westkamp“)
const norm = s => String(s || '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9äöü ]+/g, ' ')
  .replace(/\b(gmbh|co|kg|mbh|ag|ug|ohg|gbr|e ?k|inh|haftungsbeschränkt)\b/g, ' ').replace(/\s+/g, ' ').trim()
function kundeFuer(kontakt, kunden) {
  const k = norm(kontakt)
  if (!k) return null
  let best = null
  for (const ku of kunden) {
    const n = norm(ku.name)
    if (!n) continue
    if (k.includes(n) || n.includes(k)) return ku
    const kern = n.split(' ').filter(w => w.length >= 4 && !['auto', 'autohaus'].includes(w)).sort((a, b) => b.length - a.length)[0]
    if (kern && k.includes(kern)) best = best || ku
  }
  return best
}

export default function Finanzen() {
  const [jahr, setJahr] = useState(new Date().getFullYear())
  const [daten, setDaten] = useState(null)
  const [kunden, setKunden] = useState([])
  const [stunden, setStunden] = useState({})
  const [stundenAb, setStundenAb] = useState(null)
  const [laden, setLaden] = useState(true)
  const [fehler, setFehler] = useState(null)

  useEffect(() => { laden_() /* eslint-disable-next-line */ }, [jahr])
  async function laden_() {
    setLaden(true); setFehler(null)
    try {
      const [lx, k, z, m] = await Promise.all([
        lexoffice(jahr),
        supabase.from('proj_kunden').select('id, name'),
        supabase.from('zeiteintraege').select('kunde_id, stunden, datum').gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`).not('kunde_id', 'is', null),
        supabase.from('minijob_stunden').select('kunde_id, stunden, status, datum').gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`).not('kunde_id', 'is', null),
      ])
      const h = {}
      const zeilen = [...(z.data || []), ...(m.data || []).filter(x => x.status !== 'abgelehnt')]
      for (const r of zeilen) h[r.kunde_id] = (h[r.kunde_id] || 0) + Number(r.stunden || 0)
      // € pro Stunde nur für den Zeitraum, in dem Stunden mit Kunde gebucht wurden (sonst Jahresumsatz ÷ wenige Monate Stunden)
      const ab = zeilen.map(r => r.datum).sort()[0] || null
      setDaten(lx); setKunden(k.data || []); setStunden(h); setStundenAb(ab)
    } catch (e) { setFehler(e.code === 'LEXOFFICE_KEY_FEHLT' ? 'In Vercel fehlt der Lexware-Schlüssel (LEXOFFICE_API_KEY).' : e.message) }
    setLaden(false)
  }

  const a = useMemo(() => {
    if (!daten) return null
    const proMonat = MONATE.map(() => ({ ein: 0, aus: 0 }))
    let ein = 0, aus = 0, offen = 0
    const proKunde = new Map()
    for (const b of daten.belege) {
      const m = Number(b.datum.slice(5, 7)) - 1
      if (b.art === 'einnahme') {
        ein += b.betrag; if (m >= 0) proMonat[m].ein += b.betrag
        if (b.offen) offen += b.offen
        const ku = kundeFuer(b.kontakt, kunden)
        const key = ku ? ku.id : `x:${b.kontakt}`
        const e = proKunde.get(key) || { name: ku?.name || b.kontakt, kundeId: ku?.id || null, umsatz: 0, umsatzZeitraum: 0 }
        e.umsatz += b.betrag
        if (stundenAb && b.datum >= stundenAb) e.umsatzZeitraum += b.betrag
        proKunde.set(key, e)
      } else { aus += b.betrag; if (m >= 0) proMonat[m].aus += b.betrag }
    }
    const kundenListe = [...proKunde.values()].map(k => {
      const h = k.kundeId ? (stunden[k.kundeId] || 0) : 0
      return { ...k, stunden: h, proStunde: h > 0 ? k.umsatzZeitraum / h : null }
    }).sort((x, y) => y.umsatz - x.umsatz)
    return { ein, aus, ergebnis: ein - aus, offen, proMonat, kundenListe }
  }, [daten, kunden, stunden, stundenAb])

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h2 className="text-[17px] font-semibold text-ink tracking-tight">Finanzen</h2>
        <div className="flex items-center gap-1.5">
          <button className="btn-icon" onClick={() => setJahr(j => j - 1)}>‹</button>
          <span className="text-[15px] font-semibold text-ink tabular-nums w-12 text-center">{jahr}</span>
          <button className="btn-icon" onClick={() => setJahr(j => j + 1)} disabled={jahr >= new Date().getFullYear()}>›</button>
          <button className="btn-secondary !py-1.5 !px-3 text-xs ml-1" onClick={laden_} disabled={laden}>{laden ? '…' : '↻'}</button>
        </div>
      </div>
      <p className="text-xs text-ink-2 mb-4">Live aus Lexware Office · Beträge brutto{daten ? ` · Stand ${new Date(daten.abgerufen).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>

      {fehler ? (
        <div className="rounded-2xl px-4 py-3 text-xs bg-[#ff3b30]/10 text-[#d70015]">Lexware konnte nicht geladen werden: {fehler}</div>
      ) : laden || !a ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-[2.5px] border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[['Einnahmen', a.ein, GRUEN], ['Ausgaben', a.aus, ROT], ['Ergebnis', a.ergebnis, LILA], ['Noch offen', a.offen, ORANGE]].map(([l, w, f]) => (
              <div key={l} className="rounded-2xl bg-white/70 border border-white px-3.5 py-3">
                <p className="text-[11px] text-ink-2 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: f }} />{l}</p>
                <p className={`text-[20px] font-bold tracking-tight leading-tight mt-0.5 tabular-nums ${l === 'Ergebnis' && w < 0 ? 'text-[#d70015]' : 'text-ink'}`}>{eur(w)}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[20px] bg-white/70 border border-white p-3.5">
            <p className="text-[13px] font-semibold text-ink mb-2">Monatsverlauf {jahr}</p>
            <MonatsGrafik proMonat={a.proMonat} jahr={jahr} />
            <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-ink-2">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: GRUEN }} />Einnahmen</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ROT }} />Ausgaben</span>
              <span className="flex items-center gap-1"><span className="w-3 h-[3px] rounded" style={{ background: LILA }} />Ergebnis je Monat</span>
            </div>
          </div>

          <div className="rounded-[20px] bg-white/70 border border-white overflow-hidden">
            <div className="px-3.5 pt-3 pb-2 flex items-baseline justify-between gap-2">
              <p className="text-[13px] font-semibold text-ink">Umsatz & Stunden pro Kunde</p>
              <p className="text-[11px] text-ink-3">{stundenAb ? `€/Std. = Umsatz seit ${new Date(stundenAb + 'T12:00').toLocaleDateString('de-DE')} ÷ gebuchte Stunden` : 'Noch keine Stunden mit Kunde gebucht'}</p>
            </div>
            <div className="table-scroll">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead><tr className="text-[11px] text-ink-3 uppercase tracking-wider">
                  <th className="text-left font-semibold px-3.5 py-1.5">Kunde</th><th className="text-right font-semibold px-2 py-1.5">Umsatz</th>
                  <th className="text-right font-semibold px-2 py-1.5">Stunden</th><th className="text-right font-semibold px-3.5 py-1.5">€ / Std.</th>
                </tr></thead>
                <tbody>
                  {a.kundenListe.map(k => (
                    <tr key={k.name} className="border-t border-black/[0.05]">
                      <td className="px-3.5 py-2 text-ink">{k.name}{!k.kundeId && <span className="text-[10px] text-ink-3 ml-1.5">(kein OS-Kunde)</span>}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink">{eur(k.umsatz)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-2">{k.stunden ? k.stunden.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–'}</td>
                      <td className="px-3.5 py-2 text-right tabular-nums font-semibold" style={{ color: k.proStunde == null ? undefined : k.proStunde >= 60 ? '#248a3d' : k.proStunde >= 35 ? '#9a5b00' : '#d70015' }}>
                        {k.proStunde == null ? '–' : eur(k.proStunde)}
                      </td>
                    </tr>
                  ))}
                  {a.kundenListe.length === 0 && <tr><td colSpan="4" className="px-3.5 py-6 text-center text-ink-3">Keine Einnahmen in {jahr}.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-ink-3 -mt-2 px-1">Hinweis: € pro Stunde stimmt nur, wenn alle Arbeitszeit mit Kunde gebucht wird. Minijob-Stunden haben bisher keinen Kunden, intern gebuchte Zeit zählt nicht.</p>

          {daten.ueberfaellig.length > 0 && (
            <div className="rounded-[20px] bg-[#ff3b30]/[0.06] border border-[#ff3b30]/15 p-3.5">
              <p className="text-[13px] font-semibold text-[#d70015] mb-2">Überfällige Rechnungen</p>
              <div className="space-y-1">
                {daten.ueberfaellig.map(b => (
                  <div key={b.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-ink truncate">{b.kontakt}{b.nummer ? ` · ${b.nummer}` : ''}</span>
                    <span className="text-ink-2 whitespace-nowrap tabular-nums">fällig {b.faellig ? new Date(b.faellig + 'T12:00').toLocaleDateString('de-DE') : '–'} · <b className="text-[#d70015]">{eur(b.offen ?? b.betrag)}</b></span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-ink-3">Nächster Schritt: Steuer-Rechner (vor/nach Steuern) nach deiner Excel-Logik und KI-Auswertung.</p>
        </div>
      )}
    </div>
  )
}

function MonatsGrafik({ proMonat, jahr }) {
  const W = 640, H = 200, P = { l: 52, r: 8, t: 10, b: 22 }
  const max = Math.max(1, ...proMonat.flatMap(m => [m.ein, m.aus]))
  const min = Math.min(0, ...proMonat.map(m => m.ein - m.aus))
  const y = v => P.t + (max - v) / (max - min) * (H - P.t - P.b)
  const bw = (W - P.l - P.r) / 12
  const heute = new Date()
  const bisMonat = jahr === heute.getFullYear() ? heute.getMonth() : 11
  const linie = proMonat.slice(0, bisMonat + 1).map((m, i) => `${i ? 'L' : 'M'}${(P.l + bw * i + bw / 2).toFixed(1)},${y(m.ein - m.aus).toFixed(1)}`).join(' ')
  const ticks = [max, max / 2, 0, ...(min < 0 ? [min] : [])]
  const k = v => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Einnahmen und Ausgaben pro Monat">
      {ticks.map((t, i) => <g key={i}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.06)'} /><text x={P.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#a1a1a6">{k(t)} €</text></g>)}
      {proMonat.map((m, i) => {
        const x = P.l + bw * i
        return (
          <g key={i}>
            <rect x={x + bw * 0.14} y={y(m.ein)} width={bw * 0.34} height={Math.max(0, y(0) - y(m.ein))} rx="3" fill={GRUEN} opacity={i > bisMonat ? 0.3 : 0.9}><title>{MONATE[i]}: Einnahmen {eur(m.ein)}</title></rect>
            <rect x={x + bw * 0.52} y={y(m.aus)} width={bw * 0.34} height={Math.max(0, y(0) - y(m.aus))} rx="3" fill={ROT} opacity={i > bisMonat ? 0.3 : 0.85}><title>{MONATE[i]}: Ausgaben {eur(m.aus)}</title></rect>
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#a1a1a6">{MONATE[i]}</text>
          </g>
        )
      })}
      <path d={linie} fill="none" stroke={LILA} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {proMonat.slice(0, bisMonat + 1).map((m, i) => <circle key={i} cx={P.l + bw * i + bw / 2} cy={y(m.ein - m.aus)} r="3" fill="#fff" stroke={LILA} strokeWidth="2"><title>{MONATE[i]}: Ergebnis {eur(m.ein - m.aus)}</title></circle>)}
    </svg>
  )
}

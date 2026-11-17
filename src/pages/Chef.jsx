import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { BEREICHE, monatlich, planRechnung, monatsRechnung, steuerOptionen, ausgabenArt, lexwareSync, lexwareUeberfaellig, kundeFuer, zaehlt, eur } from '../lib/finanzen'

// Chefbereich – nur Admin (Route adminOnly + RLS auf allen Chef-/Finanz-Tabellen) und zusätzlich mit Passwort gesperrt:
// nach dem Entsperren bleibt er offen, bis man länger als 3 Minuten weg ist (Tab im Hintergrund oder andere Seite).
// Aufbau: Startseite mit zwei großen Kacheln → „Finanzen“ (Plan vs. Lexware, Kunden, Stundensatz, Posten, Einstellungen)
// und „Team & Erinnerungen“ (wiederkehrende Erinnerungen pro Monat/Halbjahr abhaken).

const SPERRE_MS = 3 * 60 * 1000
let entsperrt = false, wegSeit = null
const istGesperrt = () => !entsperrt || (wegSeit && Date.now() - wegSeit > SPERRE_MS)

const FIN_TABS = [['uebersicht', 'Plan & Ist'], ['kunden', 'Kunden'], ['stundensatz', 'Stundensatz'], ['posten', 'Posten'], ['einstellungen', 'Einstellungen']]
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const MONATE_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const merk = (k, d) => { try { return sessionStorage.getItem(k) || d } catch { return d } }
const speicher = (k, v) => { try { sessionStorage.setItem(k, v) } catch { /* egal */ } }

export default function Chef() {
  const { isAdmin, profile } = useAuth()
  const [gesperrt, setGesperrt] = useState(istGesperrt())
  const [bereich, setBereich] = useState(() => merk('os-chef-bereich', 'start'))
  const [tab, setTab] = useState(() => { const t = merk('os-chef-tab', 'uebersicht'); return FIN_TABS.some(x => x[0] === t) ? t : 'uebersicht' })
  useEffect(() => speicher('os-chef-bereich', bereich), [bereich])
  useEffect(() => speicher('os-chef-tab', tab), [tab])

  // Sperre: Tab im Hintergrund oder Seite verlassen → Zeit merken; nach > 3 Min. wieder Passwort
  useEffect(() => {
    if (wegSeit && Date.now() - wegSeit > SPERRE_MS) { entsperrt = false; setGesperrt(true) }
    wegSeit = null
    const onVis = () => {
      if (document.visibilityState === 'hidden') wegSeit = Date.now()
      else { if (wegSeit && Date.now() - wegSeit > SPERRE_MS) { entsperrt = false; setGesperrt(true) } wegSeit = null }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); wegSeit = Date.now() }
  }, [])

  if (!isAdmin) return <div className="p-6 text-center text-sm text-ink-3">Kein Zugriff.</div>
  if (gesperrt) return <Sperre email={profile?.email} onOk={() => { entsperrt = true; wegSeit = null; setGesperrt(false) }} />

  const titel = bereich === 'finanzen' ? 'Finanzen' : bereich === 'team' ? 'Team & Erinnerungen' : 'Chefbereich'
  return (
    <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8 space-y-5 max-w-5xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          {bereich !== 'start' && <button onClick={() => setBereich('start')} className="text-[13px] font-medium text-[#ff6b01] mb-1 hover:opacity-70">‹ Chefbereich</button>}
          <h1 className="page-title">{titel}</h1>
          <p className="text-[13px] text-ink-2 mt-1.5 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/[0.06] text-ink">🔒 Nur für dich</span>
            sperrt sich nach 3 Min. Abwesenheit
          </p>
        </div>
        <button onClick={() => { entsperrt = false; setGesperrt(true) }} className="btn-secondary !py-1.5 !px-3 text-xs">🔒 Sperren</button>
      </div>
      {bereich === 'start' && <Start onOpen={setBereich} />}
      {bereich === 'finanzen' && (
        <>
          <div className="seg overflow-x-auto max-w-full">
            {FIN_TABS.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`seg-btn ${tab === id ? 'is-active' : ''}`}>{l}</button>)}
          </div>
          {tab === 'uebersicht' && <PlanIst />}
          {tab === 'kunden' && <Kunden />}
          {tab === 'stundensatz' && <Stundensatz />}
          {tab === 'posten' && <Posten />}
          {tab === 'einstellungen' && <Einstellungen />}
        </>
      )}
      {bereich === 'team' && <Erinnerungen />}
    </div>
  )
}

// ── Startseite: zwei große Kacheln ───────────────────────────
function Start({ onOpen }) {
  const { posten, einst, laden } = useFinanzDaten()
  const [ist, setIst] = useState(null)
  const [erin, setErin] = useState(null)
  useEffect(() => {
    const j = new Date().getFullYear()
    // Ø pro abgeschlossenem Monat dieses Jahres (Lohn kommt aus den Posten, Finanzamt/Krankenkassen zählen nicht als Betriebskosten)
    const n = Math.max(1, new Date().getMonth())
    const bis = `${j}-${String(n + 1).padStart(2, '0')}-01`
    supabase.from('os_finanz_belege').select('art, status, netto, brutto, kontakt').gte('datum', `${j}-01-01`).lt('datum', bis)
      .then(({ data }) => {
        let ein = 0, aus = 0
        for (const b of data || []) { if (!zaehlt(b)) continue; if (b.art === 'einnahme') ein += nettoVon(b); else if (ausgabenArt(b.kontakt) === 'betrieb') aus += nettoVon(b) }
        setIst({ ein: ein / n, aus: aus / n, jahr: j, bisMonat: MONATE[n - 1] })
      })
    supabase.rpc('chef_erinnerungen_pruefen').then(() => supabase.from('os_chef_erinnerungen').select('*').eq('aktiv', true).order('naechster_termin')).then(({ data }) => setErin(data || []))
  }, [])
  const plan = !laden && einst ? planRechnung(posten, einst) : null
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <button onClick={() => onOpen('finanzen')} className="tile !rounded-[28px] p-6 text-left w-full min-h-[220px] flex flex-col fade-up">
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl text-white shadow-sm" style={{ background: 'linear-gradient(135deg,#34c759,#38b6ff)' }}>€</span>
          <div><p className="text-[22px] font-bold text-ink tracking-tight leading-tight">Finanzen</p><p className="text-xs text-ink-2">Plan & Lexware · Kunden · Stundensatz</p></div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-auto pt-5">
          <div className="rounded-2xl bg-white/70 border border-white p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">Theoretisch</p>
            <p className="text-[19px] font-bold tabular-nums text-ink mt-0.5">{plan ? eur(plan.gewinn) : '…'}</p>
            <p className="text-[11px] text-ink-2">Gewinn / Monat laut Plan</p>
          </div>
          <div className="rounded-2xl bg-white/70 border border-white p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">Praktisch</p>
            <p className="text-[19px] font-bold tabular-nums text-ink mt-0.5">{ist && plan ? eur(ist.ein - ist.aus - plan.lohn) : '…'}</p>
            <p className="text-[11px] text-ink-2">Ø Gewinn / Monat laut Lexware (Jan–{ist?.bisMonat ?? ''})</p>
          </div>
        </div>
      </button>
      <button onClick={() => onOpen('team')} className="tile !rounded-[28px] p-6 text-left w-full min-h-[220px] flex flex-col fade-up">
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-sm" style={{ background: 'linear-gradient(135deg,#ff6b01,#7c3aed)' }}>🎉</span>
          <div><p className="text-[22px] font-bold text-ink tracking-tight leading-tight">Team & Erinnerungen</p><p className="text-xs text-ink-2">Firmenessen, Hausparty … abhaken</p></div>
        </div>
        <div className="mt-auto pt-5 space-y-1.5">
          {!erin ? <p className="text-xs text-ink-3">…</p> : erin.length === 0 ? <p className="text-xs text-ink-3">Keine aktiven Erinnerungen.</p> : erin.map(e => {
            const st = periodeStatus(e)
            return (
              <div key={e.id} className="rounded-2xl bg-white/70 border border-white px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink truncate">{e.titel}</span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${st.offen ? 'bg-[#ff9f0a]/15 text-[#9a5b00]' : 'bg-[#34c759]/12 text-[#248a3d]'}`}>{st.kurz}</span>
              </div>
            )
          })}
        </div>
      </button>
    </div>
  )
}

function Sperre({ email, onOk }) {
  const [pw, setPw] = useState(''), [fehler, setFehler] = useState(''), [busy, setBusy] = useState(false)
  async function pruefen(e) {
    e.preventDefault(); setBusy(true); setFehler('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    setBusy(false); setPw('')
    if (error) setFehler('Passwort falsch.'); else onOk()
  }
  return (
    <div className="px-4 pt-16 md:pt-24 flex justify-center">
      <form onSubmit={pruefen} className="glass rounded-[28px] p-6 w-full max-w-sm text-center fade-up">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-black/[0.06] flex items-center justify-center text-2xl mb-4">🔒</div>
        <h1 className="text-[20px] font-bold text-ink tracking-tight">Chefbereich</h1>
        <p className="text-[13px] text-ink-2 mt-1 mb-5">Bitte mit deinem OS-Passwort entsperren.</p>
        <input type="password" autoFocus className="input text-center" placeholder="Passwort" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" />
        {fehler && <p className="text-xs text-[#d70015] mt-2">{fehler}</p>}
        <button type="submit" disabled={!pw || busy} className="btn-primary w-full !py-3 mt-3 disabled:opacity-40">{busy ? 'Prüft…' : 'Entsperren'}</button>
      </form>
    </div>
  )
}

// ── gemeinsame Daten ─────────────────────────────────────────
function useFinanzDaten() {
  const [d, setD] = useState({ posten: [], einst: null, kunden: [], laden: true })
  const laden = async () => {
    const [p, e, k] = await Promise.all([
      supabase.from('os_finanz_posten').select('*').order('bereich').order('position').order('name'),
      supabase.from('os_finanz_einstellungen').select('*').eq('id', 1).maybeSingle(),
      supabase.from('proj_kunden').select('id, name').order('name'),
    ])
    setD({ posten: p.data || [], einst: e.data, kunden: k.data || [], laden: false })
  }
  useEffect(() => { laden() }, [])
  return { ...d, neuLaden: laden }
}
const Lader = () => <div className="flex justify-center py-12"><div className="w-6 h-6 border-[2.5px] border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>
function Zeile({ l, w, ton, fett, klein }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 ${klein ? 'py-1.5' : 'py-2.5'} ${fett ? 'bg-white/50' : ''}`}>
      <span className={`text-[13px] ${fett ? 'font-semibold text-ink' : 'text-ink-2'}`}>{l}</span>
      <span className={`text-[14px] tabular-nums ${fett ? 'font-bold' : 'font-medium'}`} style={{ color: ton === 'plus' ? '#248a3d' : ton === 'minus' ? '#d70015' : undefined }}>{w}</span>
    </div>
  )
}
function Kachel({ l, w, f }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] text-ink-2 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: f }} />{l}</p>
      <p className="text-[21px] font-bold tracking-tight text-ink tabular-nums mt-0.5">{eur(w)}</p>
    </div>
  )
}

// ── Lexware-Belege (Netto-Cache) + Abgleich ──────────────────
// Lädt das Jahr UND das Vorjahr (für „Geldeingang“: Rechnung im Dezember, bezahlt im Januar)
function useBelege(jahr) {
  const [belege, setBelege] = useState(null)
  const [sync, setSync] = useState({ laeuft: false, info: null, fehler: null })
  const laden = async () => {
    const alle = []
    for (let von = 0; ; von += 1000) {
      const { data } = await supabase.from('os_finanz_belege').select('*').gte('datum', `${jahr - 1}-01-01`).lte('datum', `${jahr}-12-31`).order('datum').range(von, von + 999)
      alle.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    setBelege(alle)
  }
  const synchron = async () => {
    setSync({ laeuft: true, info: null, fehler: null })
    try {
      await lexwareSync(jahr, info => setSync(s => ({ ...s, info: { ...info, jahr } })))
      await laden()
      // Vorjahr mit abgleichen (Rechnungen aus dem Dezember, die erst im Januar bezahlt wurden) – nach dem ersten Mal in Sekunden erledigt
      await lexwareSync(jahr - 1, info => setSync(s => ({ ...s, info: { ...info, jahr: jahr - 1 } })))
      await laden(); setSync(s => ({ ...s, laeuft: false }))
    }
    catch (e) { setSync({ laeuft: false, info: null, fehler: e.code === 'LEXOFFICE_KEY_FEHLT' ? 'In Vercel fehlt der Lexware-Schlüssel.' : e.message }) }
  }
  useEffect(() => { setBelege(null); laden().then(synchron) /* eslint-disable-next-line */ }, [jahr])
  return { belege, sync, synchron }
}
function SyncZeile({ sync, synchron }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-ink-2">
      <span>
        {sync.laeuft ? `Lexware wird abgeglichen… ${sync.info ? `${sync.info.jahr}: ${sync.info.gesamt - sync.info.offen} von ${sync.info.gesamt} Belegen` : ''}`
          : sync.fehler ? <span className="text-[#d70015]">Lexware: {sync.fehler}</span>
          : 'Netto-Beträge aus Lexware · aktuell'}
      </span>
      <button className="btn-secondary !py-1.5 !px-3 text-xs" disabled={sync.laeuft} onClick={synchron}>{sync.laeuft ? '…' : '↻ Abgleichen'}</button>
    </div>
  )
}
function JahrWahl({ jahr, setJahr }) {
  return (
    <div className="flex items-center gap-1.5">
      <button className="btn-icon" onClick={() => setJahr(j => j - 1)}>‹</button>
      <span className="text-[15px] font-semibold text-ink tabular-nums w-12 text-center">{jahr}</span>
      <button className="btn-icon" onClick={() => setJahr(j => j + 1)} disabled={jahr >= new Date().getFullYear()}>›</button>
    </div>
  )
}
const nettoVon = b => b.netto != null ? Number(b.netto) : Number(b.brutto) / 1.19
// Welches Datum zählt: Rechnungsdatum oder Tag des Geldeingangs/-ausgangs
const belegDatum = (b, basis) => basis === 'zahlung' ? b.bezahlt_am : b.datum

function useEinstellung(key, start) {
  const [v, setV] = useState(() => { try { const x = localStorage.getItem(key); return x == null ? start : JSON.parse(x) } catch { return start } })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* egal */ } }, [key, v])
  return [v, setV]
}

// Ist-Monate aus Lexware: Einnahmen, Betriebsausgaben, Sozialversicherung, Finanzamt (keine Betriebskosten), Lohn
function istMonate(belege, jahr, basis, lohnAusPosten, lohnPlan) {
  const m = MONATE.map(() => ({ ein: 0, betrieb: 0, sozial: 0, fa: 0, lohn: 0 }))
  for (const b of belege) {
    const d = belegDatum(b, basis)
    if (!zaehlt(b) || !d || Number(d.slice(0, 4)) !== jahr) continue
    const i = Number(d.slice(5, 7)) - 1, n = nettoVon(b)
    if (b.art === 'einnahme') m[i].ein += n
    else { const art = ausgabenArt(b.kontakt); m[i][art === 'finanzamt' ? 'fa' : art] += n }
  }
  const heute = new Date()
  const bis = jahr === heute.getFullYear() ? heute.getMonth() : 11          // bis zu diesem Monat anzeigen
  const voll = jahr === heute.getFullYear() ? Math.max(0, heute.getMonth() - 1) : 11   // letzter abgeschlossener Monat
  m.forEach((x, i) => {
    x.lohn = i > bis ? 0 : lohnAusPosten ? lohnPlan : x.sozial
    x.aus = x.betrieb + x.lohn
    x.gewinn = x.ein - x.aus
  })
  return { m, bis, voll }
}

// ── Plan (theoretisch) vs. Ist (praktisch, Lexware) ──────────
function PlanIst() {
  const [jahr, setJahr] = useState(new Date().getFullYear())
  const { belege, sync, synchron } = useBelege(jahr)
  const { posten, einst, laden } = useFinanzDaten()
  const [basis, setBasis] = useEinstellung('os-chef-basis', 'rechnung')
  const [lohnAusPosten, setLohnAusPosten] = useEinstellung('os-chef-lohnposten', true)
  const [zeitraum, setZeitraum] = useState('schnitt')     // 'schnitt' oder Monatsindex
  const [ueber, setUeber] = useState(null)
  useEffect(() => { lexwareUeberfaellig().then(setUeber).catch(() => setUeber([])) }, [])

  const plan = useMemo(() => (!laden && einst ? planRechnung(posten, einst) : null), [posten, einst, laden])
  const ist = useMemo(() => {
    if (!belege || !plan) return null
    const a = istMonate(belege, jahr, basis, lohnAusPosten, plan.lohn)
    const auswahl = zeitraum === 'schnitt' ? a.m.slice(0, a.voll + 1) : [a.m[zeitraum]]
    const n = Math.max(1, auswahl.length)
    const s = k => auswahl.reduce((x, y) => x + y[k], 0) / n
    const r = monatsRechnung({ umsatz: s('ein'), business: s('betrieb'), lohn: s('lohn'), privat: plan.privat, invest: plan.invest }, einst)
    const jahrSumme = k => a.m.slice(0, a.bis + 1).reduce((x, y) => x + y[k], 0)
    return { ...a, r, fa: s('fa'), faJahr: jahrSumme('fa'), sozial: s('sozial'),
      label: zeitraum === 'schnitt' ? `Ø ${a.voll === 0 ? MONATE[0] : `Jan–${MONATE[a.voll]}`} ${jahr}` : `${MONATE_LANG[zeitraum]} ${jahr}` }
  }, [belege, plan, jahr, basis, lohnAusPosten, zeitraum, einst])

  if (laden || !plan) return <Lader />
  const zeilen = [
    ['Umsatz (netto)', 'umsatz', +1, true],
    ['Business-Ausgaben (netto)', 'business', -1],
    ['Lohnkosten', 'lohn', -1],
    ['Gewinn vor Steuer', 'gewinn', +1, true],
    ['Steuer-Rücklage', 'ruecklage', -1],
    ['Nettogewinn', 'nettogewinn', +1, true],
    ['Privat-Fixkosten', 'privat', -1, false, true],
    ['Festes Invest', 'invest', -1, false, true],
    ['Übrig nach allem', 'ueberschussNachInvest', +1, true],
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <JahrWahl jahr={jahr} setJahr={j => { setJahr(j); setZeitraum('schnitt') }} />
        <div className="seg">
          <button className={`seg-btn ${basis === 'rechnung' ? 'is-active' : ''}`} onClick={() => setBasis('rechnung')}>Nach Rechnungsdatum</button>
          <button className={`seg-btn ${basis === 'zahlung' ? 'is-active' : ''}`} onClick={() => setBasis('zahlung')}>Nach Geldeingang</button>
        </div>
        <select className="input !w-auto !py-1.5 text-sm" value={zeitraum} onChange={e => setZeitraum(e.target.value === 'schnitt' ? 'schnitt' : Number(e.target.value))}>
          <option value="schnitt">Ø pro Monat (abgeschlossene Monate)</option>
          {MONATE_LANG.map((l, i) => (ist && i <= ist.bis) && <option key={i} value={i}>{l} {jahr}</option>)}
        </select>
      </div>
      <SyncZeile sync={sync} synchron={synchron} />

      <div className="grid md:grid-cols-2 gap-4">
        <Seite titel="Theoretisch" unter="Plan aus deinen Posten · pro Monat" farbe="#7c3aed" r={plan} />
        {ist ? <Seite titel="Praktisch" unter={`Lexware · ${ist.label}${basis === 'zahlung' ? ' · Geldeingang' : ''}`} farbe="#34c759" r={ist.r} /> : <div className="card"><Lader /></div>}
      </div>

      <div className="card overflow-hidden">
        <div className="table-scroll">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead><tr className="text-[10.5px] text-ink-3 uppercase tracking-wider">
              <th className="text-left font-semibold px-4 py-2">pro Monat</th>
              <th className="text-right font-semibold px-3">Theoretisch</th>
              <th className="text-right font-semibold px-3">Praktisch</th>
              <th className="text-right font-semibold px-4">Differenz</th>
            </tr></thead>
            <tbody>
              {zeilen.map(([l, k, richtung, fett, ausPlan]) => {
                const p = plan[k], i = ist?.r[k], d = i == null ? null : i - p
                const gut = d == null || Math.abs(d) < 1 ? null : d * richtung > 0
                return (
                  <tr key={k} className={`border-t border-black/[0.05] ${fett ? 'bg-white/50 font-semibold' : ''}`}>
                    <td className="px-4 py-2 text-ink">{l}</td>
                    <td className="px-3 text-right tabular-nums">{eur(p)}</td>
                    <td className="px-3 text-right tabular-nums">{i == null ? '…' : ausPlan ? <span className="text-ink-3">wie Plan</span> : eur(i)}</td>
                    <td className="px-4 text-right tabular-nums font-semibold" style={{ color: gut == null ? '#a1a1a6' : gut ? '#248a3d' : '#d70015' }}>{d == null || ausPlan ? '' : `${d > 0 ? '+' : ''}${eur(d)}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-black/[0.05] space-y-2">
          <label className="flex items-start gap-2 text-xs text-ink-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={lohnAusPosten} onChange={e => setLohnAusPosten(e.target.checked)} />
            <span>Lohnkosten im „Praktisch“ aus deinen Posten nehmen (empfohlen) – in Lexware stehen nur Krankenkassen/Knappschaft ({eur(ist?.sozial ?? 0)} Ø/Monat), nicht die Netto-Löhne selbst.</span>
          </label>
          {ist && <p className="text-[11.5px] text-ink-2">Nicht als Kosten gezählt: Überweisungen ans <b>Finanzamt</b> (USt-Vorauszahlungen, Lohnsteuer, Steuer-Vorauszahlungen) – {eur(ist.fa)} Ø/Monat, {eur(ist.faJahr)} in {jahr}.</p>}
        </div>
      </div>

      {ist && (
        <div className="card p-4">
          <p className="text-[15px] font-semibold text-ink mb-2">Monatsverlauf {jahr} (netto{basis === 'zahlung' ? ', nach Geldeingang' : ''})</p>
          <MonatsGrafik m={ist.m} bis={ist.bis} planUmsatz={plan.umsatz} planGewinn={plan.gewinn} />
        </div>
      )}

      <SteuerKarte r={plan} einst={einst} />

      {ueber && ueber.length > 0 && (
        <div className="card p-4">
          <p className="text-[15px] font-semibold text-[#d70015] mb-2">Überfällige Rechnungen</p>
          <div className="space-y-1">
            {ueber.map(b => (
              <div key={b.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-ink truncate">{b.kontakt}{b.nummer ? ` · ${b.nummer}` : ''}</span>
                <span className="text-ink-2 whitespace-nowrap tabular-nums">fällig {b.faellig ? new Date(b.faellig + 'T12:00').toLocaleDateString('de-DE') : '–'} · <b className="text-[#d70015]">{eur(b.offen)}</b> offen</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Seite({ titel, unter, farbe, r }) {
  return (
    <div className="card p-5 relative overflow-hidden">
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-[0.12]" style={{ background: farbe }} />
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: farbe }}>{titel}</p>
      <p className="text-xs text-ink-2 mb-3">{unter}</p>
      <div className="grid grid-cols-3 gap-2">
        {[['Umsatz', r.umsatz], ['Gewinn v. St.', r.gewinn], ['Übrig', r.ueberschussNachInvest]].map(([l, w]) => (
          <div key={l}><p className="text-[11px] text-ink-2">{l}</p><p className="text-[18px] md:text-[20px] font-bold tracking-tight tabular-nums text-ink">{eur(w)}</p></div>
        ))}
      </div>
      <p className="text-[11px] text-ink-3 mt-2">Marge {(r.marge * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % · Steuer-Rücklage {eur(r.ruecklage)}/Monat</p>
    </div>
  )
}

// ── Steuer: echter Tarif 2026 vs. deine Excel-Bänder ─────────
function SteuerKarte({ r, einst }) {
  const o = steuerOptionen(einst), e = r.steuer.echt, b = r.steuer.baender
  const diff = b.steuer - e.gesamt
  const fw = einst?.firmenwagen || {}
  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <p className="text-[15px] font-semibold text-ink">Steuer aufs Jahr (Plan)</p>
        <p className="text-xs text-ink-2">Gerechnet wird mit: <b>{o.modus === 'baender' ? 'deinen Excel-Bändern' : 'echtem Tarif 2026'}</b> (umstellbar unter Einstellungen)</p>
      </div>
      <div className="divide-y divide-black/[0.05]">
        <Zeile l={`Zu versteuernder Gewinn (Gewinn × 12${r.vorteil ? ' + Firmenwagen' : ''})`} w={eur(r.gewinnJahrSteuer)} />
        {o.abzuege > 0 && <Zeile l="− Abzüge (Kranken-/Rentenversicherung u. a.)" w={eur(o.abzuege)} klein />}
        <Zeile l="Einkommensteuer (Tarif 2026, ledig)" w={eur(e.estTarif)} klein />
        <Zeile l="− Anrechnung Gewerbesteuer (§ 35)" w={'− ' + eur(e.anrechnung)} klein />
        <Zeile l="Solidaritätszuschlag" w={eur(e.soli)} klein />
        {e.kist > 0 && <Zeile l={`Kirchensteuer (${o.kirche} %)`} w={eur(e.kist)} klein />}
        <Zeile l={`Gewerbesteuer (Hebesatz ${o.hebesatz} %)`} w={eur(e.gewst)} klein />
        <Zeile l="Steuer gesamt (echt)" w={eur(e.gesamt)} fett ton="minus" />
        <Zeile l="Ø-Steuersatz · jeder weitere Euro" w={`${(e.quote * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % · ${(e.grenzsatz * 100).toLocaleString('de-DE', { maximumFractionDigits: 0 })} %`} klein />
      </div>
      <div className={`px-4 py-3 text-[12px] leading-relaxed ${Math.abs(diff) > 500 ? 'bg-[#ff9f0a]/10' : 'bg-[#34c759]/10'}`}>
        <b className="text-ink">Deine Excel-Bänder:</b> {eur(b.steuer)} – das sind {eur(Math.abs(diff))} {diff < 0 ? 'weniger' : 'mehr'} als der echte Tarif
        {diff < 0 ? ' (die Bänder unterschätzen vor allem Soli und Spitzensatz).' : '.'} Mit {einst?.sicherheit_prozent ?? 10} % Sicherheit legst du {eur(r.ruecklage)} pro Monat zurück.
      </div>
      {fw.aktiv && (
        <p className="px-4 py-3 text-[11.5px] text-ink-2 border-t border-black/[0.05] leading-relaxed">
          <b className="text-ink">Firmenwagen {fw.name}:</b> {String(fw.prozent).replace('.', ',')} % von {eur(fw.listenpreis)} = {eur(r.vorteil, 2)}/Monat – erhöht nur den zu versteuernden Gewinn, kein Geld auf dem Konto.
        </p>
      )}
    </div>
  )
}

function MonatsGrafik({ m, bis, planUmsatz, planGewinn }) {
  const W = 640, H = 220, P = { l: 52, r: 8, t: 10, b: 22 }
  const max = Math.max(1, planUmsatz || 0, ...m.flatMap(x => [x.ein, x.aus]))
  const min = Math.min(0, ...m.slice(0, bis + 1).map(x => x.gewinn))
  const y = v => P.t + (max - v) / (max - min) * (H - P.t - P.b)
  const bw = (W - P.l - P.r) / 12
  const k = v => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)
  const linie = m.slice(0, bis + 1).map((x, i) => `${i ? 'L' : 'M'}${(P.l + bw * i + bw / 2).toFixed(1)},${y(x.gewinn).toFixed(1)}`).join(' ')
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Einnahmen, Ausgaben und Gewinn pro Monat">
        {[max, max / 2, 0, ...(min < 0 ? [min] : [])].map((t, i) => <g key={i}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.06)'} /><text x={P.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#a1a1a6">{k(t)} €</text></g>)}
        {m.map((x, i) => {
          const xx = P.l + bw * i, blass = i > bis ? 0.25 : 0.9
          return (
            <g key={i}>
              <rect x={xx + bw * 0.14} y={y(x.ein)} width={bw * 0.34} height={Math.max(0, y(0) - y(x.ein))} rx="3" fill="#34c759" opacity={blass}><title>{MONATE[i]}: Einnahmen {eur(x.ein)}</title></rect>
              <rect x={xx + bw * 0.52} y={y(x.aus)} width={bw * 0.34} height={Math.max(0, y(0) - y(x.aus))} rx="3" fill="#ff3b30" opacity={blass * 0.9}><title>{MONATE[i]}: Ausgaben {eur(x.betrieb)} + Löhne {eur(x.lohn)}</title></rect>
              <text x={xx + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#a1a1a6">{MONATE[i]}</text>
            </g>
          )
        })}
        {planUmsatz > 0 && <line x1={P.l} x2={W - P.r} y1={y(planUmsatz)} y2={y(planUmsatz)} stroke="#34c759" strokeWidth="1.5" strokeDasharray="5 4"><title>Plan-Umsatz {eur(planUmsatz)}</title></line>}
        {planGewinn != null && <line x1={P.l} x2={W - P.r} y1={y(planGewinn)} y2={y(planGewinn)} stroke="#7c3aed" strokeWidth="1.5" strokeDasharray="5 4"><title>Plan-Gewinn {eur(planGewinn)}</title></line>}
        <path d={linie} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {m.slice(0, bis + 1).map((x, i) => <circle key={i} cx={P.l + bw * i + bw / 2} cy={y(x.gewinn)} r="3" fill="#fff" stroke="#7c3aed" strokeWidth="2"><title>{MONATE[i]}: Gewinn {eur(x.gewinn)}</title></circle>)}
      </svg>
      <div className="flex flex-wrap gap-3 text-[11px] text-ink-2">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#34c759]" />Einnahmen</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#ff3b30]" />Ausgaben + Löhne</span>
        <span className="flex items-center gap-1"><span className="w-3 h-[3px] rounded bg-[#7c3aed]" />Gewinn</span>
        <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-[#34c759]" />Plan-Umsatz</span>
        <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-[#7c3aed]" />Plan-Gewinn</span>
      </div>
    </>
  )
}

// ── Kunden: Plan (Posten) vs. Ist (Lexware) ──────────────────
function Kunden() {
  const [jahr, setJahr] = useState(new Date().getFullYear())
  const { belege, sync, synchron } = useBelege(jahr)
  const { posten, kunden, laden } = useFinanzDaten()
  const [basis] = useEinstellung('os-chef-basis', 'rechnung')
  const t = useMemo(() => {
    if (!belege || laden) return null
    const heute = new Date()
    const voll = jahr === heute.getFullYear() ? Math.max(0, heute.getMonth() - 1) : 11
    const letzte3 = [Math.max(0, voll - 2), voll]
    const rows = new Map()
    const ein = posten.filter(p => p.bereich === 'einnahme')
    // Suchnamen: Posten-Name + ggf. verknüpfter OS-Kunde
    const such = []
    for (const p of ein) {
      rows.set('p' + p.id, { name: p.name, plan: p.aktiv ? monatlich(p) : 0, inaktiv: !p.aktiv, jahr: 0, l3: 0, monate: Array(12).fill(0) })
      such.push({ name: p.name, key: 'p' + p.id })
      const k = p.kunde_id && kunden.find(x => x.id === p.kunde_id)
      if (k) such.push({ name: k.name, key: 'p' + p.id })
    }
    for (const b of belege) {
      const d = belegDatum(b, basis)
      if (b.art !== 'einnahme' || !zaehlt(b) || !d || Number(d.slice(0, 4)) !== jahr) continue
      const treffer = kundeFuer(b.kontakt, such)
      const key = treffer ? treffer.key : 'k' + (b.kontakt || '?')
      if (!rows.has(key)) rows.set(key, { name: b.kontakt || 'Unbekannt', plan: 0, ohnePlan: true, jahr: 0, l3: 0, monate: Array(12).fill(0) })
      const r = rows.get(key), i = Number(d.slice(5, 7)) - 1, n = nettoVon(b)
      r.jahr += n; r.monate[i] += n
      if (i >= letzte3[0] && i <= letzte3[1]) r.l3 += n
    }
    const n3 = letzte3[1] - letzte3[0] + 1
    const liste = [...rows.values()].map(r => ({ ...r, l3: r.l3 / n3, schnitt: r.monate.slice(0, voll + 1).reduce((a, b) => a + b, 0) / (voll + 1) }))
      .filter(r => r.plan || r.jahr).sort((a, b) => (b.plan - a.plan) || (b.jahr - a.jahr))
    return { liste, letzte3, voll, summe: { plan: liste.reduce((s, r) => s + r.plan, 0), l3: liste.reduce((s, r) => s + r.l3, 0), jahr: liste.reduce((s, r) => s + r.jahr, 0) } }
  }, [belege, posten, kunden, laden, jahr, basis])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap"><JahrWahl jahr={jahr} setJahr={setJahr} /><div className="flex-1 min-w-[200px]"><SyncZeile sync={sync} synchron={synchron} /></div></div>
      {!t ? <Lader /> : (
        <div className="card overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="text-[15px] font-semibold text-ink">Umsatz pro Kunde – theoretisch vs. praktisch</p>
            <p className="text-xs text-ink-2">Netto · Plan aus deinen Einnahmen-Posten · Ist aus Lexware ({basis === 'zahlung' ? 'nach Geldeingang' : 'nach Rechnungsdatum'}), Ø der letzten 3 abgeschlossenen Monate ({MONATE[t.letzte3[0]]}–{MONATE[t.letzte3[1]]})</p>
          </div>
          <div className="table-scroll">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead><tr className="text-[10.5px] text-ink-3 uppercase tracking-wider">
                <th className="text-left font-semibold px-4 py-2">Kunde</th>
                <th className="text-right font-semibold px-3">Plan / Monat</th>
                <th className="text-right font-semibold px-3">Ist Ø 3 Mon.</th>
                <th className="text-right font-semibold px-3">Differenz</th>
                <th className="text-right font-semibold px-4">Ist {jahr} gesamt</th>
              </tr></thead>
              <tbody>
                {t.liste.map(r => {
                  const d = r.l3 - r.plan
                  return (
                    <tr key={r.name} className={`border-t border-black/[0.05] ${r.inaktiv ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-2 text-ink">
                        <span className="font-medium">{r.name}</span>
                        {r.ohnePlan && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-black/[0.05] text-ink-3">nicht im Plan</span>}
                        {r.plan > 0 && r.jahr === 0 && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#ff9f0a]/15 text-[#9a5b00]">keine Rechnung in Lexware gefunden</span>}
                      </td>
                      <td className="px-3 text-right tabular-nums">{r.plan ? eur(r.plan) : '–'}</td>
                      <td className="px-3 text-right tabular-nums">{eur(r.l3)}</td>
                      <td className="px-3 text-right tabular-nums font-semibold" style={{ color: Math.abs(d) < 1 ? '#a1a1a6' : d > 0 ? '#248a3d' : '#d70015' }}>{Math.abs(d) < 1 ? '±0' : `${d > 0 ? '+' : ''}${eur(d)}`}</td>
                      <td className="px-4 text-right tabular-nums text-ink-2">{eur(r.jahr)}</td>
                    </tr>
                  )
                })}
                <tr className="border-t border-black/[0.1] bg-white/50 font-semibold">
                  <td className="px-4 py-2">Summe</td>
                  <td className="px-3 text-right tabular-nums">{eur(t.summe.plan)}</td>
                  <td className="px-3 text-right tabular-nums">{eur(t.summe.l3)}</td>
                  <td className="px-3 text-right tabular-nums" style={{ color: t.summe.l3 >= t.summe.plan ? '#248a3d' : '#d70015' }}>{`${t.summe.l3 - t.summe.plan > 0 ? '+' : ''}${eur(t.summe.l3 - t.summe.plan)}`}</td>
                  <td className="px-4 text-right tabular-nums">{eur(t.summe.jahr)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-[11px] text-ink-3 border-t border-black/[0.05]">Zuordnung über den Namen in Lexware. Passt etwas nicht, im Posten den OS-Kunden verknüpfen oder den Posten-Namen an den Lexware-Kontakt angleichen.</p>
        </div>
      )}
    </div>
  )
}

// ── Stundensatz pro Kunde und Monat (ab September 2026) ──────
const START = '2026-09-01'
function Stundensatz() {
  const jahr = new Date().getFullYear()
  const { belege, sync, synchron } = useBelege(jahr)
  const [z, setZ] = useState(null)
  useEffect(() => {
    (async () => {
      const [k, ze, mj, sp, dr, ek] = await Promise.all([
        supabase.from('proj_kunden').select('id, name').order('name'),
        supabase.from('zeiteintraege').select('kunde_id, stunden, datum').gte('datum', START).not('kunde_id', 'is', null),
        supabase.from('minijob_stunden').select('user_id, kunde_id, dreh_id, stunden, datum, status').gte('datum', START),
        supabase.from('spesen').select('dreh_id, betrag, datum').gte('datum', START),
        supabase.from('proj_drehs').select('id, kunde_id'),
        supabase.from('extern_kunden').select('user_id, kunde_id'),
      ])
      setZ({ kunden: k.data || [], ze: ze.data || [], mj: mj.data || [], sp: sp.data || [], dr: dr.data || [], ek: ek.data || [] })
    })()
  }, [])

  const t = useMemo(() => {
    if (!z || !belege) return null
    const drehKunde = new Map(z.dr.map(d => [d.id, d.kunde_id]))
    const einzigerKunde = {}
    for (const e of z.ek) einzigerKunde[e.user_id] = einzigerKunde[e.user_id] === undefined ? e.kunde_id : null   // nur eindeutig zugeordnete Darsteller
    const heute = new Date()
    const monate = []
    for (let d = new Date(2026, 8, 1); d <= heute; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) monate.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    const tab = new Map(z.kunden.map(k => [k.id, { kunde: k, m: Object.fromEntries(monate.map(mo => [mo, { umsatz: 0, stunden: 0, fahrt: 0 }])) }]))
    const add = (kid, mo, feld, wert) => { const r = tab.get(kid); if (r && r.m[mo]) r.m[mo][feld] += wert }
    let ohneKunde = 0
    for (const b of belege) {
      if (b.art !== 'einnahme' || !zaehlt(b) || !b.datum || b.datum < START) continue
      const ku = kundeFuer(b.kontakt, z.kunden)
      if (ku) add(ku.id, b.datum.slice(0, 7), 'umsatz', nettoVon(b))
    }
    for (const r of z.ze) add(r.kunde_id, r.datum.slice(0, 7), 'stunden', Number(r.stunden || 0))
    for (const r of z.mj) {
      if (r.status === 'abgelehnt') continue
      const kid = r.kunde_id || (r.dreh_id && drehKunde.get(r.dreh_id)) || einzigerKunde[r.user_id]
      if (kid) add(kid, r.datum.slice(0, 7), 'stunden', Number(r.stunden || 0)); else ohneKunde += Number(r.stunden || 0)
    }
    for (const r of z.sp) { const kid = r.dreh_id && drehKunde.get(r.dreh_id); if (kid) add(kid, r.datum.slice(0, 7), 'fahrt', Number(r.betrag || 0)) }
    const zeilen = [...tab.values()].filter(r => monate.some(mo => r.m[mo].umsatz || r.m[mo].stunden)).sort((a, b) => a.kunde.name.localeCompare(b.kunde.name))
    return { monate, zeilen, ohneKunde }
  }, [z, belege])

  const farbe = v => v == null ? undefined : v >= 60 ? '#248a3d' : v >= 35 ? '#9a5b00' : '#d70015'
  return (
    <div className="space-y-4">
      <SyncZeile sync={sync} synchron={synchron} belege={belege} />
      {!t ? <Lader /> : (
        <div className="card overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="text-[15px] font-semibold text-ink">Stundensatz pro Kunde und Monat</p>
            <p className="text-xs text-ink-2">Ab September 2026 · (Umsatz netto aus Lexware − Fahrtkosten) ÷ gebuchte Stunden (Zeiterfassung + Minijob)</p>
          </div>
          <div className="table-scroll">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead><tr className="text-[10.5px] text-ink-3 uppercase tracking-wider">
                <th className="text-left font-semibold px-4 py-1.5">Kunde</th>
                {t.monate.map(mo => <th key={mo} className="text-right font-semibold px-3 py-1.5">{MONATE[Number(mo.slice(5)) - 1]} {mo.slice(2, 4)}</th>)}
              </tr></thead>
              <tbody>
                {t.zeilen.map(r => (
                  <tr key={r.kunde.id} className="border-t border-black/[0.05] align-top">
                    <td className="px-4 py-2 font-medium text-ink">{r.kunde.name}</td>
                    {t.monate.map(mo => {
                      const c = r.m[mo], satz = c.stunden > 0 ? (c.umsatz - c.fahrt) / c.stunden : null
                      return (
                        <td key={mo} className="px-3 py-2 text-right tabular-nums">
                          <div className="font-semibold" style={{ color: farbe(satz) }}>{satz == null ? '–' : eur(satz) + '/h'}</div>
                          <div className="text-[10.5px] text-ink-3">{eur(c.umsatz)} · {c.stunden.toLocaleString('de-DE', { maximumFractionDigits: 1 })} h{c.fahrt ? ` · −${eur(c.fahrt)} Fahrt` : ''}</div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-[11px] text-ink-3 border-t border-black/[0.05]">
            Grün ab 60 €/h, gelb ab 35 €/h, darunter rot.
            {t.ohneKunde > 0 && <> Noch {t.ohneKunde.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Minijob-Stunden ohne Kunde/Dreh – ab jetzt wählt Maurice in „Meine Stunden“ den Dreh aus.</>}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Posten (Excel-Listen, im OS bearbeitbar) ─────────────────
function Posten() {
  const { posten, kunden, laden, neuLaden } = useFinanzDaten()
  const [bearbeiten, setBearbeiten] = useState(null)
  async function speichern(f) {
    const zahl = v => Number(String(v ?? '').replace(',', '.')) || 0
    const row = { bereich: f.bereich, name: f.name.trim(), betrag: zahl(f.betrag),
      betrag_brutto: f.bereich === 'business' && String(f.betrag_brutto ?? '') !== '' ? zahl(f.betrag_brutto) : null,
      rhythmus: f.rhythmus, konto: f.konto || null, kunde_id: f.kunde_id || null, aktiv: !!f.aktiv, updated_at: new Date().toISOString() }
    const { error } = f.id ? await supabase.from('os_finanz_posten').update(row).eq('id', f.id) : await supabase.from('os_finanz_posten').insert({ ...row, position: 999 })
    if (error) { alert('Speichern fehlgeschlagen: ' + error.message); return }
    setBearbeiten(null); neuLaden()
  }
  async function loeschen(p) {
    if (!window.confirm(`„${p.name}“ löschen?\n\nLandet im Papierkorb.`)) return
    await supabase.from('os_finanz_posten').delete().eq('id', p.id); setBearbeiten(null); neuLaden()
  }
  if (laden) return <Lader />
  return (
    <div className="space-y-4">
      {BEREICHE.map(b => {
        const liste = posten.filter(p => p.bereich === b.id)
        const summe = liste.filter(p => p.aktiv).reduce((s, p) => s + monatlich(p), 0)
        return (
          <div key={b.id} className="card overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-3">
              <div><p className="text-[15px] font-semibold text-ink">{b.label}</p><p className="text-[11px] text-ink-3">{b.hinweis}</p></div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold tabular-nums text-ink">{eur(summe, 2)}<span className="text-[11px] font-medium text-ink-3"> /Monat</span></span>
                <button onClick={() => setBearbeiten({ bereich: b.id, rhythmus: 'monatlich', aktiv: true, betrag: '', betrag_brutto: '' })} className="btn-icon" title="Hinzufügen">＋</button>
              </div>
            </div>
            <div className="divide-y divide-black/[0.05]">
              {liste.map(p => (
                <button key={p.id} onClick={() => setBearbeiten(p)} className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left hover:bg-white/50 ${p.aktiv ? '' : 'opacity-40'}`}>
                  <span className="text-[13px] text-ink truncate">{p.name}{p.rhythmus === 'jaehrlich' && <span className="text-[10.5px] text-ink-3 ml-1.5">jährlich</span>}{p.konto && <span className="text-[10.5px] text-ink-3 ml-1.5">· {p.konto}</span>}</span>
                  <span className="text-[13px] tabular-nums text-ink-2 whitespace-nowrap">
                    {b.id === 'business' && p.betrag_brutto != null && <span className="text-[10.5px] text-ink-3 mr-2">brutto {eur(p.betrag_brutto, 2)}</span>}
                    {eur(p.betrag, 2)}{p.rhythmus === 'jaehrlich' ? ' /Jahr' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {bearbeiten && <PostenFormular start={bearbeiten} kunden={kunden} onSave={speichern} onDelete={loeschen} onClose={() => setBearbeiten(null)} />}
    </div>
  )
}
function Blatt({ titel, onClose, children }) {
  return (
    <div className="fixed inset-0 scrim z-[70] flex items-end sm:items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className="glass-strong rounded-[28px] w-full max-w-md max-h-[90vh] overflow-y-auto pop-in p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[17px] font-semibold text-ink tracking-tight">{titel}</h3>
          <button onClick={onClose} className="btn-icon w-7 h-7 text-base leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
function PostenFormular({ start, kunden, onSave, onDelete, onClose }) {
  const [f, setF] = useState({ ...start, betrag: start.betrag ?? '', betrag_brutto: start.betrag_brutto ?? '', konto: start.konto || '', kunde_id: start.kunde_id || '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const bereich = BEREICHE.find(b => b.id === f.bereich)
  return (
    <Blatt titel={`${f.id ? 'Bearbeiten' : 'Neu'} · ${bereich?.label}`} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Bezeichnung</label><input autoFocus className="input" value={f.name || ''} onChange={e => set('name', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">{f.bereich === 'business' ? 'Netto €' : 'Betrag €'}</label><input inputMode="decimal" className="input" value={f.betrag} onChange={e => set('betrag', e.target.value)} /></div>
          {f.bereich === 'business'
            ? <div><label className="label">Brutto € (optional)</label><input inputMode="decimal" className="input" value={f.betrag_brutto} onChange={e => set('betrag_brutto', e.target.value)} /></div>
            : <div><label className="label">Wie oft</label><select className="input" value={f.rhythmus} onChange={e => set('rhythmus', e.target.value)}><option value="monatlich">monatlich</option><option value="jaehrlich">jährlich</option></select></div>}
        </div>
        {f.bereich === 'business' && <div><label className="label">Wie oft</label><select className="input" value={f.rhythmus} onChange={e => set('rhythmus', e.target.value)}><option value="monatlich">monatlich</option><option value="jaehrlich">jährlich (Betrag = Jahresbetrag)</option></select></div>}
        {f.bereich === 'einnahme'
          ? <div><label className="label">Kunde im OS (optional)</label><select className="input" value={f.kunde_id} onChange={e => set('kunde_id', e.target.value)}><option value="">—</option>{kunden.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></div>
          : <div><label className="label">Abbuchungskonto</label><input className="input" value={f.konto} onChange={e => set('konto', e.target.value)} placeholder="z. B. N26, AMEX, C24" /></div>}
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!f.aktiv} onChange={e => set('aktiv', e.target.checked)} /> zählt mit (aktiv)</label>
        <div className="flex gap-2 pt-1">
          {f.id && <button onClick={() => onDelete(start)} className="btn-secondary !text-[#ff3b30]">Löschen</button>}
          <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          <button onClick={() => f.name?.trim() && onSave(f)} disabled={!f.name?.trim()} className="btn-primary flex-1 disabled:opacity-40">Speichern</button>
        </div>
      </div>
    </Blatt>
  )
}

// ── Team & Erinnerungen (pro Zeitraum: Monat, Quartal, Halbjahr, Jahr) ──
const RHYTHMUS = [['monatlich', 'Jeden Monat'], ['quartalsweise', 'Jedes Quartal'], ['halbjaehrlich', 'Jedes halbe Jahr'], ['jaehrlich', 'Jedes Jahr'], ['woechentlich', 'Jede Woche']]
const rhythmusText = r => RHYTHMUS.find(x => x[0] === r)?.[1] || r
const MONATE_ZAHL = { monatlich: 1, quartalsweise: 3, halbjaehrlich: 6, jaehrlich: 12 }
const isoTag = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const alsDatum = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
function terminWeiter(start, r) {
  const d = alsDatum(start)
  return r === 'woechentlich' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7) : new Date(d.getFullYear(), d.getMonth() + MONATE_ZAHL[r], 1)
}
const periodeEnde = (start, r) => { const n = terminWeiter(start, r); return new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1) }
function periodeText(start, r) {
  const a = alsDatum(start), e = periodeEnde(start, r)
  if (r === 'monatlich') return `${MONATE_LANG[a.getMonth()]} ${a.getFullYear()}`
  if (r === 'woechentlich') return `Woche ab ${a.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`
  if (r === 'jaehrlich' && a.getMonth() === 0) return String(a.getFullYear())
  return `${MONATE[a.getMonth()]}${a.getFullYear() !== e.getFullYear() ? ' ' + a.getFullYear() : ''}–${MONATE[e.getMonth()]} ${e.getFullYear()}`
}
// Vorheriger Zeitraum (für „✓ November erledigt“)
function vorherStart(start, r) {
  const d = alsDatum(start)
  return isoTag(r === 'woechentlich' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7) : new Date(d.getFullYear(), d.getMonth() - MONATE_ZAHL[r], 1))
}
// Status des laufenden Zeitraums
function periodeStatus(e) {
  const heute = new Date(); heute.setHours(0, 0, 0, 0)
  const start = alsDatum(e.naechster_termin)
  if (start <= heute) {
    const ende = periodeEnde(e.naechster_termin, e.rhythmus)
    const tage = Math.round((ende - heute) / 86400000)
    return { offen: true, zeitraum: periodeText(e.naechster_termin, e.rhythmus), ende, tage,
      kurz: `${periodeText(e.naechster_termin, e.rhythmus).replace(/ \d{4}$/, '')} offen` }
  }
  const vorher = periodeText(vorherStart(e.naechster_termin, e.rhythmus), e.rhythmus)
  return { offen: false, zeitraum: vorher, naechster: periodeText(e.naechster_termin, e.rhythmus), start,
    kurz: e.zuletzt_erledigt ? `✓ ${vorher.replace(/ \d{4}$/, '')} erledigt` : `ab ${start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}` }
}

function Erinnerungen() {
  const [liste, setListe] = useState(null)
  const [bearbeiten, setBearbeiten] = useState(null)
  const laden = async () => {
    await supabase.rpc('chef_erinnerungen_pruefen')
    const { data } = await supabase.from('os_chef_erinnerungen').select('*').order('naechster_termin')
    setListe(data || [])
  }
  useEffect(() => { laden() }, [])
  async function erledigt(e) {
    const { error } = await supabase.rpc('chef_erinnerung_erledigt', { p_id: e.id })
    if (error) { alert(error.message); return }
    laden()
  }
  async function speichern(f) {
    const row = { titel: f.titel.trim(), notiz: f.notiz?.trim() || null, rhythmus: f.rhythmus, naechster_termin: f.naechster_termin, vorlauf_tage: 0, aktiv: f.aktiv, updated_at: new Date().toISOString() }
    const { error } = f.id ? await supabase.from('os_chef_erinnerungen').update(row).eq('id', f.id) : await supabase.from('os_chef_erinnerungen').insert(row)
    if (error) { alert('Speichern fehlgeschlagen: ' + error.message); return }
    setBearbeiten(null); laden()
  }
  async function aktivSchalten(e) {
    setListe(prev => prev.map(x => x.id === e.id ? { ...x, aktiv: !e.aktiv } : x))
    await supabase.from('os_chef_erinnerungen').update({ aktiv: !e.aktiv, updated_at: new Date().toISOString() }).eq('id', e.id)
  }
  async function loeschen(e) {
    if (!window.confirm(`Erinnerung „${e.titel}“ löschen?\n\nSie landet im Papierkorb.`)) return
    await supabase.from('os_chef_erinnerungen').delete().eq('id', e.id); setBearbeiten(null); laden()
  }
  if (!liste) return <Lader />
  const monatJetzt = isoTag(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-ink-2 max-w-xl">Jede Erinnerung gilt für einen Zeitraum (z. B. „November“ oder „Jan–Jun“). Ab dem 1. steht sie als Aufgabe auf deinem Dashboard, bis du sie abhakst – dann ist der nächste Zeitraum dran.</p>
        <button onClick={() => setBearbeiten({ rhythmus: 'monatlich', naechster_termin: monatJetzt, aktiv: true })} className="btn-primary text-xs !py-2 !px-4">＋ Erinnerung</button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {liste.map(e => {
          const st = periodeStatus(e)
          const a = alsDatum(e.naechster_termin)
          return (
            <div key={e.id} className={`card !rounded-[28px] p-5 flex flex-col gap-4 ${e.aktiv ? '' : 'opacity-50'}`}>
              <div className="flex items-start gap-3">
                <div className={`w-14 h-14 rounded-2xl flex-shrink-0 flex flex-col items-center justify-center ${st.offen ? 'bg-[#ff6b01]/12 text-[#c2410c]' : 'bg-[#34c759]/12 text-[#248a3d]'}`}>
                  <span className="text-[10px] font-bold uppercase leading-none">{st.offen ? 'jetzt' : 'nächst.'}</span>
                  <span className="text-[17px] font-bold leading-tight">{MONATE[a.getMonth()]}</span>
                </div>
                <button onClick={() => setBearbeiten(e)} className="flex-1 min-w-0 text-left">
                  <p className="text-[17px] font-semibold text-ink tracking-tight leading-snug">{e.titel}</p>
                  <span className="inline-block mt-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#7c3aed]/10 text-[#6d28d9]">{rhythmusText(e.rhythmus)}</span>
                  {e.notiz && <p className="text-xs text-ink-2 mt-1.5 line-clamp-2">{e.notiz}</p>}
                </button>
                <button onClick={() => aktivSchalten(e)} role="switch" aria-checked={e.aktiv} title={e.aktiv ? 'Pausieren' : 'Aktivieren'}
                  className={`relative inline-block w-[38px] h-[22px] rounded-full flex-shrink-0 transition-colors duration-300 ${e.aktiv ? 'bg-[#34c759]' : 'bg-black/[0.12]'}`}>
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform duration-300 ${e.aktiv ? 'translate-x-[16px]' : ''}`} />
                </button>
              </div>
              {st.offen ? (
                <div className="rounded-2xl bg-[#ff9f0a]/10 px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-semibold text-ink">{st.zeitraum}</p>
                    <p className="text-xs text-[#9a5b00]">noch offen · bis {st.ende.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ({st.tage <= 0 ? 'heute' : `${st.tage} Tage`})</p>
                  </div>
                  <button onClick={() => erledigt(e)} disabled={!e.aktiv} className="btn-primary !py-2 !px-4 text-sm whitespace-nowrap flex-shrink-0 disabled:opacity-40">✓ Erledigt</button>
                </div>
              ) : (
                <div className="rounded-2xl bg-[#34c759]/10 px-4 py-3">
                  <p className="text-[14px] font-semibold text-[#248a3d]">{e.zuletzt_erledigt ? `✓ ${st.zeitraum} erledigt` : 'Noch nicht gestartet'}</p>
                  <p className="text-xs text-ink-2">Nächster Zeitraum: {st.naechster} · erscheint am {st.start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} auf dem Dashboard</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {liste.length === 0 && <p className="text-sm text-ink-3 py-6 text-center">Noch keine Erinnerungen.</p>}
      {bearbeiten && <ErinnerungFormular start={bearbeiten} onSave={speichern} onDelete={loeschen} onClose={() => setBearbeiten(null)} />}
    </div>
  )
}
function ErinnerungFormular({ start, onSave, onDelete, onClose }) {
  const [f, setF] = useState({ id: start.id, titel: start.titel || '', notiz: start.notiz || '', rhythmus: start.rhythmus || 'monatlich', naechster_termin: start.naechster_termin, aktiv: start.aktiv ?? true })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const ok = f.titel.trim() && f.naechster_termin
  const woche = f.rhythmus === 'woechentlich'
  return (
    <Blatt titel={f.id ? 'Erinnerung bearbeiten' : 'Neue Erinnerung'} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Woran erinnern?</label><input autoFocus className="input" value={f.titel} onChange={e => set('titel', e.target.value)} placeholder="z. B. Firmenessen mit dem Team" /></div>
        <div><label className="label">Notiz</label><textarea className="input" rows={2} value={f.notiz} onChange={e => set('notiz', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Wie oft</label><select className="input" value={f.rhythmus} onChange={e => set('rhythmus', e.target.value)}>{RHYTHMUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">{woche ? 'Ab Tag' : 'Ab Monat'}</label>
            {woche
              ? <input type="date" className="input" value={f.naechster_termin || ''} onChange={e => set('naechster_termin', e.target.value)} />
              : <input type="month" className="input" value={(f.naechster_termin || '').slice(0, 7)} onChange={e => set('naechster_termin', e.target.value ? e.target.value + '-01' : '')} />}
          </div>
        </div>
        {f.naechster_termin && <p className="text-xs text-ink-2">Erster Zeitraum: <b className="text-ink">{periodeText(woche ? f.naechster_termin : f.naechster_termin.slice(0, 7) + '-01', f.rhythmus)}</b> – erscheint ab dem {alsDatum(woche ? f.naechster_termin : f.naechster_termin.slice(0, 7) + '-01').toLocaleDateString('de-DE')} auf dem Dashboard.</p>}
        <div className="flex gap-2 pt-1">
          {f.id && <button onClick={() => onDelete(start)} className="btn-secondary !text-[#ff3b30]">Löschen</button>}
          <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          <button onClick={() => ok && onSave(f)} disabled={!ok} className="btn-primary flex-1 disabled:opacity-40">Speichern</button>
        </div>
      </div>
    </Blatt>
  )
}

// ── Einstellungen: Steuer, Sicherheit, Firmenwagen ───────────
function Einstellungen() {
  const { einst, laden, neuLaden } = useFinanzDaten()
  const [f, setF] = useState(null)
  const [gespeichert, setGespeichert] = useState(false)
  useEffect(() => { if (einst) setF({ baender: einst.steuerbaender, sicherheit: einst.sicherheit_prozent, fw: einst.firmenwagen || {}, st: steuerOptionen(einst) }) }, [einst])
  const zahl = v => Number(String(v ?? '').replace(',', '.')) || 0
  async function speichern() {
    const { error } = await supabase.from('os_finanz_einstellungen').update({
      steuerbaender: f.baender.map(b => ({ bis: b.bis === '' || b.bis == null ? null : zahl(b.bis), satz: zahl(b.satz) })),
      sicherheit_prozent: zahl(f.sicherheit),
      firmenwagen: { ...f.fw, listenpreis: zahl(f.fw.listenpreis), prozent: Number(f.fw.prozent) || 0 },
      steuer: { modus: f.st.modus, hebesatz: zahl(f.st.hebesatz), kirche: zahl(f.st.kirche), abzuege: zahl(f.st.abzuege) },
      updated_at: new Date().toISOString(),
    }).eq('id', 1)
    if (error) { alert(error.message); return }
    setGespeichert(true); setTimeout(() => setGespeichert(false), 2000); neuLaden()
  }
  if (laden || !f) return <Lader />
  const setB = (i, k, v) => setF(p => ({ ...p, baender: p.baender.map((b, j) => j === i ? { ...b, [k]: v } : b) }))
  const setFw = (k, v) => setF(p => ({ ...p, fw: { ...p.fw, [k]: v } }))
  const setSt = (k, v) => setF(p => ({ ...p, st: { ...p.st, [k]: v } }))
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <p className="text-[15px] font-semibold text-ink mb-1">Steuer-Rechnung</p>
        <p className="text-xs text-ink-2 mb-3">„Echter Tarif“ rechnet wie das Finanzamt 2026 (Einzelunternehmer, ledig): Einkommensteuer nach § 32a, Soli, ggf. Kirchensteuer und Gewerbesteuer abzüglich Anrechnung.</p>
        <div className="seg mb-4">
          <button className={`seg-btn ${f.st.modus === 'tarif' ? 'is-active' : ''}`} onClick={() => setSt('modus', 'tarif')}>Echter Tarif 2026</button>
          <button className={`seg-btn ${f.st.modus === 'baender' ? 'is-active' : ''}`} onClick={() => setSt('modus', 'baender')}>Meine Excel-Bänder</button>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div><label className="label">Gewerbesteuer-Hebesatz %</label><input inputMode="decimal" className="input" value={f.st.hebesatz} onChange={e => setSt('hebesatz', e.target.value)} /><p className="text-[10.5px] text-ink-3 mt-1">Köln: 475 %</p></div>
          <div><label className="label">Kirchensteuer</label>
            <select className="input" value={String(f.st.kirche)} onChange={e => setSt('kirche', e.target.value)}><option value="0">keine</option><option value="9">9 % (NRW)</option><option value="8">8 % (BY/BW)</option></select>
          </div>
          <div><label className="label">Abzüge pro Jahr €</label><input inputMode="decimal" className="input" value={f.st.abzuege} onChange={e => setSt('abzuege', e.target.value)} /><p className="text-[10.5px] text-ink-3 mt-1">Kranken-/Pflegeversicherung, Altersvorsorge u. a.</p></div>
        </div>
        <div className="flex items-center gap-2 mt-4"><span className="text-sm text-ink">Sicherheitsrücklage</span><input inputMode="decimal" className="input !py-1.5 !w-20 text-right" value={f.sicherheit} onChange={e => setF(p => ({ ...p, sicherheit: e.target.value }))} /><span className="text-xs text-ink-2">% auf die Steuer</span></div>
        <details className="mt-4">
          <summary className="text-[13px] font-semibold text-ink cursor-pointer">Meine Excel-Bänder (zum Vergleich)</summary>
          <p className="text-xs text-ink-2 my-2">Jeder Euro im Band wird mit dem Satz des Bandes versteuert. Leeres „bis“ = ohne Obergrenze.</p>
          <div className="space-y-2">
            {f.baender.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <span className="text-xs text-ink-2 tabular-nums">ab {eur(i === 0 ? 0 : f.baender[i - 1].bis)}</span>
                <input inputMode="decimal" className="input !py-1.5 text-sm" placeholder="bis (leer = ∞)" value={b.bis ?? ''} onChange={e => setB(i, 'bis', e.target.value)} />
                <div className="flex items-center gap-1"><input inputMode="decimal" className="input !py-1.5 text-sm !w-20 text-right" value={b.satz} onChange={e => setB(i, 'satz', e.target.value)} /><span className="text-xs text-ink-2">%</span></div>
              </div>
            ))}
          </div>
        </details>
      </div>
      <div className="card p-5">
        <p className="text-[15px] font-semibold text-ink mb-3">Firmenwagen (Privatnutzung)</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3"><label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!f.fw.aktiv} onChange={e => setFw('aktiv', e.target.checked)} /> Firmenwagen privat genutzt</label></div>
          <div><label className="label">Fahrzeug</label><input className="input" value={f.fw.name || ''} onChange={e => setFw('name', e.target.value)} /></div>
          <div><label className="label">Bruttolistenpreis €</label><input inputMode="decimal" className="input" value={f.fw.listenpreis ?? ''} onChange={e => setFw('listenpreis', e.target.value)} /></div>
          <div><label className="label">Regel</label>
            <select className="input" value={String(f.fw.prozent)} onChange={e => setFw('prozent', e.target.value)}>
              <option value="1">1 % (Verbrenner / Vollhybrid)</option>
              <option value="0.5">0,5 % (Plug-in-Hybrid)</option>
              <option value="0.25">0,25 % (Elektro)</option>
            </select>
          </div>
        </div>
        <p className="text-[11.5px] text-ink-2 mt-3 leading-relaxed">
          Die Privatnutzung erhöht nur den <b>zu versteuernden</b> Gewinn – es ist kein Geld, das reinkommt. Bitte vom Steuerberater bestätigen lassen: genauer Bruttolistenpreis (inkl. Sonderausstattung, abgerundet auf volle 100 €), ob der Tucson ein Plug-in-Hybrid ist (dann 0,5 %), und ob Fahrten Wohnung–Büro (0,03 %-Regel) sowie Umsatzsteuer auf die Privatnutzung dazukommen.
        </p>
      </div>
      <button onClick={speichern} className="btn-primary !px-6">{gespeichert ? '✓ Gespeichert' : 'Einstellungen speichern'}</button>
    </div>
  )
}

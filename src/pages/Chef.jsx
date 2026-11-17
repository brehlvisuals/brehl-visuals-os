import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { BEREICHE, monatlich, planRechnung, steuerJahr, lexwareSync, lexwareUeberfaellig, kundeFuer, zaehlt, eur, firmenwagenVorteil } from '../lib/finanzen'

// Chefbereich – nur Admin (Route adminOnly + RLS auf allen Chef-/Finanz-Tabellen) und zusätzlich mit Passwort gesperrt:
// nach dem Entsperren bleibt er offen, bis man länger als 3 Minuten weg ist (Tab im Hintergrund oder andere Seite).

const SPERRE_MS = 3 * 60 * 1000
let entsperrt = false, wegSeit = null
const istGesperrt = () => !entsperrt || (wegSeit && Date.now() - wegSeit > SPERRE_MS)

const TABS = [
  ['uebersicht', 'Übersicht'], ['ist', 'Ist-Zahlen'], ['stundensatz', 'Stundensatz'],
  ['posten', 'Posten'], ['erinnerungen', 'Erinnerungen'], ['einstellungen', 'Einstellungen'],
]
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export default function Chef() {
  const { isAdmin, profile } = useAuth()
  const [gesperrt, setGesperrt] = useState(istGesperrt())
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('os-chef-tab') || 'uebersicht' } catch { return 'uebersicht' } })
  useEffect(() => { try { sessionStorage.setItem('os-chef-tab', tab) } catch { /* egal */ } }, [tab])

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

  return (
    <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8 space-y-5 max-w-5xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Chefbereich</h1>
          <p className="text-[13px] text-ink-2 mt-1.5 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/[0.06] text-ink">🔒 Nur für dich</span>
            sperrt sich nach 3 Min. Abwesenheit
          </p>
        </div>
        <button onClick={() => { entsperrt = false; setGesperrt(true) }} className="btn-secondary !py-1.5 !px-3 text-xs">🔒 Sperren</button>
      </div>
      <div className="seg overflow-x-auto max-w-full">
        {TABS.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`seg-btn ${tab === id ? 'is-active' : ''}`}>{l}</button>)}
      </div>
      {tab === 'uebersicht' && <Uebersicht />}
      {tab === 'ist' && <IstZahlen />}
      {tab === 'stundensatz' && <Stundensatz />}
      {tab === 'posten' && <Posten />}
      {tab === 'erinnerungen' && <Erinnerungen />}
      {tab === 'einstellungen' && <Einstellungen />}
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

// ── Übersicht (Plan, wie die Excel) ──────────────────────────
function Uebersicht() {
  const { posten, einst, laden } = useFinanzDaten()
  if (laden) return <Lader />
  const r = planRechnung(posten, einst)
  const fw = einst?.firmenwagen || {}
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kachel l="Umsatz / Monat" w={r.umsatz} f="#34c759" />
        <Kachel l="Gewinn vor Steuer" w={r.gewinn} f="#7c3aed" />
        <Kachel l="Steuerrücklage" w={r.ruecklage} f="#ff3b30" />
        <Kachel l="Übrig nach allem" w={r.ueberschussNachInvest} f="#ff6b01" />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <p className="px-4 pt-4 pb-2 text-[15px] font-semibold text-ink">Monat (Plan aus deinen Posten)</p>
          <div className="divide-y divide-black/[0.05]">
            <Zeile l="Umsatz (netto)" w={eur(r.umsatz, 2)} ton="plus" />
            <Zeile l="Fixkosten Business (netto)" w={'− ' + eur(r.business, 2)} ton="minus" />
            <Zeile l="Lohnkosten" w={'− ' + eur(r.lohn, 2)} ton="minus" />
            <Zeile l="Gewinn vor Steuer" w={eur(r.gewinn, 2)} fett ton="plus" />
            <Zeile l="Marge" w={(r.marge * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %'} klein />
            <Zeile l={`Steuer (ESt + GewSt) + ${einst?.sicherheit_prozent ?? 10} % Sicherheit`} w={'− ' + eur(r.ruecklage, 2)} ton="minus" />
            <Zeile l="Nettogewinn" w={eur(r.nettogewinn, 2)} fett ton="plus" />
            <Zeile l="Privat-Fixkosten" w={'− ' + eur(r.privat, 2)} ton="minus" />
            <Zeile l="Überschuss vor Invest" w={eur(r.ueberschuss, 2)} fett />
            <Zeile l="Festes Invest" w={'− ' + eur(r.invest, 2)} ton="minus" />
            <Zeile l="Überschuss nach Invest" w={eur(r.ueberschussNachInvest, 2)} fett ton="plus" />
          </div>
        </div>
        <div className="card overflow-hidden">
          <p className="px-4 pt-4 pb-1 text-[15px] font-semibold text-ink">Steuer-Bänder (Jahr)</p>
          <p className="px-4 pb-2 text-xs text-ink-2">Zu versteuern: {eur(r.gewinnJahrSteuer)} = (Gewinn{r.vorteil ? ` + ${eur(r.vorteil, 2)} Firmenwagen` : ''}) × 12</p>
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-[10.5px] text-ink-3 uppercase tracking-wider"><th className="text-left font-semibold px-4 py-1">Von – bis</th><th className="text-right font-semibold px-2">Satz</th><th className="text-right font-semibold px-2">Betrag</th><th className="text-right font-semibold px-4">Steuer</th></tr></thead>
            <tbody>
              {r.steuerZeilen.map((z, i) => (
                <tr key={i} className={`border-t border-black/[0.05] ${z.betrag ? '' : 'opacity-40'}`}>
                  <td className="px-4 py-1.5 tabular-nums">{eur(z.von)} – {z.bis == null ? '∞' : eur(z.bis)}</td>
                  <td className="px-2 text-right tabular-nums">{z.satz} %</td>
                  <td className="px-2 text-right tabular-nums">{eur(z.betrag)}</td>
                  <td className="px-4 text-right tabular-nums">{eur(z.steuer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="divide-y divide-black/[0.05] border-t border-black/[0.08] mt-1">
            <Zeile l="Steuer Jahr" w={eur(r.steuerJahr, 2)} fett ton="minus" />
            <Zeile l="Steuer Monat" w={eur(r.steuerMonat, 2)} ton="minus" />
          </div>
          {fw.aktiv && (
            <p className="px-4 py-3 text-[11.5px] text-ink-2 bg-[#ff9f0a]/10 leading-relaxed">
              <b className="text-ink">Firmenwagen {fw.name}:</b> Privatnutzung {String(fw.prozent).replace('.', ',')} % von {eur(fw.listenpreis)} Listenpreis = {eur(r.vorteil, 2)}/Monat.
              Das erhöht nur den <b>zu versteuernden</b> Gewinn – es ist kein Geld, das reinkommt, und zählt daher nicht zum Umsatz/Überschuss (in deiner Excel stand es beim Umsatz). Details unter Einstellungen.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Ist-Zahlen aus Lexware (netto) ───────────────────────────
function useBelege(jahr) {
  const [belege, setBelege] = useState(null)
  const [sync, setSync] = useState({ laeuft: false, info: null, fehler: null })
  const laden = async () => {
    const { data } = await supabase.from('os_finanz_belege').select('*').gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`)
    setBelege(data || [])
  }
  const synchron = async () => {
    setSync({ laeuft: true, info: null, fehler: null })
    try { await lexwareSync(jahr, info => setSync(s => ({ ...s, info }))); await laden(); setSync(s => ({ ...s, laeuft: false })) }
    catch (e) { setSync({ laeuft: false, info: null, fehler: e.code === 'LEXOFFICE_KEY_FEHLT' ? 'In Vercel fehlt der Lexware-Schlüssel.' : e.message }) }
  }
  useEffect(() => { setBelege(null); laden().then(synchron) /* eslint-disable-next-line */ }, [jahr])
  return { belege, sync, synchron }
}
function SyncZeile({ sync, synchron, belege }) {
  const ohneNetto = (belege || []).filter(b => zaehlt(b) && b.netto == null).length
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-ink-2">
      <span>
        {sync.laeuft ? `Lexware wird abgeglichen… ${sync.info ? `${sync.info.gesamt - sync.info.offen} von ${sync.info.gesamt} Belegen` : ''}`
          : sync.fehler ? <span className="text-[#d70015]">Lexware: {sync.fehler}</span>
          : `Netto-Beträge aus Lexware${ohneNetto ? ` · ${ohneNetto} Belege noch ohne Netto (geschätzt mit 19 %)` : ''}`}
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

function IstZahlen() {
  const [jahr, setJahr] = useState(new Date().getFullYear())
  const { belege, sync, synchron } = useBelege(jahr)
  const { posten, einst } = useFinanzDaten()
  const [lohnAbziehen, setLohnAbziehen] = useState(() => { try { return localStorage.getItem('os-chef-lohn') !== '0' } catch { return true } })
  const [ueber, setUeber] = useState(null)
  useEffect(() => { lexwareUeberfaellig().then(setUeber).catch(() => setUeber([])) }, [])
  useEffect(() => { try { localStorage.setItem('os-chef-lohn', lohnAbziehen ? '1' : '0') } catch { /* egal */ } }, [lohnAbziehen])

  const a = useMemo(() => {
    if (!belege || !einst) return null
    const m = MONATE.map(() => ({ ein: 0, aus: 0 }))
    for (const b of belege) {
      if (!zaehlt(b) || !b.datum) continue
      const i = Number(b.datum.slice(5, 7)) - 1
      if (b.art === 'einnahme') m[i].ein += nettoVon(b); else m[i].aus += nettoVon(b)
    }
    const lohnMonat = lohnAbziehen ? posten.filter(p => p.bereich === 'lohn' && p.aktiv).reduce((s, p) => s + monatlich(p), 0) : 0
    const heute = new Date(), bis = jahr === heute.getFullYear() ? heute.getMonth() : 11
    m.forEach((x, i) => { x.lohn = i <= bis ? lohnMonat : 0; x.gewinn = x.ein - x.aus - x.lohn })
    const sum = k => m.slice(0, bis + 1).reduce((s, x) => s + x[k], 0)
    const ein = sum('ein'), aus = sum('aus'), lohn = sum('lohn'), gewinn = ein - aus - lohn
    const hoch = gewinn / (bis + 1) * 12
    const st = steuerJahr(hoch + firmenwagenVorteil(einst) * 12, einst.steuerbaender || []).steuer
    return { m, bis, ein, aus, lohn, gewinn, hoch, steuerJahr: st }
  }, [belege, posten, einst, lohnAbziehen, jahr])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap"><JahrWahl jahr={jahr} setJahr={setJahr} /><div className="flex-1 min-w-[200px]"><SyncZeile sync={sync} synchron={synchron} belege={belege} /></div></div>
      {!a ? <Lader /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kachel l="Einnahmen netto" w={a.ein} f="#34c759" />
            <Kachel l={`Ausgaben netto${a.lohn ? ' + Löhne' : ''}`} w={a.aus + a.lohn} f="#ff3b30" />
            <Kachel l="Gewinn bisher" w={a.gewinn} f="#7c3aed" />
            <Kachel l="Steuer aufs Jahr (hochgerechnet)" w={a.steuerJahr} f="#ff6b01" />
          </div>
          <div className="card p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <p className="text-[15px] font-semibold text-ink">Monatsverlauf {jahr} (netto)</p>
              <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                <input type="checkbox" checked={lohnAbziehen} onChange={e => setLohnAbziehen(e.target.checked)} />
                Lohnkosten aus den Posten abziehen (falls Löhne nicht als Beleg in Lexware sind)
              </label>
            </div>
            <MonatsGrafik m={a.m} bis={a.bis} />
            <p className="text-[11px] text-ink-3 mt-1">Hochgerechnet aufs Jahr: Gewinn {eur(a.hoch)} → Steuer inkl. GewSt ca. {eur(a.steuerJahr)} – also rund {eur(a.steuerJahr / 12)} pro Monat zurücklegen (plus {einst?.sicherheit_prozent ?? 10} % Sicherheit).</p>
          </div>
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
        </>
      )}
    </div>
  )
}

function MonatsGrafik({ m, bis }) {
  const W = 640, H = 210, P = { l: 52, r: 8, t: 10, b: 22 }
  const max = Math.max(1, ...m.flatMap(x => [x.ein, x.aus + x.lohn]))
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
              <rect x={xx + bw * 0.52} y={y(x.aus + x.lohn)} width={bw * 0.34} height={Math.max(0, y(0) - y(x.aus + x.lohn))} rx="3" fill="#ff3b30" opacity={blass * 0.9}><title>{MONATE[i]}: Ausgaben {eur(x.aus)}{x.lohn ? ` + Löhne ${eur(x.lohn)}` : ''}</title></rect>
              <text x={xx + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#a1a1a6">{MONATE[i]}</text>
            </g>
          )
        })}
        <path d={linie} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {m.slice(0, bis + 1).map((x, i) => <circle key={i} cx={P.l + bw * i + bw / 2} cy={y(x.gewinn)} r="3" fill="#fff" stroke="#7c3aed" strokeWidth="2"><title>{MONATE[i]}: Gewinn {eur(x.gewinn)}</title></circle>)}
      </svg>
      <div className="flex flex-wrap gap-3 text-[11px] text-ink-2">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#34c759]" />Einnahmen</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#ff3b30]" />Ausgaben (+ Löhne)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-[3px] rounded bg-[#7c3aed]" />Gewinn</span>
      </div>
    </>
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

// ── Erinnerungen ──────────────────────────────────────────────
const RHYTHMUS = [['woechentlich', 'Jede Woche'], ['monatlich', 'Jeden Monat'], ['quartalsweise', 'Jedes Quartal'], ['halbjaehrlich', 'Jedes halbe Jahr'], ['jaehrlich', 'Jedes Jahr']]
const rhythmusText = r => RHYTHMUS.find(x => x[0] === r)?.[1] || r
const datum = d => new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
function inTagen(d) {
  const h = new Date(); h.setHours(0, 0, 0, 0)
  const n = Math.round((new Date(d + 'T00:00') - h) / 86400000)
  return n === 0 ? 'heute' : n === 1 ? 'morgen' : n < 0 ? `seit ${-n} Tag${n === -1 ? '' : 'en'} fällig` : `in ${n} Tagen`
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
    const row = { titel: f.titel.trim(), notiz: f.notiz?.trim() || null, rhythmus: f.rhythmus, naechster_termin: f.naechster_termin, vorlauf_tage: Number(f.vorlauf_tage) || 0, aktiv: f.aktiv, updated_at: new Date().toISOString() }
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
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1 gap-3">
        <h2 className="text-[17px] font-semibold text-ink tracking-tight">Wiederkehrende Erinnerungen</h2>
        <button onClick={() => setBearbeiten({ rhythmus: 'monatlich', vorlauf_tage: 7, aktiv: true })} className="btn-primary text-xs !py-2 !px-4">＋ Erinnerung</button>
      </div>
      <p className="text-xs text-ink-2 mb-4">Erscheinen rechtzeitig als Aufgabe auf deinem Dashboard. „Erledigt“ hakt den aktuellen Termin ab und springt zum nächsten.</p>
      <div className="space-y-2">
        {liste.map(e => (
          <div key={e.id} className={`rounded-2xl bg-white/70 border border-white px-4 py-3.5 flex items-start gap-3 ${e.aktiv ? '' : 'opacity-50'}`}>
            <div className="w-11 h-11 rounded-2xl flex-shrink-0 flex flex-col items-center justify-center bg-[#ff6b01]/10 text-[#c2410c]">
              <span className="text-[10px] font-semibold uppercase leading-none">{new Date(e.naechster_termin + 'T12:00').toLocaleDateString('de-DE', { month: 'short' })}</span>
              <span className="text-[17px] font-bold leading-tight">{new Date(e.naechster_termin + 'T12:00').getDate()}</span>
            </div>
            <button onClick={() => setBearbeiten(e)} className="flex-1 min-w-0 text-left">
              <p className="text-[15px] font-semibold text-ink tracking-tight">{e.titel}</p>
              {e.notiz && <p className="text-xs text-ink-2 mt-0.5 line-clamp-2">{e.notiz}</p>}
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#7c3aed]/10 text-[#6d28d9]">{rhythmusText(e.rhythmus)}</span>
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-black/[0.05] text-ink-2">Nächster Termin {datum(e.naechster_termin)} · {inTagen(e.naechster_termin)}</span>
                {e.zuletzt_erledigt && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#34c759]/12 text-[#248a3d]">✓ zuletzt erledigt {new Date(e.zuletzt_erledigt + 'T12:00').toLocaleDateString('de-DE')}</span>}
              </div>
            </button>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <button onClick={() => erledigt(e)} disabled={!e.aktiv} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#34c759]/12 text-[#248a3d] hover:bg-[#34c759]/20 active:scale-95 transition disabled:opacity-40">✓ Erledigt</button>
              <button onClick={() => aktivSchalten(e)} role="switch" aria-checked={e.aktiv} title={e.aktiv ? 'Pausieren' : 'Aktivieren'}
                className={`relative inline-block w-[38px] h-[22px] rounded-full transition-colors duration-300 ${e.aktiv ? 'bg-[#34c759]' : 'bg-black/[0.12]'}`}>
                <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform duration-300 ${e.aktiv ? 'translate-x-[16px]' : ''}`} />
              </button>
            </div>
          </div>
        ))}
        {liste.length === 0 && <p className="text-sm text-ink-3 py-6 text-center">Noch keine Erinnerungen.</p>}
      </div>
      {bearbeiten && <ErinnerungFormular start={bearbeiten} onSave={speichern} onDelete={loeschen} onClose={() => setBearbeiten(null)} />}
    </div>
  )
}
function ErinnerungFormular({ start, onSave, onDelete, onClose }) {
  const inEinerWoche = (() => { const d = new Date(); d.setDate(d.getDate() + 7); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}` })()
  const [f, setF] = useState({ id: start.id, titel: start.titel || '', notiz: start.notiz || '', rhythmus: start.rhythmus || 'monatlich', naechster_termin: start.naechster_termin || inEinerWoche, vorlauf_tage: start.vorlauf_tage ?? 7, aktiv: start.aktiv ?? true })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const ok = f.titel.trim() && f.naechster_termin
  return (
    <Blatt titel={f.id ? 'Erinnerung bearbeiten' : 'Neue Erinnerung'} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Woran erinnern?</label><input autoFocus className="input" value={f.titel} onChange={e => set('titel', e.target.value)} /></div>
        <div><label className="label">Notiz</label><textarea className="input" rows={2} value={f.notiz} onChange={e => set('notiz', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Wie oft</label><select className="input" value={f.rhythmus} onChange={e => set('rhythmus', e.target.value)}>{RHYTHMUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">Nächster Termin</label><input type="date" className="input" value={f.naechster_termin} onChange={e => set('naechster_termin', e.target.value)} /></div>
        </div>
        <div><label className="label">Als Aufgabe … Tage vorher anzeigen</label><input type="number" min="0" max="90" className="input" value={f.vorlauf_tage} onChange={e => set('vorlauf_tage', e.target.value)} /></div>
        <div className="flex gap-2 pt-1">
          {f.id && <button onClick={() => onDelete(start)} className="btn-secondary !text-[#ff3b30]">Löschen</button>}
          <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          <button onClick={() => ok && onSave(f)} disabled={!ok} className="btn-primary flex-1 disabled:opacity-40">Speichern</button>
        </div>
      </div>
    </Blatt>
  )
}

// ── Einstellungen: Steuer-Bänder, Sicherheit, Firmenwagen ────
function Einstellungen() {
  const { einst, laden, neuLaden } = useFinanzDaten()
  const [f, setF] = useState(null)
  const [gespeichert, setGespeichert] = useState(false)
  useEffect(() => { if (einst) setF({ baender: einst.steuerbaender, sicherheit: einst.sicherheit_prozent, fw: einst.firmenwagen || {} }) }, [einst])
  async function speichern() {
    const { error } = await supabase.from('os_finanz_einstellungen').update({
      steuerbaender: f.baender.map(b => ({ bis: b.bis === '' || b.bis == null ? null : Number(String(b.bis).replace(',', '.')), satz: Number(String(b.satz).replace(',', '.')) || 0 })),
      sicherheit_prozent: Number(String(f.sicherheit).replace(',', '.')) || 0,
      firmenwagen: { ...f.fw, listenpreis: Number(String(f.fw.listenpreis ?? '').replace(',', '.')) || 0, prozent: Number(f.fw.prozent) || 0 },
      updated_at: new Date().toISOString(),
    }).eq('id', 1)
    if (error) { alert(error.message); return }
    setGespeichert(true); setTimeout(() => setGespeichert(false), 2000); neuLaden()
  }
  if (laden || !f) return <Lader />
  const setB = (i, k, v) => setF(p => ({ ...p, baender: p.baender.map((b, j) => j === i ? { ...b, [k]: v } : b) }))
  const setFw = (k, v) => setF(p => ({ ...p, fw: { ...p.fw, [k]: v } }))
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <p className="text-[15px] font-semibold text-ink mb-1">Steuer-Bänder (Jahresgewinn, Satz inkl. GewSt)</p>
        <p className="text-xs text-ink-2 mb-3">Wie in deiner Excel: Jeder Euro im Band wird mit dem Satz des Bandes versteuert. Leeres „bis“ = ohne Obergrenze.</p>
        <div className="space-y-2">
          {f.baender.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <span className="text-xs text-ink-2 tabular-nums">ab {eur(i === 0 ? 0 : f.baender[i - 1].bis)}</span>
              <input inputMode="decimal" className="input !py-1.5 text-sm" placeholder="bis (leer = ∞)" value={b.bis ?? ''} onChange={e => setB(i, 'bis', e.target.value)} />
              <div className="flex items-center gap-1"><input inputMode="decimal" className="input !py-1.5 text-sm !w-20 text-right" value={b.satz} onChange={e => setB(i, 'satz', e.target.value)} /><span className="text-xs text-ink-2">%</span></div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-4"><span className="text-sm text-ink">Sicherheitsrücklage</span><input inputMode="decimal" className="input !py-1.5 !w-20 text-right" value={f.sicherheit} onChange={e => setF(p => ({ ...p, sicherheit: e.target.value }))} /><span className="text-xs text-ink-2">% auf die Steuer</span></div>
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
          In deiner Excel standen 452,60 €/Monat (= 1 % von 45.260 €) beim Umsatz. Das ist hier korrigiert: Die Privatnutzung erhöht nur den <b>zu versteuernden</b> Gewinn, ist aber kein Geld, das reinkommt – sonst wirkt dein Überschuss jeden Monat 452,60 € zu hoch.
          Bitte vom Steuerberater bestätigen lassen: der genaue Bruttolistenpreis (inkl. Sonderausstattung, abgerundet auf volle 100 €), ob der Tucson ein Plug-in-Hybrid ist (dann 0,5 %), und ob Fahrten Wohnung–Büro (0,03 %-Regel) sowie Umsatzsteuer auf die Privatnutzung dazukommen – die sind hier nicht eingerechnet.
        </p>
      </div>
      <button onClick={speichern} className="btn-primary !px-6">{gespeichert ? '✓ Gespeichert' : 'Einstellungen speichern'}</button>
    </div>
  )
}

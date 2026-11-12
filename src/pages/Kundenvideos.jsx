import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { BrandMark } from '../components/BrandMark'
import { metricool, auswerten, ampel, alsDatum } from '../lib/kundenvideos'

// Kundenvideos: pro Kunde, wie viele Videos diesen Monat bei Metricool online sind, noch geplant sind,
// auf Freigabe warten – im Vergleich zum Monatsziel. Warnung, wenn eine Freigabe kurz vor dem Termin fehlt.

const GRUEN = '#34c759', BLAU = '#38b6ff', ORANGE = '#ff9f0a', ROT = '#ff3b30', LILA = '#7c3aed'
const AMPEL = { gruen: GRUEN, gelb: ORANGE, rot: ROT }
const z2 = n => String(n).padStart(2, '0')
const fmt = d => `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`
const kurzDatum = d => d ? d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '—'

export default function Kundenvideos() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [monat, setMonat] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [kunden, setKunden] = useState([])
  const [drehs, setDrehs] = useState([])
  const [posts, setPosts] = useState({})
  const [mFehler, setMFehler] = useState({})
  const [stand, setStand] = useState(null)
  const [laden, setLaden] = useState(true)
  const [fehler, setFehler] = useState(null)
  const [offenId, setOffenId] = useState(params.get('kunde'))

  useEffect(() => { kundenLaden() }, [])
  useEffect(() => { if (kunden.length) postsLaden() /* eslint-disable-next-line */ }, [monat, kunden.map(k => k.metricool_brand_ids?.join('.')).join('|')])

  async function kundenLaden() {
    const [k, d] = await Promise.all([
      supabase.from('proj_kunden').select('*').order('name'),
      supabase.from('proj_drehs').select('id, kunde_id, datum, status, videos'),
    ])
    setKunden(k.data || []); setDrehs(d.data || [])
    if (!(k.data || []).some(x => x.metricool_brand_ids?.length)) setLaden(false)
  }

  async function postsLaden() {
    const ids = [...new Set(kunden.flatMap(k => k.metricool_brand_ids || []))]
    if (!ids.length) { setLaden(false); return }
    setLaden(true); setFehler(null)
    const mEnde = new Date(monat.getFullYear(), monat.getMonth() + 1, 0)
    const bis = new Date(Math.max(mEnde.getTime(), Date.now() + 35 * 86400000))
    try {
      const r = await metricool({ aktion: 'posts', marken: ids.join(','), von: fmt(monat), bis: fmt(bis) })
      setPosts(r.posts || {}); setMFehler(r.fehler || {}); setStand(new Date())
    } catch (e) { setFehler(e.code === 'METRICOOL_TOKEN_FEHLT' ? 'token' : e.message) }
    setLaden(false)
  }

  const auswertungen = useMemo(() => kunden.map(k => {
    const p = (k.metricool_brand_ids || []).flatMap(id => posts[id] || [])
    return { k, a: auswerten(k, p, monat, drehs), verbunden: (k.metricool_brand_ids || []).length > 0 }
  }), [kunden, posts, monat, drehs])

  const verbunden = auswertungen.filter(x => x.verbunden)
  const ohne = auswertungen.filter(x => !x.verbunden)
  const summen = verbunden.reduce((s, { a }) => ({ online: s.online + a.online.length, geplant: s.geplant + a.geplant.length, freigabe: s.freigabe + a.freigabeOffen.length, dringend: s.dringend + a.dringend.length, ziel: s.ziel + (a.ziel || 0) }), { online: 0, geplant: 0, freigabe: 0, dringend: 0, ziel: 0 })
  const offen = auswertungen.find(x => x.k.id === offenId)
  const istAktMonat = monat.getMonth() === new Date().getMonth() && monat.getFullYear() === new Date().getFullYear()

  function oeffnen(id) { setOffenId(id); if (id) params.set('kunde', id); else params.delete('kunde'); setParams(params, { replace: true }) }

  async function kundeSpeichern(id, patch) {
    setKunden(prev => prev.map(k => k.id === id ? { ...k, ...patch } : k))
    const { error } = await supabase.from('proj_kunden').update(patch).eq('id', id)
    if (error) { alert('Speichern fehlgeschlagen: ' + error.message); kundenLaden() }
  }

  return (
    <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8 space-y-5 max-w-6xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Kundenvideos</h1>
          <p className="text-[13px] text-ink-2 mt-1.5">Stand aus Metricool{stand ? ` · aktualisiert ${stand.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn-icon" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() - 1, 1))}>‹</button>
          <span className="text-[15px] font-semibold text-ink min-w-[8.5rem] text-center">{monat.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span>
          <button className="btn-icon" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() + 1, 1))}>›</button>
          <button className="btn-secondary !py-1.5 !px-3 text-xs ml-1" onClick={postsLaden} disabled={laden}>{laden ? '…' : '↻ Aktualisieren'}</button>
        </div>
      </div>

      {fehler === 'token' ? (
        <div className="card p-5 space-y-2">
          <p className="text-[15px] font-semibold text-ink">Metricool ist noch nicht verbunden</p>
          <p className="text-sm text-ink-2">In Vercel fehlt der Metricool-API-Schlüssel (Umgebungsvariable <code className="text-xs bg-black/5 px-1 rounded">METRICOOL_USER_TOKEN</code>).</p>
        </div>
      ) : fehler ? (
        <div className="rounded-2xl px-4 py-3 text-xs bg-[#ff3b30]/10 text-[#d70015]">Metricool konnte nicht geladen werden: {fehler}</div>
      ) : null}

      {/* Übersicht */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: 'Online diesen Monat', w: summen.online, f: GRUEN },
          { l: 'Noch geplant', w: summen.geplant, f: BLAU },
          { l: 'Warten auf Freigabe', w: summen.freigabe, f: summen.dringend ? ROT : ORANGE },
          { l: 'Ziel gesamt', w: summen.ziel || '—', f: LILA },
        ].map(x => (
          <div key={x.l} className="card p-4">
            <p className="text-xs text-ink-2 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: x.f }} />{x.l}</p>
            <p className="text-[28px] font-bold tracking-tight leading-tight mt-0.5 text-ink">{laden ? '·' : x.w}</p>
          </div>
        ))}
      </div>

      {laden && !Object.keys(posts).length ? (
        <div className="flex justify-center py-16"><div className="animate-pulse"><BrandMark size={40} /></div></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {verbunden.map(({ k, a }) => <KundenKarte key={k.id} k={k} a={a} fehler={(k.metricool_brand_ids || []).map(id => mFehler[id]).filter(Boolean)[0]} istAktMonat={istAktMonat} onClick={() => oeffnen(k.id)} />)}
        </div>
      )}

      {ohne.length > 0 && (
        <div className="card p-4">
          <p className="text-[13px] font-semibold text-ink mb-1">Ohne Metricool-Verbindung</p>
          <p className="text-xs text-ink-2 mb-3">{isAdmin ? 'Antippen, um die Metricool-Marke zuzuordnen.' : 'Diese Kunden sind noch keiner Metricool-Marke zugeordnet.'}</p>
          <div className="flex flex-wrap gap-1.5">
            {ohne.map(({ k }) => <button key={k.id} onClick={() => isAdmin && oeffnen(k.id)} className="text-xs font-medium px-3 py-1.5 rounded-full bg-white/60 text-ink-2 hover:bg-white">{k.name}</button>)}
          </div>
        </div>
      )}

      {offen && (
        <KundenDetail k={offen.k} a={offen.a} monat={monat} isAdmin={isAdmin} onClose={() => oeffnen(null)}
          onSpeichern={patch => kundeSpeichern(offen.k.id, patch)} onDreh={id => navigate(`/projekte?dreh=${id}`)} />
      )}
    </div>
  )
}

// Fortschrittsbalken: online (grün) + geplant (blau) im Verhältnis zum Ziel, Ziel-Markierung
function ZielBalken({ a, hoch }) {
  const max = Math.max(a.ziel || 0, a.summe, 1)
  const pct = n => `${(n / max) * 100}%`
  return (
    <div className={`relative w-full ${hoch ? 'h-3' : 'h-2'} rounded-full bg-black/[0.06] overflow-hidden`}>
      <div className="absolute inset-y-0 left-0 rounded-l-full transition-all duration-700" style={{ width: pct(a.online.length), background: GRUEN }} />
      <div className="absolute inset-y-0 transition-all duration-700" style={{ left: pct(a.online.length), width: pct(a.geplant.length), background: BLAU }} />
      {a.ziel != null && a.summe > a.ziel && <div className="absolute inset-y-0 right-0" style={{ width: pct(a.summe - a.ziel), background: `repeating-linear-gradient(45deg, ${LILA}55 0 4px, transparent 4px 8px)` }} />}
      {a.ziel != null && <div className="absolute inset-y-[-2px] w-[2px] bg-ink/70" style={{ left: `calc(${pct(a.ziel)} - 1px)` }} />}
    </div>
  )
}

function KundenKarte({ k, a, fehler, istAktMonat, onClick }) {
  const farbe = AMPEL[ampel(a)]
  return (
    <button onClick={onClick} className="tile p-4 text-left w-full">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink tracking-tight truncate">{k.name}</p>
          <p className="text-xs text-ink-2 mt-0.5">
            {a.ziel == null ? 'Kein Monatsziel' : a.fehlt > 0 ? <span className="text-[#9a5b00] font-medium">noch {a.fehlt} fehlen</span>
              : a.ueber > 0 ? <span className="text-[#6d28d9] font-medium">+{a.ueber} über Ziel</span> : <span className="text-[#248a3d] font-medium">Ziel erreicht ✓</span>}
          </p>
        </div>
        <span className="w-3 h-3 rounded-full flex-shrink-0 mt-1.5 shadow-[0_0_0_4px_rgba(255,255,255,0.8)]" style={{ background: farbe }} />
      </div>
      <div className="flex items-baseline gap-1 mt-3">
        <span className="text-[30px] font-bold tracking-tight text-ink leading-none tabular-nums">{a.summe}</span>
        <span className="text-[15px] text-ink-3 font-medium">/ {a.ziel ?? '—'}</span>
        <span className="ml-auto text-[11px] text-ink-2 tabular-nums">{a.online.length} online · {a.geplant.length} geplant</span>
      </div>
      <div className="mt-2.5"><ZielBalken a={a} /></div>
      <div className="flex flex-wrap gap-1 mt-3">
        {a.dringend.length > 0 && <Chip ton="rot">{a.dringend.length} Freigabe{a.dringend.length > 1 ? 'n' : ''} dringend</Chip>}
        {a.freigabeOffen.length - a.dringend.length > 0 && <Chip ton="gelb">{a.freigabeOffen.length - a.dringend.length} wartet auf Freigabe</Chip>}
        {a.abgelehnt.length > 0 && <Chip ton="rot">{a.abgelehnt.length} abgelehnt</Chip>}
        {(a.verpasst.length + a.fehler.length) > 0 && <Chip ton="rot">{a.verpasst.length + a.fehler.length} nicht online</Chip>}
        {istAktMonat && a.reichtBis && <Chip>Content bis {a.reichtBis.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</Chip>}
        {a.naechsterDreh && <Chip ton="lila">Dreh {new Date(a.naechsterDreh.datum + 'T12:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</Chip>}
        {istAktMonat && a.fehlt > 0 && !a.naechsterDreh && a.inProduktion < a.fehlt && <Chip ton="gelb">Dreh planen</Chip>}
        {fehler && <Chip ton="rot">Metricool-Fehler</Chip>}
      </div>
    </button>
  )
}

function Chip({ ton, children }) {
  const c = { rot: 'bg-[#ff3b30]/10 text-[#d70015]', gelb: 'bg-[#ff9f0a]/15 text-[#9a5b00]', lila: 'bg-[#7c3aed]/10 text-[#6d28d9]', gruen: 'bg-[#34c759]/12 text-[#248a3d]' }[ton] || 'bg-black/[0.05] text-ink-2'
  return <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${c}`}>{children}</span>
}

// Verlaufsgrafik: kumulierte Videos im Monat (online durchgezogen, geplant gestrichelt) gegen die Ziel-Linie
function Verlauf({ a, monat }) {
  const tage = new Date(monat.getFullYear(), monat.getMonth() + 1, 0).getDate()
  const W = 560, H = 180, P = { l: 28, r: 12, t: 12, b: 22 }
  const max = Math.max(a.ziel || 0, a.summe, 4)
  const x = t => P.l + ((t - 1) / (tage - 1)) * (W - P.l - P.r)
  const y = n => H - P.b - (n / max) * (H - P.t - P.b)
  const proTag = Array(tage + 1).fill(0), proTagPlan = Array(tage + 1).fill(0)
  a.online.forEach(p => { proTag[alsDatum(p.datum).getDate()]++ })
  a.geplant.forEach(p => { proTagPlan[alsDatum(p.datum).getDate()]++ })
  let s = 0
  const lineOnline = [], linePlan = []
  const heute = new Date(), istAkt = heute.getMonth() === monat.getMonth() && heute.getFullYear() === monat.getFullYear()
  const letzterOnlineTag = istAkt ? heute.getDate() : tage
  for (let t = 1; t <= tage; t++) {
    s += proTag[t]
    if (t <= letzterOnlineTag) lineOnline.push([x(t), y(s)])
  }
  let s2 = a.online.length
  linePlan.push([x(letzterOnlineTag), y(a.online.length)])
  for (let t = letzterOnlineTag + 1; t <= tage; t++) { s2 += proTagPlan[t]; linePlan.push([x(t), y(s2)]) }
  const pfad = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const ticks = [...new Set([0, Math.round(max / 2), max])]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Videos im Monatsverlauf">
      {ticks.map(t => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="rgba(0,0,0,0.06)" /><text x={P.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#a1a1a6">{t}</text></g>)}
      {[1, 8, 15, 22, tage].map(t => <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize="10" fill="#a1a1a6">{t}.</text>)}
      {a.ziel != null && <>
        <line x1={x(1)} y1={y(0)} x2={x(tage)} y2={y(a.ziel)} stroke={LILA} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="2 4" />
        <line x1={P.l} x2={W - P.r} y1={y(a.ziel)} y2={y(a.ziel)} stroke={LILA} strokeOpacity="0.5" strokeWidth="1" />
        <text x={W - P.r} y={y(a.ziel) - 4} textAnchor="end" fontSize="10" fontWeight="600" fill={LILA}>Ziel {a.ziel}</text>
      </>}
      {istAkt && <line x1={x(heute.getDate())} x2={x(heute.getDate())} y1={P.t} y2={H - P.b} stroke="#ff6b01" strokeOpacity="0.35" />}
      {linePlan.length > 1 && <path d={pfad(linePlan)} fill="none" stroke={BLAU} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />}
      {lineOnline.length > 0 && <path d={pfad(lineOnline)} fill="none" stroke={GRUEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

function KundenDetail({ k, a, monat, isAdmin, onClose, onSpeichern, onDreh }) {
  const [ziel, setZiel] = useState(k.videos_pro_monat ?? '')
  const [vorlauf, setVorlauf] = useState(k.freigabe_vorlauf_tage ?? 3)
  const [marken, setMarken] = useState(null)
  const [markenFehler, setMarkenFehler] = useState(null)
  useEffect(() => {
    if (!isAdmin) return
    metricool({ aktion: 'marken' }).then(r => setMarken(r.marken || [])).catch(e => setMarkenFehler(e.message))
  }, [isAdmin])
  const gewaehlt = new Set((k.metricool_brand_ids || []).map(String))
  const toggleMarke = id => {
    const n = new Set(gewaehlt); n.has(String(id)) ? n.delete(String(id)) : n.add(String(id))
    onSpeichern({ metricool_brand_ids: [...n].map(Number) })
  }
  const liste = [...a.imMonat, ...a.freigabeOffen.filter(p => !a.imMonat.includes(p))].sort((x, y) => String(x.datum).localeCompare(String(y.datum)))
  const marke = k.metricool_brand_ids?.[0]

  return (
    <div className="fixed inset-0 scrim z-[60] flex md:p-3" onClick={onClose}>
      <div className="sheet-right glass-strong ml-auto w-full md:max-w-[560px] mt-[calc(env(safe-area-inset-top)+14px)] md:mt-0 h-auto md:h-full flex flex-col rounded-t-[28px] md:rounded-[28px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="md:hidden flex justify-center pt-2 pb-0.5 flex-shrink-0"><span className="w-9 h-[5px] rounded-full bg-black/15" /></div>
        <div className="px-5 pt-3 md:pt-5 pb-3 flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider">{monat.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</p>
            <p className="text-[22px] font-bold text-ink tracking-tight leading-tight mt-0.5 truncate">{k.name}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {marke && <a href={`https://app.metricool.com/planner?blogId=${marke}`} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 !px-3 text-xs">Metricool ↗</a>}
            <button onClick={onClose} className="btn-icon text-base">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-[calc(20px+env(safe-area-inset-bottom))] space-y-4">
          {/* Kennzahlen */}
          <div className="grid grid-cols-4 gap-2">
            {[['Online', a.online.length, GRUEN], ['Geplant', a.geplant.length, BLAU], ['Freigabe', a.freigabeOffen.length, a.dringend.length ? ROT : ORANGE], ['Ziel', a.ziel ?? '—', LILA]].map(([l, w, f]) => (
              <div key={l} className="rounded-2xl bg-white/70 border border-white px-3 py-2.5">
                <p className="text-[11px] text-ink-2 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: f }} />{l}</p>
                <p className="text-[22px] font-bold text-ink tracking-tight leading-tight tabular-nums">{w}</p>
              </div>
            ))}
          </div>

          {a.dringend.length > 0 && (
            <div className="rounded-2xl px-4 py-3 bg-[#ff3b30]/10 text-[13px] text-[#b0000f]">
              <b>Freigabe fehlt!</b> {a.dringend.length} Beitrag{a.dringend.length > 1 ? 'e gehen' : ' geht'} in den nächsten {a.vorlauf} Tagen online, {a.dringend.length > 1 ? 'sind' : 'ist'} aber vom Kunden noch nicht freigegeben. Bitte beim Kunden nachhaken.
            </div>
          )}

          <div className="rounded-[20px] bg-white/70 border border-white p-3.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-semibold text-ink">Monatsverlauf</p>
              <p className="text-xs text-ink-2">{a.ziel == null ? 'Kein Ziel' : a.fehlt > 0 ? `noch ${a.fehlt} bis zum Ziel` : a.ueber > 0 ? `${a.ueber} über Ziel` : 'Ziel erreicht ✓'}</p>
            </div>
            <ZielBalken a={a} hoch />
            <div className="mt-3"><Verlauf a={a} monat={monat} /></div>
            <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-ink-2">
              <span className="flex items-center gap-1"><span className="w-3 h-[3px] rounded" style={{ background: GRUEN }} />online</span>
              <span className="flex items-center gap-1"><span className="w-3 h-[3px] rounded" style={{ background: BLAU }} />geplant</span>
              <span className="flex items-center gap-1"><span className="w-3 h-[3px] rounded" style={{ background: LILA }} />Ziel</span>
            </div>
          </div>

          {/* Planung */}
          <div className="rounded-[20px] bg-white/70 border border-white divide-y divide-black/[0.05]">
            <Zeile l="Content geplant bis" w={a.reichtBis ? kurzDatum(a.reichtBis) : 'nichts geplant'} />
            <Zeile l="Videos in Produktion (Cutting/Posting)" w={a.inProduktion || '—'} />
            <Zeile l="Nächster Dreh" w={a.naechsterDreh ? <button className="text-[#ff6b01] font-medium" onClick={() => onDreh(a.naechsterDreh.id)}>{new Date(a.naechsterDreh.datum + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} →</button> : <span className={a.fehlt > 0 ? 'text-[#9a5b00] font-medium' : ''}>{a.fehlt > 0 ? 'Dreh planen!' : 'keiner geplant'}</span>} />
          </div>

          {/* Beiträge */}
          <div>
            <p className="text-[13px] font-semibold text-ink mb-2 px-0.5">Beiträge</p>
            {liste.length === 0 ? <p className="text-xs text-ink-3 px-0.5">Keine Beiträge in diesem Monat.</p> : (
              <div className="rounded-[20px] bg-white/70 border border-white divide-y divide-black/[0.05] overflow-hidden">
                {liste.map(p => {
                  const d = alsDatum(p.datum)
                  const vorbei = d < new Date()
                  const st = p.status === 'online' || p.status === 'teilweise' ? ['online', 'gruen']
                    : p.status === 'fehler' ? ['Fehler', 'rot'] : vorbei ? ['nicht online', 'rot'] : ['geplant', 'blau']
                  return (
                    <div key={p.uuid || p.id} className="px-3.5 py-2.5 flex items-start gap-3">
                      <div className="w-12 flex-shrink-0 text-center">
                        <p className="text-[10px] font-semibold text-ink-3 uppercase">{d.toLocaleDateString('de-DE', { weekday: 'short' })}</p>
                        <p className="text-[15px] font-bold text-ink leading-tight">{d.getDate()}.{d.getMonth() + 1}.</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-ink truncate">{p.titel || p.text || 'Ohne Text'}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <Chip ton={st[1] === 'blau' ? undefined : st[1]}>{st[0]}</Chip>
                          {p.freigabe === 'pending' && !vorbei && <Chip ton={a.dringend.includes(p) ? 'rot' : 'gelb'}>wartet auf Freigabe</Chip>}
                          {p.freigabe === 'approved' && p.status === 'geplant' && <Chip ton="gruen">freigegeben</Chip>}
                          {p.freigabe === 'rejected' && <Chip ton="rot">abgelehnt</Chip>}
                          {p.notizen > 0 && <Chip>{p.notizen} Notiz{p.notizen > 1 ? 'en' : ''}{p.ungelesen ? ' (neu)' : ''}</Chip>}
                        </div>
                      </div>
                      <span className="text-[11px] text-ink-3 whitespace-nowrap">{d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Einstellungen (Admin) */}
          {isAdmin && (
            <div className="rounded-[20px] bg-white/70 border border-white p-3.5 space-y-3">
              <p className="text-[13px] font-semibold text-ink">Einstellungen</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Videos pro Monat</label>
                  <input type="number" min="0" max="200" className="input" value={ziel} placeholder="z. B. 15"
                    onChange={e => setZiel(e.target.value)} onBlur={() => onSpeichern({ videos_pro_monat: ziel === '' ? null : Math.max(0, parseInt(ziel) || 0) })} />
                </div>
                <div>
                  <label className="label">Warnung … Tage vorher</label>
                  <input type="number" min="0" max="30" className="input" value={vorlauf}
                    onChange={e => setVorlauf(e.target.value)} onBlur={() => onSpeichern({ freigabe_vorlauf_tage: Math.min(30, Math.max(0, parseInt(vorlauf) || 0)) })} />
                </div>
              </div>
              <div>
                <label className="label">Metricool-Marke(n)</label>
                {markenFehler ? <p className="text-xs text-[#d70015]">{markenFehler}</p> : !marken ? <p className="text-xs text-ink-3">Lädt…</p> : (
                  <div className="flex flex-wrap gap-1.5">
                    {marken.map(m => (
                      <button key={m.id} onClick={() => toggleMarke(m.id)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full transition ${gewaehlt.has(String(m.id)) ? 'bg-[#ff6b01] text-white' : 'bg-black/[0.05] text-ink-2 hover:bg-black/[0.08]'}`}>{m.name}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Zeile({ l, w }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="text-[13px] text-ink-2">{l}</span>
      <span className="text-[13px] text-ink text-right">{w}</span>
    </div>
  )
}

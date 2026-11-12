import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { BrandMark } from '../components/BrandMark'
import KundenvideosWarnungen from '../components/KundenvideosWarnungen'
import { Avatar } from '../components/Avatar'

// Dashboard
// – Admin (Felix): Master-Dashboard mit den Aufgaben aller Personen mit Dashboard-Zugang, Liste oder Kalender,
//   Aufgaben anlegen / bearbeiten / löschen (Papierkorb)
// – Mitarbeiter mit Dashboard-Zugang: eigene Aufgaben, abhaken
// Deadlines aus den Drehs erscheinen automatisch als Aufgaben (DB-Trigger).

const PERSON_FARBEN = ['#7c3aed', '#38b6ff', '#34c759', '#ff6b01', '#ff2d55', '#5856d6', '#ff9f0a', '#30b0c7']
const farbeVon = (id, liste) => PERSON_FARBEN[Math.max(0, liste.findIndex(p => p.id === id)) % PERSON_FARBEN.length]

const tagKey = d => { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}` }
const heute0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const addTage = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

function zeitText(a) {
  if (!a.faellig_am || a.ganztags) return ''
  return new Date(a.faellig_am).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
}
function istUeberfaellig(a) {
  if (a.erledigt || !a.faellig_am) return false
  const d = new Date(a.faellig_am)
  return a.ganztags ? tagKey(d) < tagKey(new Date()) : d < new Date()
}

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [aufgaben, setAufgaben] = useState([])
  const [personen, setPersonen] = useState([])
  const [drehs, setDrehs] = useState([])
  const [loading, setLoading] = useState(true)
  const [ansicht, setAnsicht] = useState(() => { try { return localStorage.getItem('os-dash-ansicht') || 'liste' } catch { return 'liste' } })
  const [filterPerson, setFilterPerson] = useState('alle')
  const [zeigeErledigt, setZeigeErledigt] = useState(false)
  const [monat, setMonat] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [bearbeiten, setBearbeiten] = useState(null)   // null | {} (neu) | aufgabe
  const [tagAuswahl, setTagAuswahl] = useState(null)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend'
  const name = profile?.full_name || profile?.email?.split('@')[0] || 'Team'

  useEffect(() => { try { localStorage.setItem('os-dash-ansicht', ansicht) } catch { /* egal */ } }, [ansicht])

  useEffect(() => {
    laden()
    let t
    const ch = supabase.channel('dashboard-aufgaben')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'os_aufgaben' }, () => { clearTimeout(t); t = setTimeout(laden, 300) })
      .subscribe()
    const onVis = () => { if (document.visibilityState === 'visible') laden() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearTimeout(t); supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onVis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function laden() {
    const seit = addTage(heute0(), -30).toISOString()
    const q = supabase.from('os_aufgaben').select('*').or(`erledigt.eq.false,erledigt_am.gte.${seit}`).order('faellig_am', { ascending: true, nullsFirst: false })
    const [a, p, d] = await Promise.all([
      isAdmin ? q : q.eq('assignee_id', profile.id),
      supabase.from('profiles').select('id, full_name, role, dashboard, aktiv, avatar_url').order('full_name'),
      supabase.from('proj_drehs').select('id, kunde_name, datum'),
    ])
    if (a.data) setAufgaben(a.data)
    if (p.data) setPersonen(p.data.filter(x => (x.dashboard || x.role === 'admin') && x.aktiv !== false))
    if (d.data) setDrehs(d.data)
    setLoading(false)
  }

  async function abhaken(a) {
    setAufgaben(prev => prev.map(x => x.id === a.id ? { ...x, erledigt: !a.erledigt, erledigt_am: !a.erledigt ? new Date().toISOString() : null } : x))
    const { error } = await supabase.rpc('aufgabe_erledigt_setzen', { p_id: a.id, p_wert: !a.erledigt })
    if (error) { alert('Konnte nicht gespeichert werden: ' + error.message); laden() }
  }

  async function speichern(f) {
    const row = { titel: f.titel.trim(), beschreibung: f.beschreibung?.trim() || null, assignee_id: f.assignee_id || null, faellig_am: f.faellig_am, ganztags: f.ganztags }
    const { error } = f.id
      ? await supabase.from('os_aufgaben').update({ ...row, updated_at: new Date().toISOString() }).eq('id', f.id)
      : await supabase.from('os_aufgaben').insert({ ...row, quelle: 'manuell', created_by: profile.id })
    if (error) { alert('Speichern fehlgeschlagen: ' + error.message); return }
    setBearbeiten(null); laden()
  }

  async function loeschen(a) {
    if (!window.confirm(`Aufgabe „${a.titel}“ löschen?\n\nSie landet im Papierkorb und kann wiederhergestellt werden.`)) return
    const { error } = await supabase.from('os_aufgaben').delete().eq('id', a.id)
    if (error) { alert('Löschen fehlgeschlagen: ' + error.message); return }
    setBearbeiten(null); laden()
  }

  const sichtbar = useMemo(() => aufgaben
    .filter(a => filterPerson === 'alle' || a.assignee_id === filterPerson)
    .filter(a => zeigeErledigt || !a.erledigt), [aufgaben, filterPerson, zeigeErledigt])

  const offen = aufgaben.filter(a => !a.erledigt && (filterPerson === 'alle' || a.assignee_id === filterPerson))
  const kpi = {
    ueber: offen.filter(istUeberfaellig).length,
    heute: offen.filter(a => a.faellig_am && tagKey(new Date(a.faellig_am)) === tagKey(new Date()) && !istUeberfaellig(a)).length,
    woche: offen.filter(a => a.faellig_am && new Date(a.faellig_am) < addTage(heute0(), 7)).length,
    gesamt: offen.length,
  }

  const personVon = id => personen.find(p => p.id === id)
  const drehVon = id => drehs.find(d => d.id === id)
  const oeffnen = a => a.quelle === 'manuell' ? (isAdmin && setBearbeiten(a)) : navigate(`/projekte?dreh=${a.dreh_id}`)

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="animate-pulse"><BrandMark size={40} /></div></div>
  )

  return (
    <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8 space-y-5 max-w-6xl">
      {/* Kopf */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <BrandMark size={30} className="mb-3 md:hidden" />
          <h1 className="page-title">{greeting}, {name.split(' ')[0]}</h1>
          <p className="text-[13px] text-ink-2 mt-1.5">
            {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {isAdmin ? ' · Master-Dashboard' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="seg">
            {[['liste', 'Liste'], ['kalender', 'Kalender']].map(([v, l]) => (
              <button key={v} onClick={() => setAnsicht(v)} className={`seg-btn ${ansicht === v ? 'is-active' : ''}`}>{l}</button>
            ))}
          </div>
          {isAdmin && <button onClick={() => setBearbeiten({ assignee_id: filterPerson !== 'alle' ? filterPerson : '' })} className="btn-primary text-xs !py-2 !px-4">＋ Aufgabe</button>}
        </div>
      </div>

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Überfällig', wert: kpi.ueber, farbe: kpi.ueber ? 'text-[#d70015]' : 'text-ink' },
          { label: 'Heute fällig', wert: kpi.heute, farbe: kpi.heute ? 'text-[#ff6b01]' : 'text-ink' },
          { label: 'Nächste 7 Tage', wert: kpi.woche, farbe: 'text-ink' },
          { label: 'Offen gesamt', wert: kpi.gesamt, farbe: 'text-ink' },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <p className="text-xs text-ink-2">{k.label}</p>
            <p className={`text-[28px] font-bold tracking-tight leading-tight mt-0.5 ${k.farbe}`}>{k.wert}</p>
          </div>
        ))}
      </div>

      {/* Freigabe-Warnungen aus Metricool – für alle mit Dashboard */}
      <KundenvideosWarnungen />

      {/* Personen-Filter (Master) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {isAdmin && personen.length > 1 && <>
          <FilterChip an={filterPerson === 'alle'} onClick={() => setFilterPerson('alle')}>Alle</FilterChip>
          {personen.map(p => {
            const n = aufgaben.filter(a => a.assignee_id === p.id && !a.erledigt).length
            return (
              <FilterChip key={p.id} an={filterPerson === p.id} onClick={() => setFilterPerson(p.id)} person={p}>
                {p.full_name?.split(' ')[0]} {n > 0 && <span className="opacity-60 tabular-nums">{n}</span>}
              </FilterChip>
            )
          })}
        </>}
        <button onClick={() => setZeigeErledigt(v => !v)} className={`ml-auto text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition ${zeigeErledigt ? 'bg-[#34c759]/12 text-[#248a3d]' : 'text-ink-2 hover:bg-black/5'}`}>
          {zeigeErledigt ? '✓ Erledigte sichtbar' : 'Erledigte zeigen'}
        </button>
      </div>

      {ansicht === 'liste' ? (
        <AufgabenListe aufgaben={sichtbar} personen={personen} zeigePerson={isAdmin && filterPerson === 'alle'}
          personVon={personVon} drehVon={drehVon} onAbhaken={abhaken} onOeffnen={oeffnen} />
      ) : (
        <Kalender monat={monat} setMonat={setMonat} aufgaben={sichtbar} personen={personen} onTag={setTagAuswahl} />
      )}

      {/* Tag im Kalender angetippt */}
      {tagAuswahl && (
        <Sheet titel={new Date(tagAuswahl + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })} onClose={() => setTagAuswahl(null)}>
          <AufgabenListe kompakt aufgaben={sichtbar.filter(a => a.faellig_am && tagKey(new Date(a.faellig_am)) === tagAuswahl)} personen={personen}
            zeigePerson={isAdmin} personVon={personVon} drehVon={drehVon} onAbhaken={abhaken}
            onOeffnen={a => { setTagAuswahl(null); oeffnen(a) }} />
          {isAdmin && <button onClick={() => { const t = tagAuswahl; setTagAuswahl(null); setBearbeiten({ datum: t, assignee_id: filterPerson !== 'alle' ? filterPerson : '' }) }} className="dashed-add mt-3">＋ Aufgabe an diesem Tag</button>}
        </Sheet>
      )}

      {bearbeiten && (
        <AufgabeFormular start={bearbeiten} personen={personen} onSave={speichern} onDelete={loeschen} onClose={() => setBearbeiten(null)} />
      )}
    </div>
  )
}

function FilterChip({ an, onClick, farbe, person, children }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition-all duration-200 active:scale-95 ${an ? 'bg-white text-ink shadow-[0_3px_10px_-3px_rgba(0,0,0,0.18)]' : 'bg-white/45 text-ink-2 hover:bg-white/70'}`}>
      {person ? <Avatar person={person} size={20} className="-ml-1.5" /> : farbe && <span className="w-2 h-2 rounded-full" style={{ background: farbe }} />}
      {children}
    </button>
  )
}

function Haken({ an, onClick }) {
  return (
    <button type="button" role="checkbox" aria-checked={an} onClick={e => { e.stopPropagation(); onClick?.() }}
      className={`w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 active:scale-90 ${an ? 'bg-[#34c759] shadow-[0_3px_8px_-2px_rgba(52,199,89,0.6)]' : 'border-[1.5px] border-black/20 bg-white/60 hover:border-[#ff6b01]'}`}>
      {an && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
    </button>
  )
}

// Liste nach Tagen gruppiert: Überfällig, Heute, Morgen, weitere Tage, ohne Datum
function AufgabenListe({ aufgaben, personen, zeigePerson, personVon, drehVon, onAbhaken, onOeffnen, kompakt }) {
  const gruppen = useMemo(() => {
    const h = tagKey(new Date()), m = tagKey(addTage(new Date(), 1))
    const map = new Map()
    const rein = (k, label, a) => { if (!map.has(k)) map.set(k, { label, items: [] }); map.get(k).items.push(a) }
    for (const a of aufgaben) {
      if (kompakt) { rein('x', '', a); continue }
      if (!a.faellig_am) { rein('9999', 'Ohne Datum', a); continue }
      const k = tagKey(new Date(a.faellig_am))
      if (istUeberfaellig(a)) rein('0000', 'Überfällig', a)
      else if (k === h) rein(k, 'Heute', a)
      else if (k === m) rein(k, 'Morgen', a)
      else rein(k, new Date(a.faellig_am).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }), a)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, g]) => ({ k, ...g }))
  }, [aufgaben, kompakt])

  if (aufgaben.length === 0) return (
    <div className={kompakt ? 'py-6 text-center' : 'card py-14 text-center'}>
      <p className="text-3xl mb-2">🎉</p>
      <p className="text-sm text-ink-2">Keine offenen Aufgaben</p>
    </div>
  )

  return (
    <div className="space-y-4">
      {gruppen.map(g => (
        <div key={g.k} className="fade-up">
          {g.label && <p className={`text-[13px] font-semibold mb-2 px-1 ${g.k === '0000' ? 'text-[#d70015]' : 'text-ink'}`}>{g.label} <span className="text-ink-3 font-normal">· {g.items.length}</span></p>}
          <div className={kompakt ? 'space-y-2' : 'card divide-y divide-black/[0.05] overflow-hidden'}>
            {g.items.map(a => {
              const p = personVon(a.assignee_id)
              const dreh = a.dreh_id ? drehVon(a.dreh_id) : null
              const ueber = istUeberfaellig(a)
              return (
                <div key={a.id} onClick={() => onOeffnen(a)}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-white/50 ${kompakt ? 'rounded-2xl bg-white/70' : ''} ${a.erledigt ? 'opacity-55' : ''}`}>
                  <div className="pt-0.5"><Haken an={a.erledigt} onClick={() => onAbhaken(a)} /></div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] leading-snug ${a.erledigt ? 'line-through text-ink-3' : 'text-ink font-medium'}`}>{a.titel}</p>
                    {a.beschreibung && <p className="text-xs text-ink-2 mt-0.5 line-clamp-2">{a.beschreibung}</p>}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {ueber && g.k === '0000' && <span className="text-[11px] font-medium text-[#d70015]">{new Date(a.faellig_am).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>}
                      {zeitText(a) && <span className={`text-[11px] font-medium ${ueber ? 'text-[#d70015]' : 'text-ink-2'}`}>{zeitText(a)}</span>}
                      {a.quelle !== 'manuell' && (
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#7c3aed]/10 text-[#6d28d9]">
                          {a.quelle === 'deadline_raw' ? 'Deadline RAW' : 'Deadline Cutting'}{dreh ? ` · ${dreh.kunde_name}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  {zeigePerson && p && (
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2 whitespace-nowrap flex-shrink-0 pt-0.5">
                      <Avatar person={p} size={24} />
                      <span className="hidden sm:inline">{p.full_name?.split(' ')[0]}</span>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Kalender({ monat, setMonat, aufgaben, personen, onTag }) {
  const versatz = (monat.getDay() + 6) % 7   // Montag zuerst
  const tageImMonat = new Date(monat.getFullYear(), monat.getMonth() + 1, 0).getDate()
  const zellen = [...Array(versatz).fill(null), ...Array.from({ length: tageImMonat }, (_, i) => new Date(monat.getFullYear(), monat.getMonth(), i + 1))]
  while (zellen.length % 7) zellen.push(null)
  const proTag = useMemo(() => {
    const m = {}
    for (const a of aufgaben) if (a.faellig_am) { const k = tagKey(new Date(a.faellig_am)); (m[k] ||= []).push(a) }
    return m
  }, [aufgaben])
  const heute = tagKey(new Date())
  return (
    <div className="card p-3 md:p-4">
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-[17px] font-semibold text-ink tracking-tight">{monat.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</p>
        <div className="flex items-center gap-1">
          <button className="btn-icon" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() - 1, 1))}>‹</button>
          <button className="text-xs font-medium px-3 py-1.5 rounded-full hover:bg-black/5 text-ink" onClick={() => { const d = new Date(); setMonat(new Date(d.getFullYear(), d.getMonth(), 1)) }}>Heute</button>
          <button className="btn-icon" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() + 1, 1))}>›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 md:gap-1.5">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(t => <div key={t} className="text-[11px] font-semibold text-ink-3 text-center pb-1">{t}</div>)}
        {zellen.map((d, i) => {
          if (!d) return <div key={i} />
          const k = tagKey(d), liste = proTag[k] || []
          const ueber = liste.some(istUeberfaellig)
          return (
            <button key={i} onClick={() => onTag(k)}
              className={`min-h-[64px] md:min-h-[96px] rounded-xl md:rounded-2xl p-1.5 text-left flex flex-col transition-colors ${k === heute ? 'bg-white shadow-[0_4px_14px_-6px_rgba(0,0,0,0.2)]' : 'bg-white/40 hover:bg-white/70'}`}>
              <span className={`text-[12px] font-semibold w-6 h-6 rounded-full flex items-center justify-center ${k === heute ? 'bg-[#ff6b01] text-white' : 'text-ink'}`}>{d.getDate()}</span>
              {/* Handy: Punkte, Desktop: kurze Titel */}
              <div className="flex md:hidden flex-wrap gap-0.5 mt-1 px-0.5">
                {liste.slice(0, 6).map(a => <span key={a.id} className={`w-1.5 h-1.5 rounded-full ${a.erledigt ? 'opacity-30' : ''}`} style={{ background: farbeVon(a.assignee_id, personen) }} />)}
              </div>
              <div className="hidden md:flex flex-col gap-0.5 mt-1 min-w-0 w-full">
                {liste.slice(0, 3).map(a => (
                  <span key={a.id} className={`text-[10.5px] leading-tight truncate px-1.5 py-0.5 rounded-md ${a.erledigt ? 'line-through opacity-50' : ''}`}
                    style={{ background: farbeVon(a.assignee_id, personen) + '1f', color: farbeVon(a.assignee_id, personen) }}>{a.titel}</span>
                ))}
                {liste.length > 3 && <span className="text-[10px] text-ink-3 px-1">+{liste.length - 3} weitere</span>}
              </div>
              {ueber && <span className="mt-auto self-end w-1.5 h-1.5 rounded-full bg-[#ff3b30]" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Sheet({ titel, onClose, children }) {
  return (
    <div className="fixed inset-0 scrim z-[70] flex items-end sm:items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className="glass-strong rounded-[28px] w-full max-w-md max-h-[85vh] overflow-y-auto pop-in p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[17px] font-semibold text-ink tracking-tight">{titel}</h3>
          <button onClick={onClose} className="btn-icon w-7 h-7 text-base leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function AufgabeFormular({ start, personen, onSave, onDelete, onClose }) {
  const auto = start.quelle && start.quelle !== 'manuell'
  const d0 = start.faellig_am ? new Date(start.faellig_am) : null
  const z = n => String(n).padStart(2, '0')
  const [f, setF] = useState({
    id: start.id, titel: start.titel || '', beschreibung: start.beschreibung || '', assignee_id: start.assignee_id || '',
    datum: start.datum || (d0 ? tagKey(d0) : tagKey(new Date())),
    zeit: d0 && !start.ganztags ? `${z(d0.getHours())}:${z(d0.getMinutes())}` : '',
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  function absenden() {
    if (!f.titel.trim() || !f.assignee_id) return
    const ganztags = !f.zeit
    const faellig_am = f.datum ? new Date(`${f.datum}T${f.zeit || '12:00'}`).toISOString() : null
    onSave({ ...f, faellig_am, ganztags })
  }
  return (
    <Sheet titel={f.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} onClose={onClose}>
      {auto ? (
        <p className="text-sm text-ink-2">Diese Aufgabe kommt automatisch aus einer Dreh-Deadline. Ändere die Deadline direkt im Dreh.</p>
      ) : (
        <div className="space-y-3">
          <div><label className="label">Aufgabe</label><input autoFocus className="input" value={f.titel} onChange={e => set('titel', e.target.value)} placeholder="Was ist zu tun?" onKeyDown={e => e.key === 'Enter' && absenden()} /></div>
          <div><label className="label">Für</label>
            <select className="input" value={f.assignee_id} onChange={e => set('assignee_id', e.target.value)}>
              <option value="">Person wählen</option>
              {personen.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Datum</label><input type="date" className="input" value={f.datum} onChange={e => set('datum', e.target.value)} /></div>
            <div><label className="label">Uhrzeit (optional)</label><input type="time" className="input" value={f.zeit} onChange={e => set('zeit', e.target.value)} /></div>
          </div>
          <div><label className="label">Notiz</label><textarea className="input" rows={2} value={f.beschreibung} onChange={e => set('beschreibung', e.target.value)} placeholder="Optional" /></div>
          <div className="flex gap-2 pt-1">
            {f.id && <button onClick={() => onDelete(start)} className="btn-secondary !text-[#ff3b30]">Löschen</button>}
            <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button onClick={absenden} disabled={!f.titel.trim() || !f.assignee_id} className="btn-primary flex-1 disabled:opacity-40">Speichern</button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

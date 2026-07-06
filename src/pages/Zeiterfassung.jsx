import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { MeineSpesen, PersonSpesen } from './Spesen'
import MeineStunden from './MeineStunden'

/* ═══════════════════════════════════════
   HELPERS
═══════════════════════════════════════ */
const dec = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n }
const kurz = name => (name || '').replace(/^(Autohaus|Auto)\s+/i, '').trim()
const fmtH = h => (Math.round((h || 0) * 100) / 100).toString().replace('.', ',')
const toStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayStr = () => toStr(new Date())
const parse = s => new Date(s + 'T00:00:00')
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const wtag = dstr => { const wd = parse(dstr).getDay(); return wd === 0 ? 7 : wd } // 1=Mo … 7=So
const Spinner = () => <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

function ostern(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451)
  const mon = Math.floor((h + l - 7 * mm + 114) / 31), tag = ((h + l - 7 * mm + 114) % 31) + 1
  return new Date(y, mon - 1, tag)
}
function feiertageNRW(y) {
  const o = ostern(y), map = {}, add = (d, name) => { map[toStr(d)] = name }
  add(new Date(y, 0, 1), 'Neujahr'); add(addDays(o, -2), 'Karfreitag'); add(addDays(o, 1), 'Ostermontag')
  add(new Date(y, 4, 1), 'Tag der Arbeit'); add(addDays(o, 39), 'Christi Himmelfahrt'); add(addDays(o, 50), 'Pfingstmontag')
  add(addDays(o, 60), 'Fronleichnam'); add(new Date(y, 9, 3), 'Tag der Deutschen Einheit'); add(new Date(y, 10, 1), 'Allerheiligen')
  add(new Date(y, 11, 25), '1. Weihnachtstag'); add(new Date(y, 11, 26), '2. Weihnachtstag')
  return map
}
const istWochenende = dstr => { const wd = parse(dstr).getDay(); return wd === 0 || wd === 6 }
const arbeitstageOf = p => (Array.isArray(p?.arbeitstage) && p.arbeitstage.length ? p.arbeitstage : [1, 2, 3, 4, 5])

// Soll-Arbeitstage im Monat (brutto = laut Muster, netto = ohne Feiertage)
function sollTage(y, m, at, ftMap) {
  let brutto = 0, netto = 0; const last = new Date(y, m + 1, 0).getDate()
  for (let t = 1; t <= last; t++) {
    const ds = toStr(new Date(y, m, t))
    if (at.includes(wtag(ds))) { brutto++; if (!ftMap[ds]) netto++ }
  }
  return { brutto, netto }
}
function monatsSoll(profile, y, m, ftMap) {
  const soll = Number(profile?.soll_stunden || 0)
  if (soll <= 0) return 0
  const at = arbeitstageOf(zielProfil)
  const { brutto, netto } = sollTage(y, m, at, ftMap)
  if (profile?.soll_modus === 'monat') return brutto ? soll * (netto / brutto) : soll
  return (soll / at.length) * netto
}
function tagesSoll(profile, y, m, ftMap) {
  const soll = Number(profile?.soll_stunden || 0)
  if (soll <= 0) return 0
  const at = arbeitstageOf(zielProfil)
  if (profile?.soll_modus === 'monat') { const { netto } = sollTage(y, m, at, ftMap); return netto ? monatsSoll(profile, y, m, ftMap) / netto : 0 }
  return soll / at.length
}
// Arbeitstage in einem Datumsbereich (für Abwesenheits-Tage), ohne Feiertage
function arbeitstageImRange(von, bis, at, ftAll) {
  if (!von || !bis) return 0
  let c = 0, d = parse(von); const end = parse(bis)
  while (d <= end) { const ds = toStr(d); if (at.includes(wtag(ds)) && !ftAll[ds]) c++; d = addDays(d, 1) }
  return c
}

const ABW = {
  urlaub: { label: 'Urlaub', bg: 'bg-green-50', text: 'text-green-700', dot: '#16a34a', zaehltUrlaub: true },
  ueberstunden: { label: 'Überstunden abbauen', bg: 'bg-indigo-50', text: 'text-indigo-700', dot: '#6366f1' },
  sonderurlaub: { label: 'Sonderurlaub', bg: 'bg-teal-50', text: 'text-teal-700', dot: '#0d9488' },
  unbezahlt: { label: 'Sonderurlaub (unbezahlt)', bg: 'bg-gray-100', text: 'text-gray-600', dot: '#9ca3af' },
  schule: { label: 'Schule / Weiterbildung', bg: 'bg-purple-50', text: 'text-purple-700', dot: '#9333ea' },
  krankheit: { label: 'Krankheit', bg: 'bg-red-50', text: 'text-red-600', dot: '#dc2626', zaehltKrank: true },
  krankheit_kind: { label: 'Krankheit eines Kindes', bg: 'bg-rose-50', text: 'text-rose-600', dot: '#e11d48', zaehltKrank: true },
}
const abwLabel = t => ABW[t]?.label || t

function useKonten() {
  const [kunden, setKunden] = useState([])
  useEffect(() => { supabase.from('proj_kunden').select('id, name').order('name').then(({ data }) => { if (data) setKunden(data) }) }, [])
  return kunden
}
const kontoLabel = e => e.ist_intern ? 'Intern' : (e.proj_kunden?.name ? kurz(e.proj_kunden.name) : '—')
const grenzeStr = () => toStr(addDays(new Date(), -2))
const fmtDate = s => new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })

/* ═══════════════════════════════════════
   ZEITERFASSUNG
═══════════════════════════════════════ */
// Stunden aus Von/Bis minus Pause (Minuten); über Mitternacht wird +24h gerechnet
function stundenAus(von, bis, pauseMin) {
  if (!von || !bis) return 0
  const [sh, sm] = von.split(':').map(Number)
  const [eh, em] = bis.split(':').map(Number)
  let min = (eh * 60 + em) - (sh * 60 + sm)
  if (min < 0) min += 1440
  min -= (Number(pauseMin) || 0)
  return Math.max(0, Math.round(min / 60 * 100) / 100)
}

export function Zeiterfassung() {
  const { profile, isAdmin } = useAuth()
  const kunden = useKonten()
  const [tab, setTab] = useState('zeit')
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [anchor, setAnchor] = useState(todayStr())
  const [monthEntries, setMonthEntries] = useState([])
  const [abwesenheiten, setAbwesenheiten] = useState([])
  const [meineAntraege, setMeineAntraege] = useState([])
  const [adminAntraege, setAdminAntraege] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ beschreibung: '', konto: '', von: '', bis: '', pause: '' })
  const [abwForm, setAbwForm] = useState({ typ: 'urlaub', von_datum: '', bis_datum: '', halber_tag: false, grund: '' })
  const [editId, setEditId] = useState(null)
  const [changeReq, setChangeReq] = useState(null)
  const [saving, setSaving] = useState(false)
  const [zielUserId, setZielUserId] = useState('')   // Admin: für wen wird erfasst ('' = ich selbst)
  const [members, setMembers] = useState([])
  const zielProfil = isAdmin && zielUserId ? (members.find(x => x.id === zielUserId) || profile) : profile
  const zielIstExtern = isAdmin && zielUserId && zielProfil?.role === 'extern'

  const y = calMonth.getFullYear(), m = calMonth.getMonth()
  const ftMap = useMemo(() => feiertageNRW(y), [y])
  const monatsRange = useMemo(() => [toStr(new Date(y, m, 1)), toStr(new Date(y, m + 1, 0))], [y, m])

  useEffect(() => { if (profile?.id) fetchMonth() }, [profile?.id, monatsRange[0], zielUserId])
  useEffect(() => { if (isAdmin) supabase.from('profiles').select('id, full_name, role, soll_stunden, soll_modus, arbeitstage, urlaub_anspruch_tage').order('created_at').then(({ data }) => setMembers(data || [])) }, [isAdmin])
  useEffect(() => { if (!abwForm.von_datum) setAbwForm(p => ({ ...p, von_datum: anchor, bis_datum: p.bis_datum || anchor })) }, [anchor])

  async function fetchMonth() {
    setLoading(true)
    const [eintraege, abw, antr] = await Promise.all([
      supabase.from('zeiteintraege').select('*, proj_kunden(name)').eq('user_id', zielProfil.id)
        .gte('datum', monatsRange[0]).lte('datum', monatsRange[1]).order('created_at'),
      supabase.from('urlaubsantraege').select('typ, von_datum, bis_datum, halber_tag, status').eq('user_id', zielProfil.id)
        .eq('status', 'genehmigt').lte('von_datum', monatsRange[1]).gte('bis_datum', monatsRange[0]),
      supabase.from('zeit_aenderungsantraege').select('*, proj_kunden:neu_kunde_id(name), zeiteintraege(beschreibung, stunden, datum, ist_intern, kunde_id, proj_kunden(name)), profiles(full_name)').eq('status', 'offen'),
    ])
    setMonthEntries(eintraege.data || [])
    setAbwesenheiten(abw.data || [])
    const alle = antr.data || []
    setMeineAntraege(alle.filter(a => a.user_id === profile.id))
    setAdminAntraege(isAdmin ? alle : [])
    setLoading(false)
  }

  const dayEntries = monthEntries.filter(e => e.datum === anchor)
  const daySum = k => monthEntries.filter(e => e.datum === k).reduce((s, e) => s + Number(e.stunden || 0), 0)
  const monatIst = monthEntries.reduce((s, e) => s + Number(e.stunden || 0), 0)
  const monatSoll = monatsSoll(zielProfil, y, m, ftMap)
  const bearbeitbar = anchor >= grenzeStr()
  const offenerAntragFuer = id => meineAntraege.find(a => a.eintrag_id === id)
  const abwFor = dstr => abwesenheiten.find(a => dstr >= a.von_datum && dstr <= a.bis_datum) || null

  function resetForm() { setForm({ beschreibung: '', konto: '', von: '', bis: '', pause: '' }); setEditId(null); setChangeReq(null) }
  const kontoPayload = konto => konto === 'intern' ? { ist_intern: true, kunde_id: null } : { ist_intern: false, kunde_id: konto }

  async function save() {
    const std = stundenAus(form.von, form.bis, form.pause)
    if (!form.beschreibung.trim() || !form.von || !form.bis || std <= 0 || !form.konto) return
    setSaving(true)
    const base = { beschreibung: form.beschreibung.trim(), stunden: std, von_zeit: form.von, bis_zeit: form.bis, pause_min: Number(form.pause) || 0, ...kontoPayload(form.konto) }
    if (changeReq) {
      await supabase.from('zeit_aenderungsantraege').insert({ eintrag_id: changeReq.id, user_id: profile.id, art: 'update', neu_beschreibung: base.beschreibung, neu_stunden: base.stunden, neu_kunde_id: base.kunde_id, neu_ist_intern: base.ist_intern })
    } else if (editId) {
      await supabase.from('zeiteintraege').update(base).eq('id', editId)
    } else {
      await supabase.from('zeiteintraege').insert({ ...base, datum: anchor, user_id: zielProfil.id })
    }
    setSaving(false); resetForm(); fetchMonth()
  }

  async function saveAbw() {
    const { von_datum, bis_datum, halber_tag, typ, grund } = abwForm
    const von = von_datum, bis = bis_datum || von_datum
    if (!von) return
    setSaving(true)
    const ftAll = { ...feiertageNRW(parse(von).getFullYear()), ...feiertageNRW(parse(bis).getFullYear()) }
    let tage = arbeitstageImRange(von, bis, arbeitstageOf(zielProfil), ftAll)
    if (halber_tag && von === bis) tage = 0.5
    const row = { user_id: zielProfil.id, typ, von_datum: von, bis_datum: bis, halber_tag, tage, grund: grund || null }
    if (isAdmin) { row.status = 'genehmigt'; row.entschieden_von = profile.id; row.entschieden_am = new Date().toISOString() }
    await supabase.from('urlaubsantraege').insert(row)
    setSaving(false); setAbwForm({ typ: 'urlaub', von_datum: anchor, bis_datum: anchor, halber_tag: false, grund: '' }); fetchMonth()
  }

  function startEdit(e) { setChangeReq(null); setEditId(e.id); setForm({ beschreibung: e.beschreibung || '', konto: e.ist_intern ? 'intern' : (e.kunde_id || ''), von: (e.von_zeit || '').slice(0, 5), bis: (e.bis_zeit || '').slice(0, 5), pause: e.pause_min || '' }) }
  function startChangeReq(e) { setEditId(null); setChangeReq(e); setForm({ beschreibung: e.beschreibung || '', konto: e.ist_intern ? 'intern' : (e.kunde_id || ''), von: (e.von_zeit || '').slice(0, 5), bis: (e.bis_zeit || '').slice(0, 5), pause: e.pause_min || '' }) }
  async function remove(id) { await supabase.from('zeiteintraege').delete().eq('id', id); if (editId === id) resetForm(); fetchMonth() }
  async function reqDelete(e) { await supabase.from('zeit_aenderungsantraege').insert({ eintrag_id: e.id, user_id: profile.id, art: 'delete' }); fetchMonth() }

  async function entscheide(a, ok) {
    if (ok) {
      if (a.art === 'delete') await supabase.from('zeiteintraege').delete().eq('id', a.eintrag_id)
      else await supabase.from('zeiteintraege').update({ beschreibung: a.neu_beschreibung, stunden: a.neu_stunden, kunde_id: a.neu_kunde_id, ist_intern: a.neu_ist_intern }).eq('id', a.eintrag_id)
    }
    await supabase.from('zeit_aenderungsantraege').update({ status: ok ? 'genehmigt' : 'abgelehnt', entschieden_von: profile.id, entschieden_am: new Date().toISOString() }).eq('id', a.id)
    fetchMonth()
  }

  const anchorDate = parse(anchor)
  const isToday = anchor === todayStr()
  const anchorFeiertag = ftMap[anchor]
  const abwTageForm = useMemo(() => {
    const von = abwForm.von_datum, bis = abwForm.bis_datum || abwForm.von_datum
    if (!von) return 0
    const ftAll = { ...feiertageNRW(parse(von).getFullYear()), ...feiertageNRW(parse(bis).getFullYear()) }
    let t = arbeitstageImRange(von, bis, arbeitstageOf(zielProfil), ftAll)
    if (abwForm.halber_tag && von === bis) t = 0.5
    return t
  }, [abwForm, profile])

  // Für externe Minijobler: gleiche Ansicht wie sie selbst (Von/Bis + Fahrtkosten)
  if (zielIstExtern) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
        <div className="page-header">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Zeiterfassung</h2>
            <p className="text-xs text-gray-400">Minijob-Ansicht – erfasst für {zielProfil?.full_name}</p>
          </div>
        </div>
        <div className="card p-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500">Erfassen für:</span>
          <select className="input text-xs w-auto" value={zielUserId} onChange={e => { setZielUserId(e.target.value); resetForm() }}>
            <option value="">Mich selbst ({profile?.full_name || 'ich'})</option>
            {members.filter(mb => mb.id !== profile?.id).map(mb => <option key={mb.id} value={mb.id}>{mb.full_name}{mb.role === 'extern' ? ' (Extern)' : ''}</option>)}
          </select>
        </div>
        <MeineStunden userId={zielUserId} />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="page-header">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Zeiterfassung</h2>
          <p className="text-xs text-gray-400">Stunden & Abwesenheiten erfassen</p>
        </div>
      </div>

      {isAdmin && (
        <div className="card p-3 mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500">Erfassen für:</span>
          <select className="input text-xs w-auto" value={zielUserId} onChange={e => { setZielUserId(e.target.value); resetForm() }}>
            <option value="">Mich selbst ({profile?.full_name || 'ich'})</option>
            {members.filter(mb => mb.id !== profile?.id).map(mb => <option key={mb.id} value={mb.id}>{mb.full_name}{mb.role === 'extern' ? ' (Extern)' : ''}</option>)}
          </select>
          {zielUserId && <span className="text-xs text-[#ff6b01] font-medium">Du erfasst für {zielProfil?.full_name}. Wird direkt gespeichert.</span>}
        </div>
      )}

      {isAdmin && adminAntraege.length > 0 && (
        <div className="card p-4 mb-4 border-yellow-200">
          <h3 className="section-title text-yellow-600">Änderungsanträge ({adminAntraege.length})</h3>
          <div className="space-y-3">
            {adminAntraege.map(a => {
              const orig = a.zeiteintraege
              return (
                <div key={a.id} className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">{a.profiles?.full_name} · {orig?.datum && fmtDate(orig.datum)} · {a.art === 'delete' ? 'Löschung' : 'Änderung'}</p>
                  {a.art === 'delete'
                    ? <p className="text-sm text-gray-700 line-through">{orig?.beschreibung} — {fmtH(orig?.stunden)}h</p>
                    : <div className="text-sm space-y-0.5"><p className="text-gray-400 line-through">{orig?.beschreibung} — {fmtH(orig?.stunden)}h [{orig?.ist_intern ? 'Intern' : kurz(orig?.proj_kunden?.name)}]</p><p className="text-gray-800">↳ {a.neu_beschreibung} — {fmtH(a.neu_stunden)}h [{a.neu_ist_intern ? 'Intern' : kurz(a.proj_kunden?.name)}]</p></div>}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => entscheide(a, true)} className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-md font-medium hover:bg-green-200">✓ Genehmigen</button>
                    <button onClick={() => entscheide(a, false)} className="text-xs bg-red-50 text-red-600 px-2.5 py-1 rounded-md font-medium hover:bg-red-100">✕ Ablehnen</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0 space-y-4">
          {/* Erfassungskarte mit Tabs */}
          <div className="card p-4 space-y-3">
            <div className="flex bg-gray-100 rounded-lg p-1 w-fit gap-0.5">
              {[['zeit', 'Zeit'], ['abwesenheit', 'Abwesenheit']].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}</button>
              ))}
            </div>

            {tab === 'zeit' ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">{anchorDate.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}{isToday && <span className="ml-2 text-[10px] text-[#ff6b01] font-medium">HEUTE</span>}</p>
                  {(editId || changeReq) && <button onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-600">Abbrechen</button>}
                </div>
                {anchorFeiertag && <div className="bg-blue-50 text-blue-700 text-xs rounded-lg px-3 py-2">🎌 Feiertag: {anchorFeiertag}</div>}
                {changeReq && <div className="bg-yellow-50 text-yellow-700 text-xs rounded-lg px-3 py-2">Änderungsantrag – geht nach dem Speichern an Felix zur Freigabe.</div>}
                {!bearbeitbar && !changeReq && <div className="bg-gray-50 text-gray-500 text-xs rounded-lg px-3 py-2">Älter als 2 Tage: neue Einträge gehen direkt, Änderungen an bestehenden musst du beantragen.</div>}
                <div><label className="label">Was hast du gemacht?</label><textarea className="input text-sm" rows={2} value={form.beschreibung} onChange={e => setForm(p => ({ ...p, beschreibung: e.target.value }))} placeholder="z.B. Schnitt Reel Bierschneider, 3 Cuts + Musik" /></div>
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="label">Von</label><input type="time" className="input text-sm" value={form.von} onChange={e => setForm(p => ({ ...p, von: e.target.value }))} /></div>
                  <div><label className="label">Bis</label><input type="time" className="input text-sm" value={form.bis} onChange={e => setForm(p => ({ ...p, bis: e.target.value }))} /></div>
                  <div><label className="label">Pause (Min)</label><input type="number" inputMode="numeric" className="input text-sm" value={form.pause} onChange={e => setForm(p => ({ ...p, pause: e.target.value }))} placeholder="0" /></div>
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1"><label className="label">Konto</label>
                    <select className="input text-sm" value={form.konto} onChange={e => setForm(p => ({ ...p, konto: e.target.value }))}>
                      <option value="">Wählen…</option>
                      {kunden.map(k => <option key={k.id} value={k.id}>{kurz(k.name)}</option>)}
                      <option value="intern">Intern</option>
                    </select>
                  </div>
                  <div className="text-sm font-semibold text-[#ff6b01] pb-2.5 whitespace-nowrap">{stundenAus(form.von, form.bis, form.pause) > 0 ? `= ${fmtH(stundenAus(form.von, form.bis, form.pause))} h` : ''}</div>
                </div>
                <button onClick={save} disabled={saving} className="btn-primary w-full text-sm">{saving ? 'Speichert…' : changeReq ? 'Änderung beantragen →' : editId ? 'Änderung speichern' : '+ Eintrag hinzufügen'}</button>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-400">{isAdmin ? 'Wird direkt genehmigt.' : 'Antrag geht an Felix zur Genehmigung.'}</p>
                <div><label className="label">Typ</label>
                  <select className="input text-sm" value={abwForm.typ} onChange={e => setAbwForm(p => ({ ...p, typ: e.target.value }))}>
                    {Object.entries(ABW).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Von</label><input type="date" className="input text-sm" value={abwForm.von_datum} onChange={e => setAbwForm(p => ({ ...p, von_datum: e.target.value }))} /></div>
                  <div><label className="label">Bis</label><input type="date" className="input text-sm" value={abwForm.bis_datum} onChange={e => setAbwForm(p => ({ ...p, bis_datum: e.target.value }))} /></div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={abwForm.halber_tag} onChange={e => setAbwForm(p => ({ ...p, halber_tag: e.target.checked }))} /> Halber Tag (nur bei 1 Tag)</label>
                <div><label className="label">Notiz (optional)</label><input className="input text-sm" value={abwForm.grund} onChange={e => setAbwForm(p => ({ ...p, grund: e.target.value }))} placeholder="z.B. Erkältung" /></div>
                {abwTageForm > 0 && <p className="text-xs text-gray-500">{fmtH(abwTageForm)} Arbeitstag{abwTageForm !== 1 ? 'e' : ''} (nach deinem Arbeitstage-Muster, ohne Feiertage)</p>}
                <button onClick={saveAbw} disabled={saving} className="btn-primary w-full text-sm">{saving ? 'Speichert…' : isAdmin ? 'Eintragen →' : 'Antrag stellen →'}</button>
              </>
            )}
          </div>

          {/* Tagesliste */}
          {loading ? <Spinner /> : (
            <>
              {abwFor(anchor) && <div className={`card p-3 text-sm ${ABW[abwFor(anchor).typ]?.text}`}>{ABW[abwFor(anchor).typ]?.label}{abwFor(anchor).halber_tag ? ' (halber Tag)' : ''} an diesem Tag</div>}
              <TagesBalken entries={dayEntries} />
              {dayEntries.length > 0 ? (
                <div className="card divide-y divide-gray-50">
                  {dayEntries.map(e => {
                    const antrag = offenerAntragFuer(e.id)
                    return (
                      <div key={e.id} className="flex items-start gap-3 p-4">
                        <span className={`pill flex-shrink-0 ${e.ist_intern ? 'bg-gray-100 text-gray-600' : 'bg-[#ff6b01]/10 text-[#ff6b01]'}`}>{kontoLabel(e)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{e.beschreibung}</p>
                          {antrag && <p className="text-[10px] text-yellow-600 mt-1">⏳ {antrag.art === 'delete' ? 'Löschung' : 'Änderung'} beantragt</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className="text-sm font-semibold text-gray-700">{fmtH(e.stunden)}h</span>
                          {!antrag && (
                            <div className="flex gap-2">
                              {bearbeitbar
                                ? <><button onClick={() => startEdit(e)} className="text-xs text-gray-400 hover:text-gray-600" title="Bearbeiten">✎</button><button onClick={() => remove(e.id)} className="text-xs text-red-400 hover:text-red-600" title="Löschen">✕</button></>
                                : <><button onClick={() => startChangeReq(e)} className="text-[10px] text-gray-400 hover:text-gray-600">Ändern</button><button onClick={() => reqDelete(e)} className="text-[10px] text-red-400 hover:text-red-600">Löschen</button></>}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div className="flex items-center justify-between p-4 bg-gray-50/50"><span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tag gesamt</span><span className="text-sm font-semibold text-[#ff6b01]">{fmtH(daySum(anchor))}h</span></div>
                </div>
              ) : (
                <div className="card p-10 text-center"><p className="text-2xl mb-2">⏱</p><p className="text-sm text-gray-400">Noch keine Einträge für diesen Tag</p></div>
              )}
            </>
          )}

          {/* Fahrtkosten / Umkosten (auch fuer normale Mitarbeiter) */}
          <MeineSpesen month={calMonth} userId={zielUserId || undefined} />
        </div>

        {/* Monatskalender rechts */}
        <div className="lg:w-80 flex-shrink-0">
          <MonatsKalender calMonth={calMonth} setCalMonth={setCalMonth} anchor={anchor} setAnchor={setAnchor} daySum={daySum} ftMap={ftMap} abwFor={abwFor} monatIst={monatIst} monatSoll={monatSoll} />
        </div>
      </div>
    </div>
  )
}

/* ─── Tagesverlauf als Balken (Von/Bis) ─── */
function TagesBalken({ entries }) {
  const mit = (entries || []).filter(e => e.von_zeit && e.bis_zeit)
  if (!mit.length) return null
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const end = e => { let b = toMin(e.bis_zeit); if (b < toMin(e.von_zeit)) b += 1440; return b }
  let min = Math.min(...mit.map(e => toMin(e.von_zeit)))
  let max = Math.max(...mit.map(end))
  min = Math.floor(min / 60) * 60; max = Math.ceil(max / 60) * 60
  const range = Math.max(60, max - min)
  const ticks = []; for (let h = min; h <= max; h += Math.max(60, Math.round(range / 6 / 60) * 60)) ticks.push(h)
  return (
    <div className="card p-4">
      <h3 className="section-title">Tagesverlauf</h3>
      <div className="space-y-2.5">
        {mit.map(e => {
          const s = toMin(e.von_zeit), en = end(e)
          const left = (s - min) / range * 100, width = (en - s) / range * 100
          return (
            <div key={e.id}>
              <div className="flex justify-between text-[11px] text-gray-500 mb-1 gap-2">
                <span className="truncate">{kontoLabel(e)} · {e.beschreibung}</span>
                <span className="flex-shrink-0">{e.von_zeit.slice(0, 5)}–{e.bis_zeit.slice(0, 5)}{e.pause_min ? ` · ${e.pause_min}min Pause` : ''} · {fmtH(e.stunden)}h</span>
              </div>
              <div className="h-3.5 bg-gray-100 rounded-full relative overflow-hidden">
                <div className="h-full rounded-full absolute bg-[#ff6b01]" style={{ left: `${left}%`, width: `${Math.max(3, width)}%` }} />
              </div>
            </div>
          )
        })}
        <div className="flex justify-between text-[9px] text-gray-300 pt-0.5">
          {ticks.map(h => <span key={h}>{String(Math.floor((h % 1440) / 60)).padStart(2, '0')}:00</span>)}
        </div>
      </div>
    </div>
  )
}

/* ─── Monatskalender (Erfassung, kompakt) ─── */
function MonatsKalender({ calMonth, setCalMonth, anchor, setAnchor, daySum, ftMap, abwFor, monatIst, monatSoll }) {
  const y = calMonth.getFullYear(), m = calMonth.getMonth()
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const touchX = useRef(null)
  const prev = () => setCalMonth(new Date(y, m - 1, 1)), next = () => setCalMonth(new Date(y, m + 1, 1))

  const monatFeiertage = Object.entries(ftMap).filter(([ds]) => { const d = parse(ds); return d.getFullYear() === y && d.getMonth() === m }).sort((a, b) => a[0] < b[0] ? -1 : 1)

  return (
    <div className="card p-3 lg:sticky lg:top-4"
      onTouchStart={e => { touchX.current = e.touches[0].clientX }}
      onTouchEnd={e => { if (touchX.current == null) return; const dx = e.changedTouches[0].clientX - touchX.current; if (dx > 50) prev(); else if (dx < -50) next(); touchX.current = null }}>
      <div className="flex items-center justify-between mb-3 px-1">
        <button onClick={prev} className="btn-secondary text-xs px-2.5 py-1">‹</button>
        <span className="text-sm font-semibold text-gray-800">{calMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span>
        <button onClick={next} className="btn-secondary text-xs px-2.5 py-1">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">{WD.map(d => <div key={d} className="text-center text-[10px] font-semibold text-gray-300 py-1">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array(startPad).fill(null).map((_, i) => <div key={`p${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(tag => {
          const ds = toStr(new Date(y, m, tag))
          const sum = daySum(ds), ft = ftMap[ds], abw = abwFor(ds), we = istWochenende(ds)
          const sel = ds === anchor, heute = ds === todayStr()
          let bg = 'hover:bg-gray-50', txt = 'text-gray-700'
          if (we) txt = 'text-gray-300'
          if (ft) { bg = 'bg-blue-50 hover:bg-blue-100'; txt = 'text-blue-600' }
          if (abw) { bg = `${ABW[abw.typ]?.bg} hover:opacity-80`; txt = ABW[abw.typ]?.text }
          if (sel) bg = 'bg-[#ff6b01]/10 ring-1 ring-[#ff6b01]/40'
          return (
            <button key={tag} onClick={() => setAnchor(ds)} title={ft || (abw ? ABW[abw.typ]?.label : '')} className={`aspect-square rounded-md flex flex-col items-center justify-center gap-0.5 transition-all ${bg}`}>
              <span className={`text-xs ${heute ? 'text-[#ff6b01] font-bold' : txt} ${sel ? 'font-semibold' : ''}`}>{tag}</span>
              {sum > 0 ? <span className="text-[8px] leading-none text-[#ff6b01] font-semibold">{fmtH(sum)}</span> : abw ? <span className="w-1 h-1 rounded-full" style={{ background: ABW[abw.typ]?.dot }} /> : null}
            </button>
          )
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 px-1 space-y-1">
        <div className="flex items-center justify-between"><span className="text-xs text-gray-400">Monat Ist</span><span className="text-sm font-semibold text-[#ff6b01]">{fmtH(monatIst)}h</span></div>
        {monatSoll > 0 && <>
          <div className="flex items-center justify-between"><span className="text-xs text-gray-400">Soll</span><span className="text-xs font-medium text-gray-600">{fmtH(monatSoll)}h</span></div>
          <div className="flex items-center justify-between"><span className="text-xs text-gray-400">Differenz</span><span className={`text-xs font-semibold ${monatIst - monatSoll >= 0 ? 'text-green-600' : 'text-gray-500'}`}>{monatIst - monatSoll >= 0 ? '+' : ''}{fmtH(monatIst - monatSoll)}h</span></div>
        </>}
      </div>
      {monatFeiertage.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 px-1">
          <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider mb-1">Feiertage</p>
          {monatFeiertage.map(([ds, name]) => <div key={ds} className="flex justify-between text-[11px] text-gray-500 py-0.5"><span>{parse(ds).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span><span className="text-blue-600">{name}</span></div>)}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════
   URLAUB / ABWESENHEITEN (Übersicht + Genehmigung)
═══════════════════════════════════════ */
export function Urlaub() {
  const { profile, isAdmin } = useAuth()
  const [antraege, setAntraege] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const jahr = new Date().getFullYear()

  useEffect(() => { fetchAll() }, [])
  useEffect(() => { if (isAdmin) supabase.from('profiles').select('id, full_name').order('created_at').then(({ data }) => setMembers(data || [])) }, [isAdmin])

  async function fetchAll() {
    setLoading(true)
    const { data } = await supabase.from('urlaubsantraege').select('*, profiles(full_name)').order('von_datum', { ascending: false })
    setAntraege(data || []); setLoading(false)
  }
  const meine = antraege.filter(a => a.user_id === profile?.id)
  const offeneFremde = antraege.filter(a => a.user_id !== profile?.id && a.status === 'offen')
  const urlaubJahr = meine.filter(a => a.typ === 'urlaub' && a.status === 'genehmigt' && new Date(a.von_datum).getFullYear() === jahr).reduce((s, a) => s + Number(a.tage || 0), 0)
  const anspruch = Number(profile?.urlaub_anspruch_tage || 0)

  async function entscheide(id, status) { await supabase.from('urlaubsantraege').update({ status, entschieden_von: profile.id, entschieden_am: new Date().toISOString() }).eq('id', id); fetchAll() }
  async function zuruecknehmen(id) { await supabase.from('urlaubsantraege').delete().eq('id', id); fetchAll() }

  const statusPill = { offen: 'bg-yellow-100 text-yellow-700', genehmigt: 'bg-green-100 text-green-700', abgelehnt: 'bg-red-100 text-red-600' }
  if (loading) return <Spinner />

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="page-header"><div><h2 className="text-base font-semibold text-gray-900">Urlaub & Abwesenheit</h2><p className="text-xs text-gray-400">Übersicht & Genehmigung · Erfassen unter „Zeiterfassung → Abwesenheit"</p></div></div>

      {anspruch > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[['Anspruch', anspruch, 'text-gray-700'], ['Genommen', urlaubJahr, 'text-gray-700'], ['Rest ' + jahr, anspruch - urlaubJahr, 'text-[#ff6b01]']].map(([l, v, c]) => (
            <div key={l} className="card p-4 text-center"><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{l}</p><p className={`text-xl font-semibold ${c}`}>{fmtH(v)}</p><p className="text-[10px] text-gray-400">Tage</p></div>
          ))}
        </div>
      )}

      {isAdmin && offeneFremde.length > 0 && (
        <div className="card p-4 border-yellow-200">
          <h3 className="section-title text-yellow-600">Zu genehmigen ({offeneFremde.length})</h3>
          <div className="space-y-2">
            {offeneFremde.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800">{a.profiles?.full_name || '—'} · {abwLabel(a.typ)}</p><p className="text-xs text-gray-400">{fmtDate(a.von_datum)} – {fmtDate(a.bis_datum)} · {fmtH(a.tage)} Tage{a.halber_tag ? ' (halb)' : ''}{a.grund ? ` · ${a.grund}` : ''}</p></div>
                <button onClick={() => entscheide(a.id, 'genehmigt')} className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-md font-medium hover:bg-green-200">✓</button>
                <button onClick={() => entscheide(a.id, 'abgelehnt')} className="text-xs bg-red-50 text-red-600 px-2.5 py-1 rounded-md font-medium hover:bg-red-100">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="card p-4">
          <h3 className="section-title">Alle Anträge (Team)</h3>
          {antraege.filter(a => a.user_id !== profile?.id && a.status !== 'offen').length === 0
            ? <p className="text-sm text-gray-400 py-2 text-center">Keine weiteren Einträge</p>
            : <div className="space-y-2">{antraege.filter(a => a.user_id !== profile?.id && a.status !== 'offen').slice(0, 30).map(a => (
              <div key={a.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                <span className={`pill flex-shrink-0 ${statusPill[a.status]}`}>{a.status === 'genehmigt' ? 'OK' : 'Abgelehnt'}</span>
                <div className="flex-1 min-w-0"><p className="text-sm text-gray-800">{a.profiles?.full_name} · {abwLabel(a.typ)}</p><p className="text-xs text-gray-400">{fmtDate(a.von_datum)} – {fmtDate(a.bis_datum)} · {fmtH(a.tage)} Tage</p></div>
              </div>))}</div>}
        </div>
      )}

      <div className="card p-4">
        <h3 className="section-title">Meine Anträge</h3>
        {meine.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">Noch keine Anträge</p> : (
          <div className="space-y-2">
            {meine.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <span className={`pill flex-shrink-0 ${statusPill[a.status]}`}>{a.status === 'offen' ? 'Offen' : a.status === 'genehmigt' ? 'Genehmigt' : 'Abgelehnt'}</span>
                <div className="flex-1 min-w-0"><p className="text-sm text-gray-800">{abwLabel(a.typ)} · {fmtDate(a.von_datum)} – {fmtDate(a.bis_datum)}</p><p className="text-xs text-gray-400">{fmtH(a.tage)} Tage{a.halber_tag ? ' (halb)' : ''}{a.grund ? ` · ${a.grund}` : ''}</p></div>
                {a.status === 'offen' && <button onClick={() => zuruecknehmen(a.id)} className="text-xs text-red-400 hover:text-red-600 flex-shrink-0">Zurückziehen</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════
   AUSWERTUNG — Stundenkonto (Kalender) + Konto-Aufschlüsselung
═══════════════════════════════════════ */
export function Auswertung() {
  const { profile, isAdmin } = useAuth()
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [entries, setEntries] = useState([])
  const [abwesenheiten, setAbwesenheiten] = useState([])
  const [members, setMembers] = useState([])
  const [selUser, setSelUser] = useState(null) // null = wird gesetzt
  const [loading, setLoading] = useState(true)
  const [showReport, setShowReport] = useState(false)

  const y = month.getFullYear(), mo = month.getMonth()
  const von = toStr(new Date(y, mo, 1)), bis = toStr(new Date(y, mo + 1, 0))
  const ftMap = useMemo(() => feiertageNRW(y), [y])
  const jahr = y

  useEffect(() => {
    if (isAdmin) supabase.from('profiles').select('id, full_name, soll_stunden, soll_modus, arbeitstage, urlaub_anspruch_tage').order('created_at').then(({ data }) => {
      setMembers(data || [])
      setSelUser(prev => prev ?? (profile?.id || 'alle'))
    })
    else setSelUser(profile?.id)
  }, [isAdmin, profile?.id])

  useEffect(() => { fetchData() }, [von, bis])

  async function fetchData() {
    setLoading(true)
    const [e, a] = await Promise.all([
      supabase.from('zeiteintraege').select('*, proj_kunden(name), profiles(full_name)').gte('datum', von).lte('datum', bis).order('datum'),
      supabase.from('urlaubsantraege').select('*, profiles(full_name)').eq('status', 'genehmigt')
        .gte('von_datum', `${jahr}-01-01`).lte('bis_datum', `${jahr}-12-31`),
    ])
    setEntries(e.data || []); setAbwesenheiten(a.data || []); setLoading(false)
  }

  const einzel = selUser && selUser !== 'alle'
  const aktProfil = useMemo(() => einzel ? (isAdmin ? members.find(x => x.id === selUser) : profile) : null, [einzel, isAdmin, members, selUser, profile])

  const filtered = useMemo(() => {
    if (!isAdmin) return entries.filter(e => e.user_id === profile?.id)
    return selUser === 'alle' || !selUser ? entries : entries.filter(e => e.user_id === selUser)
  }, [entries, selUser, isAdmin, profile?.id])

  const total = filtered.reduce((s, e) => s + Number(e.stunden || 0), 0)
  const perKunde = useMemo(() => { const map = {}; filtered.forEach(e => { const k = kontoLabel(e); map[k] = (map[k] || 0) + Number(e.stunden || 0) }); return Object.entries(map).sort((a, b) => b[1] - a[1]) }, [filtered])
  const perUser = useMemo(() => { const map = {}; filtered.forEach(e => { const k = e.profiles?.full_name || '—'; map[k] = (map[k] || 0) + Number(e.stunden || 0) }); return Object.entries(map).sort((a, b) => b[1] - a[1]) }, [filtered])
  const maxKunde = perKunde[0]?.[1] || 1

  // Stundenkonto (nur Einzel-MA)
  const abwUser = useMemo(() => einzel ? abwesenheiten.filter(a => a.user_id === selUser) : [], [abwesenheiten, einzel, selUser])
  const abwForDay = dstr => abwUser.find(a => dstr >= a.von_datum && dstr <= a.bis_datum) || null
  const tSoll = einzel ? tagesSoll(aktProfil, y, mo, ftMap) : 0
  const mSoll = einzel ? monatsSoll(aktProfil, y, mo, ftMap) : 0
  // Gutschrift für Abwesenheiten im Monat (Arbeitstage * Tagessoll)
  const gutschrift = useMemo(() => {
    if (!einzel) return 0
    const at = arbeitstageOf(aktProfil); let tage = 0
    const last = new Date(y, mo + 1, 0).getDate()
    for (let t = 1; t <= last; t++) { const ds = toStr(new Date(y, mo, t)); if (at.includes(wtag(ds)) && !ftMap[ds]) { const a = abwForDay(ds); if (a) tage += a.halber_tag && a.von_datum === a.bis_datum ? 0.5 : 1 } }
    return tage * tSoll
  }, [einzel, aktProfil, y, mo, ftMap, abwUser, tSoll])
  const effIst = total + gutschrift
  const saldo = einzel && mSoll > 0 ? effIst - mSoll : null

  const urlaubJahr = abwUser.filter(a => a.typ === 'urlaub').reduce((s, a) => s + Number(a.tage || 0), 0)
  const krankJahr = abwUser.filter(a => ABW[a.typ]?.zaehltKrank).reduce((s, a) => s + Number(a.tage || 0), 0)

  function buildReport() {
    const label = einzel ? (aktProfil?.full_name || '') : 'Alle Mitarbeiter'
    let t = `ZEITAUSWERTUNG ${month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}\n${label} · Ist: ${fmtH(total)}h${saldo !== null ? ` · Soll: ${fmtH(mSoll)}h · Saldo: ${saldo >= 0 ? '+' : ''}${fmtH(saldo)}h` : ''}\n\n— NACH KONTO —\n`
    perKunde.forEach(([k, h]) => { t += `${k}: ${fmtH(h)}h (${total ? Math.round(h / total * 100) : 0}%)\n` })
    if (!einzel) { t += `\n— NACH MITARBEITER —\n`; perUser.forEach(([k, h]) => { t += `${k}: ${fmtH(h)}h\n` }) }
    t += `\n— EINTRÄGE —\n`; const byDay = {}; filtered.forEach(e => { (byDay[e.datum] = byDay[e.datum] || []).push(e) })
    Object.keys(byDay).sort().forEach(d => { t += `\n${parse(d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}\n`; byDay[d].forEach(e => { t += `  • [${kontoLabel(e)}] ${e.beschreibung} — ${fmtH(e.stunden)}h${!einzel ? ` (${e.profiles?.full_name || '—'})` : ''}\n` }) })
    return t
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div className="page-header">
        <div><h2 className="text-base font-semibold text-gray-900">Auswertung</h2><p className="text-xs text-gray-400">Stundenkonto, Feiertage & Kunden-Zeiten</p></div>
        <div className="flex gap-2">
          <button onClick={() => setMonth(new Date(y, mo - 1, 1))} className="btn-secondary text-xs px-3">‹</button>
          <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }} className="btn-secondary text-xs px-3">Aktuell</button>
          <button onClick={() => setMonth(new Date(y, mo + 1, 1))} className="btn-secondary text-xs px-3">›</button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-gray-800">{month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</p>
        {isAdmin && (
          <select className="input text-xs w-auto" value={selUser || 'alle'} onChange={e => setSelUser(e.target.value)}>
            <option value="alle">Alle Mitarbeiter</option>
            {members.map(mb => <option key={mb.id} value={mb.id}>{mb.full_name}</option>)}
          </select>
        )}
      </div>

      {loading ? <Spinner /> : (
        <>
          {/* Kennzahlen */}
          {einzel ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="card p-4"><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Ist (Monat)</p><p className="text-xl font-semibold text-[#ff6b01]">{fmtH(total)}h</p></div>
              <div className="card p-4"><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Soll</p><p className="text-xl font-semibold text-gray-700">{mSoll > 0 ? fmtH(mSoll) + 'h' : '–'}</p></div>
              <div className="card p-4"><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Saldo{gutschrift > 0 ? ' inkl. Abw.' : ''}</p><p className={`text-xl font-semibold ${saldo === null ? 'text-gray-400' : saldo >= 0 ? 'text-green-600' : 'text-red-500'}`}>{saldo === null ? '–' : `${saldo >= 0 ? '+' : ''}${fmtH(saldo)}h`}</p></div>
              <div className="card p-4"><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Urlaub / Krank ({jahr})</p><p className="text-xl font-semibold text-gray-700">{fmtH(urlaubJahr)}{Number(aktProfil?.urlaub_anspruch_tage) ? <span className="text-sm text-gray-400">/{aktProfil.urlaub_anspruch_tage}</span> : ''} <span className="text-sm text-gray-400">· {fmtH(krankJahr)}</span></p></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-4"><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Gesamt</p><p className="text-2xl font-semibold text-[#ff6b01]">{fmtH(total)}h</p></div>
              <div className="card p-4"><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Einträge</p><p className="text-2xl font-semibold text-gray-700">{filtered.length}</p></div>
            </div>
          )}

          {/* Stundenkonto-Kalender (Einzel-MA) */}
          {einzel && <KontoKalender y={y} mo={mo} ftMap={ftMap} daySum={ds => filtered.filter(e => e.datum === ds).reduce((s, e) => s + Number(e.stunden || 0), 0)} abwForDay={abwForDay} arbeitstage={arbeitstageOf(aktProfil)} />}

          {/* Nach Konto */}
          <div className="card p-4">
            <h3 className="section-title">Nach Konto</h3>
            {perKunde.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center">Keine Einträge in diesem Monat</p> : (
              <div className="space-y-2.5">{perKunde.map(([k, h]) => (
                <div key={k}><div className="flex items-center justify-between mb-1"><span className="text-sm text-gray-700">{k}</span><span className="text-xs font-medium text-gray-500">{fmtH(h)}h · {total ? Math.round(h / total * 100) : 0}%</span></div><div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#ff6b01] rounded-full" style={{ width: `${(h / maxKunde) * 100}%` }} /></div></div>
              ))}</div>
            )}
          </div>

          {!einzel && perUser.length > 0 && (
            <div className="card p-4"><h3 className="section-title">Nach Mitarbeiter</h3><div className="space-y-1">{perUser.map(([k, h]) => <div key={k} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0"><span className="text-sm text-gray-700">{k}</span><span className="text-sm font-medium text-[#ff6b01]">{fmtH(h)}h</span></div>)}</div></div>
          )}

          {filtered.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between"><div><h3 className="section-title mb-0">Report</h3><p className="text-xs text-gray-400 mt-1">Kompletter Text zum Kopieren – für die Monatsauswertung.</p></div><button onClick={() => setShowReport(!showReport)} className="btn-secondary text-xs py-1.5 px-3">{showReport ? 'Verbergen' : '📋 Anzeigen'}</button></div>
              {showReport && <textarea readOnly className="input text-xs font-mono mt-3 leading-relaxed" rows={14} value={buildReport()} onFocus={e => e.target.select()} />}
            </div>
          )}

          {/* Fahrtkosten / Umkosten – eigene (MA) bzw. ausgewählte Person (Admin) */}
          {!isAdmin && <MeineSpesen month={month} />}
          {isAdmin && einzel && <PersonSpesen month={month} userId={selUser} name={aktProfil?.full_name} />}
        </>
      )}
    </div>
  )
}

/* ─── Stundenkonto-Kalender (Wochenzeilen mit Summen) ─── */
function KontoKalender({ y, mo, ftMap, daySum, abwForDay, arbeitstage }) {
  // Wochenzeilen (Mo-Start), inkl. KW + Wochensumme
  const first = new Date(y, mo, 1)
  const startPad = (first.getDay() + 6) % 7
  const days = new Date(y, mo + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let t = 1; t <= days; t++) cells.push(toStr(new Date(y, mo, t)))
  while (cells.length % 7) cells.push(null)
  const weeks = []; for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const isoWeek = dstr => { const d = parse(dstr); const t = new Date(d); t.setDate(t.getDate() + 4 - (d.getDay() || 7)); const ys = new Date(t.getFullYear(), 0, 1); return Math.ceil(((t - ys) / 86400000 + 1) / 7) }
  const monatSum = cells.filter(Boolean).reduce((s, ds) => s + daySum(ds), 0)

  return (
    <div className="card p-3 md:p-4 overflow-x-auto table-scroll">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[32px_repeat(7,1fr)_56px] gap-1 mb-1">
          <div className="text-[10px] font-semibold text-gray-300 text-center py-1">KW</div>
          {WD.map(d => <div key={d} className="text-[10px] font-semibold text-gray-300 py-1 pl-1">{d}</div>)}
          <div className="text-[10px] font-semibold text-gray-300 text-right py-1 pr-1">Summe</div>
        </div>
        {weeks.map((wk, wi) => {
          const wkSum = wk.filter(Boolean).reduce((s, ds) => s + daySum(ds), 0)
          const kw = wk.find(Boolean) ? isoWeek(wk.find(Boolean)) : ''
          return (
            <div key={wi} className="grid grid-cols-[32px_repeat(7,1fr)_56px] gap-1 mb-1">
              <div className="text-[10px] text-gray-400 text-center flex items-center justify-center">{kw}</div>
              {wk.map((ds, di) => {
                if (!ds) return <div key={di} className="min-h-[52px] rounded-md bg-gray-50/40" />
                const sum = daySum(ds), ft = ftMap[ds], abw = abwForDay(ds), we = istWochenende(ds), heute = ds === todayStr()
                let bg = 'bg-gray-50/40'
                if (ft) bg = 'bg-blue-50'
                if (abw) bg = ABW[abw.typ]?.bg
                return (
                  <div key={di} className={`min-h-[52px] rounded-md p-1 ${bg} ${heute ? 'ring-1 ring-[#ff6b01]/50' : ''}`}>
                    <div className={`text-[10px] ${we ? 'text-gray-300' : 'text-gray-500'} ${heute ? 'text-[#ff6b01] font-bold' : ''}`}>{parse(ds).getDate()}</div>
                    {ft ? <div className="text-[9px] text-blue-600 leading-tight truncate" title={ft}>{ft}</div>
                      : abw ? <div className={`text-[9px] leading-tight truncate ${ABW[abw.typ]?.text}`} title={ABW[abw.typ]?.label}>{ABW[abw.typ]?.label}{abw.halber_tag ? ' ½' : ''}</div>
                        : sum > 0 ? <div className="text-[11px] font-semibold text-[#ff6b01] mt-1">{fmtH(sum)}h</div> : null}
                  </div>
                )
              })}
              <div className="text-xs font-medium text-gray-600 text-right pr-1 flex items-center justify-end">{wkSum > 0 ? fmtH(wkSum) + 'h' : '–'}</div>
            </div>
          )
        })}
        <div className="grid grid-cols-[32px_repeat(7,1fr)_56px] gap-1 mt-2 pt-2 border-t border-gray-100">
          <div className="col-span-8 text-xs font-semibold text-gray-400 uppercase tracking-wider pl-1 flex items-center">Monat gesamt</div>
          <div className="text-sm font-semibold text-[#ff6b01] text-right pr-1">{fmtH(monatSum)}h</div>
        </div>
      </div>
    </div>
  )
}

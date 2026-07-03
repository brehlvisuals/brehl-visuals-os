import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

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
const Spinner = () => <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

function werktage(vonStr, bisStr) {
  if (!vonStr || !bisStr) return 0
  let c = 0, d = parse(vonStr); const end = parse(bisStr)
  while (d <= end) { const wd = d.getDay(); if (wd !== 0 && wd !== 6) c++; d.setDate(d.getDate() + 1) }
  return c
}

// Ostersonntag (Gauß) → für bewegliche Feiertage
function ostern(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mon = Math.floor((h + l - 7 * m + 114) / 31), tag = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(y, mon - 1, tag)
}
// Gesetzliche Feiertage NRW → { 'YYYY-MM-DD': 'Name' }
function feiertageNRW(y) {
  const o = ostern(y)
  const map = {}
  const add = (d, name) => { map[toStr(d)] = name }
  add(new Date(y, 0, 1), 'Neujahr')
  add(addDays(o, -2), 'Karfreitag')
  add(addDays(o, 1), 'Ostermontag')
  add(new Date(y, 4, 1), 'Tag der Arbeit')
  add(addDays(o, 39), 'Christi Himmelfahrt')
  add(addDays(o, 50), 'Pfingstmontag')
  add(addDays(o, 60), 'Fronleichnam')
  add(new Date(y, 9, 3), 'Tag der Deutschen Einheit')
  add(new Date(y, 10, 1), 'Allerheiligen')
  add(new Date(y, 11, 25), '1. Weihnachtstag')
  add(new Date(y, 11, 26), '2. Weihnachtstag')
  return map
}
const istWochenende = dstr => { const wd = parse(dstr).getDay(); return wd === 0 || wd === 6 }

function werktageImMonat(y, m) {
  let c = 0; const last = new Date(y, m + 1, 0).getDate()
  for (let t = 1; t <= last; t++) { const wd = new Date(y, m, t).getDay(); if (wd !== 0 && wd !== 6) c++ }
  return c
}
// Monats-Soll (mit Feiertagsabzug an Werktagen)
function monatsSoll(profile, y, m, ftMap) {
  const wert = Number(profile?.soll_stunden || 0)
  if (wert <= 0) return 0
  const werktageGes = werktageImMonat(y, m)
  let ftWerktags = 0
  Object.keys(ftMap).forEach(ds => {
    const d = parse(ds)
    if (d.getFullYear() === y && d.getMonth() === m && !istWochenende(ds)) ftWerktags++
  })
  const netto = Math.max(0, werktageGes - ftWerktags)
  if (profile?.soll_modus === 'monat') return werktageGes ? wert * (netto / werktageGes) : wert
  return (wert / 5) * netto
}

function useKonten() {
  const [kunden, setKunden] = useState([])
  useEffect(() => {
    supabase.from('proj_kunden').select('id, name').order('name').then(({ data }) => { if (data) setKunden(data) })
  }, [])
  return kunden
}
const kontoLabel = e => e.ist_intern ? 'Intern' : (e.proj_kunden?.name ? kurz(e.proj_kunden.name) : '—')

// 2-Tage-Regel (deckungsgleich mit RLS: datum >= current_date - 2)
const grenzeStr = () => toStr(addDays(new Date(), -2))

/* ═══════════════════════════════════════
   ZEITERFASSUNG
═══════════════════════════════════════ */
export function Zeiterfassung() {
  const { profile, isAdmin } = useAuth()
  const kunden = useKonten()
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [anchor, setAnchor] = useState(todayStr())
  const [monthEntries, setMonthEntries] = useState([])
  const [abwesenheiten, setAbwesenheiten] = useState([])
  const [meineAntraege, setMeineAntraege] = useState([]) // offene Änderungsanträge (eigene)
  const [adminAntraege, setAdminAntraege] = useState([]) // offene Änderungsanträge (alle, für Admin)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ beschreibung: '', stunden: '', konto: '' })
  const [editId, setEditId] = useState(null)
  const [changeReq, setChangeReq] = useState(null) // Eintrag, für den ein Änderungsantrag gestellt wird
  const [saving, setSaving] = useState(false)

  const y = calMonth.getFullYear(), m = calMonth.getMonth()
  const ftMap = useMemo(() => feiertageNRW(y), [y])
  const monatsRange = useMemo(() => [toStr(new Date(y, m, 1)), toStr(new Date(y, m + 1, 0))], [y, m])

  useEffect(() => { if (profile?.id) fetchMonth() }, [profile?.id, monatsRange[0]])

  async function fetchMonth() {
    setLoading(true)
    const [eintraege, abw, antr] = await Promise.all([
      supabase.from('zeiteintraege').select('*, proj_kunden(name)').eq('user_id', profile.id)
        .gte('datum', monatsRange[0]).lte('datum', monatsRange[1]).order('created_at'),
      supabase.from('urlaubsantraege').select('typ, von_datum, bis_datum, user_id').eq('user_id', profile.id)
        .eq('status', 'genehmigt').lte('von_datum', monatsRange[1]).gte('bis_datum', monatsRange[0]),
      supabase.from('zeit_aenderungsantraege').select('*, proj_kunden:neu_kunde_id(name), zeiteintraege(beschreibung, stunden, datum, ist_intern, kunde_id, proj_kunden(name)), profiles(full_name)')
        .eq('status', 'offen'),
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
  const monatSoll = monatsSoll(profile, y, m, ftMap)
  const bearbeitbar = anchor >= grenzeStr()
  const offenerAntragFuer = id => meineAntraege.find(a => a.eintrag_id === id)

  // Abwesenheit pro Tag (Urlaub/Krankheit)
  const abwFor = dstr => {
    const a = abwesenheiten.find(x => dstr >= x.von_datum && dstr <= x.bis_datum)
    return a?.typ || null
  }

  function resetForm() { setForm({ beschreibung: '', stunden: '', konto: '' }); setEditId(null); setChangeReq(null) }

  const kontoPayload = konto => konto === 'intern' ? { ist_intern: true, kunde_id: null } : { ist_intern: false, kunde_id: konto }

  async function save() {
    const std = dec(form.stunden)
    if (!form.beschreibung.trim() || std <= 0 || !form.konto) return
    setSaving(true)
    const base = { beschreibung: form.beschreibung.trim(), stunden: std, ...kontoPayload(form.konto) }
    if (changeReq) {
      // Änderungsantrag für alten Eintrag
      await supabase.from('zeit_aenderungsantraege').insert({
        eintrag_id: changeReq.id, user_id: profile.id, art: 'update',
        neu_beschreibung: base.beschreibung, neu_stunden: base.stunden,
        neu_kunde_id: base.kunde_id, neu_ist_intern: base.ist_intern,
      })
    } else if (editId) {
      await supabase.from('zeiteintraege').update(base).eq('id', editId)
    } else {
      await supabase.from('zeiteintraege').insert({ ...base, datum: anchor, user_id: profile.id })
    }
    setSaving(false); resetForm(); fetchMonth()
  }

  function startEdit(e) {
    setChangeReq(null); setEditId(e.id)
    setForm({ beschreibung: e.beschreibung || '', stunden: fmtH(e.stunden), konto: e.ist_intern ? 'intern' : (e.kunde_id || '') })
  }
  function startChangeReq(e) {
    setEditId(null); setChangeReq(e)
    setForm({ beschreibung: e.beschreibung || '', stunden: fmtH(e.stunden), konto: e.ist_intern ? 'intern' : (e.kunde_id || '') })
  }
  async function remove(id) {
    await supabase.from('zeiteintraege').delete().eq('id', id)
    if (editId === id) resetForm()
    fetchMonth()
  }
  async function reqDelete(e) {
    await supabase.from('zeit_aenderungsantraege').insert({ eintrag_id: e.id, user_id: profile.id, art: 'delete' })
    fetchMonth()
  }

  // Admin: Änderungsantrag entscheiden
  async function entscheide(a, ok) {
    if (ok) {
      if (a.art === 'delete') {
        await supabase.from('zeiteintraege').delete().eq('id', a.eintrag_id)
      } else {
        await supabase.from('zeiteintraege').update({
          beschreibung: a.neu_beschreibung, stunden: a.neu_stunden,
          kunde_id: a.neu_kunde_id, ist_intern: a.neu_ist_intern,
        }).eq('id', a.eintrag_id)
      }
    }
    await supabase.from('zeit_aenderungsantraege').update({
      status: ok ? 'genehmigt' : 'abgelehnt', entschieden_von: profile.id, entschieden_am: new Date().toISOString(),
    }).eq('id', a.id)
    fetchMonth()
  }

  const anchorDate = parse(anchor)
  const isToday = anchor === todayStr()
  const anchorFeiertag = ftMap[anchor]

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="page-header">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Zeiterfassung</h2>
          <p className="text-xs text-gray-400">Deine Stunden pro Tag – jede Aufgabe auf ein Konto</p>
        </div>
      </div>

      {/* Admin: offene Änderungsanträge */}
      {isAdmin && adminAntraege.length > 0 && (
        <div className="card p-4 mb-4 border-yellow-200">
          <h3 className="section-title text-yellow-600">Änderungsanträge ({adminAntraege.length})</h3>
          <div className="space-y-3">
            {adminAntraege.map(a => {
              const orig = a.zeiteintraege
              return (
                <div key={a.id} className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">
                    {a.profiles?.full_name} · {orig?.datum && parse(orig.datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    · {a.art === 'delete' ? 'Löschung' : 'Änderung'}
                  </p>
                  {a.art === 'delete' ? (
                    <p className="text-sm text-gray-700 line-through">{orig?.beschreibung} — {fmtH(orig?.stunden)}h</p>
                  ) : (
                    <div className="text-sm space-y-0.5">
                      <p className="text-gray-400 line-through">{orig?.beschreibung} — {fmtH(orig?.stunden)}h [{orig?.ist_intern ? 'Intern' : kurz(orig?.proj_kunden?.name)}]</p>
                      <p className="text-gray-800">↳ {a.neu_beschreibung} — {fmtH(a.neu_stunden)}h [{a.neu_ist_intern ? 'Intern' : kurz(a.proj_kunden?.name)}]</p>
                    </div>
                  )}
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
        {/* LINKS: Erfassung */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">
                {anchorDate.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}
                {isToday && <span className="ml-2 text-[10px] text-[#ff6b01] font-medium">HEUTE</span>}
              </p>
              {(editId || changeReq) && <button onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-600">Abbrechen</button>}
            </div>

            {anchorFeiertag && <div className="bg-blue-50 text-blue-700 text-xs rounded-lg px-3 py-2">🎌 Feiertag: {anchorFeiertag}</div>}
            {changeReq && <div className="bg-yellow-50 text-yellow-700 text-xs rounded-lg px-3 py-2">Änderungsantrag – geht nach dem Speichern an Felix zur Freigabe.</div>}
            {!bearbeitbar && !changeReq && <div className="bg-gray-50 text-gray-500 text-xs rounded-lg px-3 py-2">Älter als 2 Tage: neue Einträge gehen direkt, Änderungen an bestehenden musst du beantragen.</div>}

            <div><label className="label">Was hast du gemacht?</label>
              <textarea className="input text-sm" rows={2} value={form.beschreibung}
                onChange={e => setForm(p => ({ ...p, beschreibung: e.target.value }))}
                placeholder="z.B. Schnitt Reel Bierschneider, 3 Cuts + Musik" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Stunden</label>
                <input className="input text-sm" inputMode="decimal" value={form.stunden}
                  onChange={e => setForm(p => ({ ...p, stunden: e.target.value }))} placeholder="z.B. 2,5" />
              </div>
              <div><label className="label">Konto</label>
                <select className="input text-sm" value={form.konto} onChange={e => setForm(p => ({ ...p, konto: e.target.value }))}>
                  <option value="">Wählen…</option>
                  {kunden.map(k => <option key={k.id} value={k.id}>{kurz(k.name)}</option>)}
                  <option value="intern">Intern</option>
                </select>
              </div>
            </div>
            <button onClick={save} disabled={saving} className="btn-primary w-full text-sm">
              {saving ? 'Speichert…' : changeReq ? 'Änderung beantragen →' : editId ? 'Änderung speichern' : '+ Eintrag hinzufügen'}
            </button>
          </div>

          {/* Tagesliste */}
          {loading ? <Spinner /> : dayEntries.length > 0 ? (
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
                          {bearbeitbar ? (
                            <>
                              <button onClick={() => startEdit(e)} className="text-xs text-gray-400 hover:text-gray-600" title="Bearbeiten">✎</button>
                              <button onClick={() => remove(e.id)} className="text-xs text-red-400 hover:text-red-600" title="Löschen">✕</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startChangeReq(e)} className="text-[10px] text-gray-400 hover:text-gray-600" title="Änderung beantragen">Ändern</button>
                              <button onClick={() => reqDelete(e)} className="text-[10px] text-red-400 hover:text-red-600" title="Löschung beantragen">Löschen</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="flex items-center justify-between p-4 bg-gray-50/50">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tag gesamt</span>
                <span className="text-sm font-semibold text-[#ff6b01]">{fmtH(daySum(anchor))}h</span>
              </div>
            </div>
          ) : (
            <div className="card p-10 text-center">
              <p className="text-2xl mb-2">⏱</p>
              <p className="text-sm text-gray-400">Noch keine Einträge für diesen Tag</p>
            </div>
          )}
        </div>

        {/* RECHTS: Monatskalender */}
        <div className="lg:w-80 flex-shrink-0">
          <MonatsKalender
            calMonth={calMonth} setCalMonth={setCalMonth}
            anchor={anchor} setAnchor={setAnchor}
            daySum={daySum} ftMap={ftMap} abwFor={abwFor}
            monatIst={monatIst} monatSoll={monatSoll}
          />
        </div>
      </div>
    </div>
  )
}

/* ─── Monatskalender (mit Swipe) ─── */
function MonatsKalender({ calMonth, setCalMonth, anchor, setAnchor, daySum, ftMap, abwFor, monatIst, monatSoll }) {
  const y = calMonth.getFullYear(), m = calMonth.getMonth()
  const firstDay = new Date(y, m, 1)
  const startPad = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const touchX = useRef(null)

  const prev = () => setCalMonth(new Date(y, m - 1, 1))
  const next = () => setCalMonth(new Date(y, m + 1, 1))
  const onTouchStart = e => { touchX.current = e.touches[0].clientX }
  const onTouchEnd = e => {
    if (touchX.current == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    if (dx > 50) prev(); else if (dx < -50) next()
    touchX.current = null
  }

  const monatFeiertage = Object.entries(ftMap)
    .filter(([ds]) => { const d = parse(ds); return d.getFullYear() === y && d.getMonth() === m })
    .sort((a, b) => a[0] < b[0] ? -1 : 1)

  return (
    <div className="card p-3 lg:sticky lg:top-4" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center justify-between mb-3 px-1">
        <button onClick={prev} className="btn-secondary text-xs px-2.5 py-1">‹</button>
        <span className="text-sm font-semibold text-gray-800">{calMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span>
        <button onClick={next} className="btn-secondary text-xs px-2.5 py-1">›</button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WD.map(d => <div key={d} className="text-center text-[10px] font-semibold text-gray-300 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array(startPad).fill(null).map((_, i) => <div key={`p${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(tag => {
          const ds = toStr(new Date(y, m, tag))
          const sum = daySum(ds)
          const ft = ftMap[ds]
          const abw = abwFor(ds)
          const we = istWochenende(ds)
          const sel = ds === anchor
          const heute = ds === todayStr()
          let bg = 'hover:bg-gray-50', txt = 'text-gray-700', dot = null
          if (we) txt = 'text-gray-300'
          if (ft) { bg = 'bg-blue-50 hover:bg-blue-100'; txt = 'text-blue-600' }
          if (abw === 'urlaub') { bg = 'bg-green-50 hover:bg-green-100'; txt = 'text-green-700' }
          if (abw === 'krankheit') { bg = 'bg-red-50 hover:bg-red-100'; txt = 'text-red-600' }
          if (sel) { bg = 'bg-[#ff6b01]/10 ring-1 ring-[#ff6b01]/40' }
          if (sum > 0) dot = <span className="text-[8px] leading-none text-[#ff6b01] font-semibold">{fmtH(sum)}</span>
          return (
            <button key={tag} onClick={() => setAnchor(ds)}
              title={ft || (abw ? (abw === 'urlaub' ? 'Urlaub' : 'Krankheit') : '')}
              className={`aspect-square rounded-md flex flex-col items-center justify-center gap-0.5 transition-all ${bg}`}>
              <span className={`text-xs ${heute ? 'text-[#ff6b01] font-bold' : txt} ${sel ? 'font-semibold' : ''}`}>{tag}</span>
              {dot || (abw ? <span className="w-1 h-1 rounded-full" style={{ background: abw === 'urlaub' ? '#16a34a' : '#dc2626' }} /> : null)}
            </button>
          )
        })}
      </div>

      {/* Monatssumme */}
      <div className="mt-3 pt-3 border-t border-gray-100 px-1 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Monat Ist</span>
          <span className="text-sm font-semibold text-[#ff6b01]">{fmtH(monatIst)}h</span>
        </div>
        {monatSoll > 0 && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Soll (o. Feiertage)</span>
              <span className="text-xs font-medium text-gray-600">{fmtH(monatSoll)}h</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Differenz</span>
              <span className={`text-xs font-semibold ${monatIst - monatSoll >= 0 ? 'text-green-600' : 'text-gray-500'}`}>{monatIst - monatSoll >= 0 ? '+' : ''}{fmtH(monatIst - monatSoll)}h</span>
            </div>
          </>
        )}
      </div>

      {/* Feiertage im Monat */}
      {monatFeiertage.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 px-1">
          <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider mb-1">Feiertage</p>
          {monatFeiertage.map(([ds, name]) => (
            <div key={ds} className="flex justify-between text-[11px] text-gray-500 py-0.5">
              <span>{parse(ds).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
              <span className="text-blue-600">{name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════
   URLAUB
═══════════════════════════════════════ */
export function Urlaub() {
  const { profile, isAdmin } = useAuth()
  const [antraege, setAntraege] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ typ: 'urlaub', von_datum: '', bis_datum: '', grund: '' })
  const [adminForm, setAdminForm] = useState({ user_id: '', typ: 'krankheit', von_datum: '', bis_datum: '', grund: '' })
  const [showAdminForm, setShowAdminForm] = useState(false)
  const jahr = new Date().getFullYear()

  useEffect(() => { fetchAll() }, [])
  useEffect(() => { if (isAdmin) supabase.from('profiles').select('id, full_name').order('created_at').then(({ data }) => setMembers(data || [])) }, [isAdmin])

  async function fetchAll() {
    setLoading(true)
    const { data } = await supabase.from('urlaubsantraege').select('*, profiles(full_name)').order('von_datum', { ascending: false })
    setAntraege(data || [])
    setLoading(false)
  }

  const meine = antraege.filter(a => a.user_id === profile?.id)
  const offeneFremde = antraege.filter(a => a.user_id !== profile?.id && a.status === 'offen')
  const genehmigtDiesesJahr = meine
    .filter(a => a.typ === 'urlaub' && a.status === 'genehmigt' && new Date(a.von_datum).getFullYear() === jahr)
    .reduce((s, a) => s + Number(a.tage || 0), 0)
  const anspruch = Number(profile?.urlaub_anspruch_tage || 0)
  const rest = anspruch - genehmigtDiesesJahr
  const tageForm = werktage(form.von_datum, form.bis_datum)
  const tageAdmin = werktage(adminForm.von_datum, adminForm.bis_datum)

  async function submit() {
    if (!form.von_datum || !form.bis_datum || tageForm <= 0) return
    await supabase.from('urlaubsantraege').insert({
      user_id: profile.id, typ: form.typ, von_datum: form.von_datum,
      bis_datum: form.bis_datum, tage: tageForm, grund: form.grund || null,
    })
    setForm({ typ: 'urlaub', von_datum: '', bis_datum: '', grund: '' }); setShowForm(false); fetchAll()
  }
  async function adminEintrag() {
    if (!adminForm.user_id || !adminForm.von_datum || !adminForm.bis_datum || tageAdmin <= 0) return
    await supabase.from('urlaubsantraege').insert({
      user_id: adminForm.user_id, typ: adminForm.typ, von_datum: adminForm.von_datum, bis_datum: adminForm.bis_datum,
      tage: tageAdmin, grund: adminForm.grund || null, status: 'genehmigt',
      entschieden_von: profile.id, entschieden_am: new Date().toISOString(),
    })
    setAdminForm({ user_id: '', typ: 'krankheit', von_datum: '', bis_datum: '', grund: '' }); setShowAdminForm(false); fetchAll()
  }
  async function entscheide(id, status) {
    await supabase.from('urlaubsantraege').update({ status, entschieden_von: profile.id, entschieden_am: new Date().toISOString() }).eq('id', id)
    fetchAll()
  }
  async function zuruecknehmen(id) { await supabase.from('urlaubsantraege').delete().eq('id', id); fetchAll() }

  const statusPill = { offen: 'bg-yellow-100 text-yellow-700', genehmigt: 'bg-green-100 text-green-700', abgelehnt: 'bg-red-100 text-red-600' }
  const typLabel = { urlaub: 'Urlaub', sonderurlaub: 'Sonderurlaub', unbezahlt: 'Unbezahlt', krankheit: 'Krankheit' }
  const fmtDate = s => new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })

  if (loading) return <Spinner />

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="page-header">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Urlaub & Abwesenheit</h2>
          <p className="text-xs text-gray-400">Anträge stellen & Resturlaub im Blick</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-xs py-1.5 px-3">+ Antrag</button>
      </div>

      {anspruch > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[['Anspruch', anspruch, 'text-gray-700'], ['Genommen', genehmigtDiesesJahr, 'text-gray-700'], ['Rest ' + jahr, rest, 'text-[#ff6b01]']].map(([l, v, c]) => (
            <div key={l} className="card p-4 text-center">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{l}</p>
              <p className={`text-xl font-semibold ${c}`}>{fmtH(v)}</p>
              <p className="text-[10px] text-gray-400">Tage</p>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Von</label><input type="date" className="input text-sm" value={form.von_datum} onChange={e => setForm(p => ({ ...p, von_datum: e.target.value }))} /></div>
            <div><label className="label">Bis</label><input type="date" className="input text-sm" value={form.bis_datum} onChange={e => setForm(p => ({ ...p, bis_datum: e.target.value }))} /></div>
          </div>
          <div><label className="label">Art</label>
            <select className="input text-sm" value={form.typ} onChange={e => setForm(p => ({ ...p, typ: e.target.value }))}>
              {['urlaub', 'sonderurlaub', 'unbezahlt'].map(k => <option key={k} value={k}>{typLabel[k]}</option>)}
            </select>
          </div>
          <div><label className="label">Grund (optional)</label><input className="input text-sm" value={form.grund} onChange={e => setForm(p => ({ ...p, grund: e.target.value }))} placeholder="z.B. Familienurlaub" /></div>
          {tageForm > 0 && <p className="text-xs text-gray-500">{tageForm} Werktag{tageForm !== 1 ? 'e' : ''} (Mo–Fr)</p>}
          <div className="flex gap-3">
            <button onClick={() => setShowForm(false)} className="btn-secondary flex-1 text-xs">Abbrechen</button>
            <button onClick={submit} className="btn-primary flex-1 text-xs">Antrag stellen →</button>
          </div>
        </div>
      )}

      {/* Admin: zu genehmigen */}
      {isAdmin && offeneFremde.length > 0 && (
        <div className="card p-4 border-yellow-200">
          <h3 className="section-title text-yellow-600">Zu genehmigen ({offeneFremde.length})</h3>
          <div className="space-y-2">
            {offeneFremde.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{a.profiles?.full_name || '—'} · {typLabel[a.typ]}</p>
                  <p className="text-xs text-gray-400">{fmtDate(a.von_datum)} – {fmtDate(a.bis_datum)} · {fmtH(a.tage)} Tage{a.grund ? ` · ${a.grund}` : ''}</p>
                </div>
                <button onClick={() => entscheide(a.id, 'genehmigt')} className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-md font-medium hover:bg-green-200">✓</button>
                <button onClick={() => entscheide(a.id, 'abgelehnt')} className="text-xs bg-red-50 text-red-600 px-2.5 py-1 rounded-md font-medium hover:bg-red-100">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin: Abwesenheit/Krankheit eintragen */}
      {isAdmin && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h3 className="section-title mb-0">Krankheit / Abwesenheit für MA eintragen</h3>
            <button onClick={() => setShowAdminForm(!showAdminForm)} className="btn-secondary text-xs py-1 px-2.5">{showAdminForm ? '−' : '+'}</button>
          </div>
          {showAdminForm && (
            <div className="space-y-3 mt-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Mitarbeiter</label>
                  <select className="input text-sm" value={adminForm.user_id} onChange={e => setAdminForm(p => ({ ...p, user_id: e.target.value }))}>
                    <option value="">Wählen…</option>
                    {members.map(mb => <option key={mb.id} value={mb.id}>{mb.full_name}</option>)}
                  </select>
                </div>
                <div><label className="label">Art</label>
                  <select className="input text-sm" value={adminForm.typ} onChange={e => setAdminForm(p => ({ ...p, typ: e.target.value }))}>
                    {Object.entries(typLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Von</label><input type="date" className="input text-sm" value={adminForm.von_datum} onChange={e => setAdminForm(p => ({ ...p, von_datum: e.target.value }))} /></div>
                <div><label className="label">Bis</label><input type="date" className="input text-sm" value={adminForm.bis_datum} onChange={e => setAdminForm(p => ({ ...p, bis_datum: e.target.value }))} /></div>
              </div>
              {tageAdmin > 0 && <p className="text-xs text-gray-500">{tageAdmin} Werktag{tageAdmin !== 1 ? 'e' : ''}</p>}
              <button onClick={adminEintrag} className="btn-primary w-full text-xs">Eintragen (direkt genehmigt) →</button>
            </div>
          )}
        </div>
      )}

      {/* Meine Anträge */}
      <div className="card p-4">
        <h3 className="section-title">Meine Anträge</h3>
        {meine.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Noch keine Anträge</p>
        ) : (
          <div className="space-y-2">
            {meine.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <span className={`pill flex-shrink-0 ${statusPill[a.status]}`}>{a.status === 'offen' ? 'Offen' : a.status === 'genehmigt' ? 'Genehmigt' : 'Abgelehnt'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">{typLabel[a.typ]} · {fmtDate(a.von_datum)} – {fmtDate(a.bis_datum)}</p>
                  <p className="text-xs text-gray-400">{fmtH(a.tage)} Tage{a.grund ? ` · ${a.grund}` : ''}</p>
                </div>
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
   AUSWERTUNG
═══════════════════════════════════════ */
export function Auswertung() {
  const { profile, isAdmin } = useAuth()
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [entries, setEntries] = useState([])
  const [members, setMembers] = useState([])
  const [selUser, setSelUser] = useState('alle')
  const [loading, setLoading] = useState(true)
  const [showReport, setShowReport] = useState(false)

  const y = month.getFullYear(), mo = month.getMonth()
  const von = toStr(new Date(y, mo, 1)), bis = toStr(new Date(y, mo + 1, 0))
  const ftMap = useMemo(() => feiertageNRW(y), [y])

  useEffect(() => {
    if (isAdmin) supabase.from('profiles').select('id, full_name, soll_stunden, soll_modus').order('created_at').then(({ data }) => setMembers(data || []))
  }, [isAdmin])
  useEffect(() => { fetchEntries() }, [von, bis])

  async function fetchEntries() {
    setLoading(true)
    const { data } = await supabase.from('zeiteintraege').select('*, proj_kunden(name), profiles(full_name)')
      .gte('datum', von).lte('datum', bis).order('datum')
    setEntries(data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    if (!isAdmin) return entries.filter(e => e.user_id === profile?.id)
    return selUser === 'alle' ? entries : entries.filter(e => e.user_id === selUser)
  }, [entries, selUser, isAdmin, profile?.id])

  const total = filtered.reduce((s, e) => s + Number(e.stunden || 0), 0)
  const perKunde = useMemo(() => {
    const map = {}; filtered.forEach(e => { const k = kontoLabel(e); map[k] = (map[k] || 0) + Number(e.stunden || 0) })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])
  const perUser = useMemo(() => {
    const map = {}; filtered.forEach(e => { const k = e.profiles?.full_name || '—'; map[k] = (map[k] || 0) + Number(e.stunden || 0) })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  const einzelSoll = useMemo(() => {
    if (selUser === 'alle') return 0
    const p = isAdmin ? members.find(x => x.id === selUser) : profile
    return monatsSoll(p, y, mo, ftMap)
  }, [selUser, members, isAdmin, profile, y, mo, ftMap])

  function buildReport() {
    const label = selUser === 'alle' ? 'Alle Mitarbeiter' : (members.find(x => x.id === selUser)?.full_name || profile?.full_name || '')
    let t = `ZEITAUSWERTUNG ${month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}\n${label} · Gesamt: ${fmtH(total)}h\n\n— NACH KONTO —\n`
    perKunde.forEach(([k, h]) => { t += `${k}: ${fmtH(h)}h (${total ? Math.round(h / total * 100) : 0}%)\n` })
    if (isAdmin && selUser === 'alle') { t += `\n— NACH MITARBEITER —\n`; perUser.forEach(([k, h]) => { t += `${k}: ${fmtH(h)}h\n` }) }
    t += `\n— EINTRÄGE —\n`
    const byDay = {}; filtered.forEach(e => { (byDay[e.datum] = byDay[e.datum] || []).push(e) })
    Object.keys(byDay).sort().forEach(d => {
      t += `\n${parse(d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}\n`
      byDay[d].forEach(e => { t += `  • [${kontoLabel(e)}] ${e.beschreibung} — ${fmtH(e.stunden)}h${isAdmin && selUser === 'alle' ? ` (${e.profiles?.full_name || '—'})` : ''}\n` })
    })
    return t
  }
  const maxKunde = perKunde[0]?.[1] || 1

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="page-header">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Auswertung</h2>
          <p className="text-xs text-gray-400">Stunden pro Kunde & Mitarbeiter</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMonth(new Date(y, mo - 1, 1))} className="btn-secondary text-xs px-3">‹</button>
          <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }} className="btn-secondary text-xs px-3">Aktuell</button>
          <button onClick={() => setMonth(new Date(y, mo + 1, 1))} className="btn-secondary text-xs px-3">›</button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-gray-800">{month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</p>
        {isAdmin && (
          <select className="input text-xs w-auto" value={selUser} onChange={e => setSelUser(e.target.value)}>
            <option value="alle">Alle Mitarbeiter</option>
            {members.map(mb => <option key={mb.id} value={mb.id}>{mb.full_name}</option>)}
          </select>
        )}
      </div>

      {loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Gesamt</p>
              <p className="text-2xl font-semibold text-[#ff6b01]">{fmtH(total)}h</p>
            </div>
            <div className="card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{selUser === 'alle' ? 'Einträge' : 'Ist / Soll'}</p>
              {selUser === 'alle'
                ? <p className="text-2xl font-semibold text-gray-700">{filtered.length}</p>
                : <p className="text-2xl font-semibold text-gray-700">{fmtH(total)}<span className="text-sm text-gray-400"> / {einzelSoll > 0 ? fmtH(einzelSoll) + 'h' : '–'}</span></p>}
            </div>
          </div>

          <div className="card p-4">
            <h3 className="section-title">Nach Konto</h3>
            {perKunde.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center">Keine Einträge in diesem Monat</p> : (
              <div className="space-y-2.5">
                {perKunde.map(([k, h]) => (
                  <div key={k}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">{k}</span>
                      <span className="text-xs font-medium text-gray-500">{fmtH(h)}h · {total ? Math.round(h / total * 100) : 0}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#ff6b01] rounded-full" style={{ width: `${(h / maxKunde) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isAdmin && selUser === 'alle' && perUser.length > 0 && (
            <div className="card p-4">
              <h3 className="section-title">Nach Mitarbeiter</h3>
              <div className="space-y-1">
                {perUser.map(([k, h]) => (
                  <div key={k} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-700">{k}</span>
                    <span className="text-sm font-medium text-[#ff6b01]">{fmtH(h)}h</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="section-title mb-0">Report</h3>
                  <p className="text-xs text-gray-400 mt-1">Kompletter Text zum Kopieren – ideal für die Monatsauswertung.</p>
                </div>
                <button onClick={() => setShowReport(!showReport)} className="btn-secondary text-xs py-1.5 px-3">{showReport ? 'Verbergen' : '📋 Anzeigen'}</button>
              </div>
              {showReport && <textarea readOnly className="input text-xs font-mono mt-3 leading-relaxed" rows={14} value={buildReport()} onFocus={e => e.target.select()} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

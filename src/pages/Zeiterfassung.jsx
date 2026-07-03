import { useState, useEffect, useMemo } from 'react'
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

function mondayOf(dateStr) {
  const d = parse(dateStr)
  const off = (d.getDay() + 6) % 7 // 0 = Montag
  d.setDate(d.getDate() - off)
  return d
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function werktage(vonStr, bisStr) {
  if (!vonStr || !bisStr) return 0
  let c = 0, d = parse(vonStr); const end = parse(bisStr)
  while (d <= end) { const wd = d.getDay(); if (wd !== 0 && wd !== 6) c++; d.setDate(d.getDate() + 1) }
  return c
}
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const Spinner = () => <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

// Dropdown-Optionen: alle Kunden (Kurzname) + Intern
function useKonten() {
  const [kunden, setKunden] = useState([])
  useEffect(() => {
    supabase.from('proj_kunden').select('id, name').order('name').then(({ data }) => {
      if (data) setKunden(data)
    })
  }, [])
  return kunden
}
// Anzeigename eines Eintrags
const kontoLabel = e => e.ist_intern ? 'Intern' : (e.proj_kunden?.name ? kurz(e.proj_kunden.name) : '—')

/* ═══════════════════════════════════════
   ZEITERFASSUNG (Tages-/Wochenerfassung)
═══════════════════════════════════════ */
export function Zeiterfassung() {
  const { profile } = useAuth()
  const kunden = useKonten()
  const [anchor, setAnchor] = useState(todayStr())
  const [weekEntries, setWeekEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ beschreibung: '', stunden: '', konto: '' })
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  const monday = useMemo(() => mondayOf(anchor), [anchor])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => toStr(addDays(monday, i))), [monday])

  useEffect(() => { if (profile?.id) fetchWeek() }, [profile?.id, weekDays[0]])

  async function fetchWeek() {
    setLoading(true)
    const { data } = await supabase
      .from('zeiteintraege')
      .select('*, proj_kunden(name)')
      .eq('user_id', profile.id)
      .gte('datum', weekDays[0])
      .lte('datum', weekDays[6])
      .order('created_at')
    setWeekEntries(data || [])
    setLoading(false)
  }

  const dayEntries = weekEntries.filter(e => e.datum === anchor)
  const daySum = k => weekEntries.filter(e => e.datum === k).reduce((s, e) => s + Number(e.stunden || 0), 0)
  const weekSum = weekEntries.reduce((s, e) => s + Number(e.stunden || 0), 0)
  const sollWoche = Number(profile?.soll_stunden_woche || 0)

  function resetForm() { setForm({ beschreibung: '', stunden: '', konto: '' }); setEditId(null) }

  async function save() {
    const std = dec(form.stunden)
    if (!form.beschreibung.trim() || std <= 0 || !form.konto) return
    setSaving(true)
    const konto = form.konto === 'intern'
      ? { ist_intern: true, kunde_id: null }
      : { ist_intern: false, kunde_id: form.konto }
    const payload = { beschreibung: form.beschreibung.trim(), stunden: std, datum: anchor, ...konto }
    if (editId) {
      await supabase.from('zeiteintraege').update(payload).eq('id', editId)
    } else {
      await supabase.from('zeiteintraege').insert({ ...payload, user_id: profile.id })
    }
    setSaving(false); resetForm(); fetchWeek()
  }

  function startEdit(e) {
    setEditId(e.id)
    setForm({ beschreibung: e.beschreibung || '', stunden: fmtH(e.stunden), konto: e.ist_intern ? 'intern' : (e.kunde_id || '') })
  }

  async function remove(id) {
    await supabase.from('zeiteintraege').delete().eq('id', id)
    if (editId === id) resetForm()
    fetchWeek()
  }

  const isToday = anchor === todayStr()
  const anchorDate = parse(anchor)

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="page-header">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Zeiterfassung</h2>
          <p className="text-xs text-gray-400">Deine Stunden pro Tag – jede Aufgabe auf ein Konto</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAnchor(toStr(addDays(monday, -7)))} className="btn-secondary text-xs px-3">‹ Woche</button>
          <button onClick={() => setAnchor(todayStr())} className="btn-secondary text-xs px-3">Heute</button>
          <button onClick={() => setAnchor(toStr(addDays(monday, 7)))} className="btn-secondary text-xs px-3">Woche ›</button>
        </div>
      </div>

      {/* Wochenstreifen */}
      <div className="card p-3">
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map((d, i) => {
            const sum = daySum(d)
            const active = d === anchor
            const heute = d === todayStr()
            return (
              <button key={d} onClick={() => setAnchor(d)}
                className={`flex flex-col items-center py-2 rounded-lg border transition-all ${active ? 'bg-[#ff6b01]/8 border-[#ff6b01]/40' : 'border-transparent hover:bg-gray-50'}`}>
                <span className={`text-[10px] font-semibold uppercase ${active ? 'text-[#ff6b01]' : 'text-gray-400'}`}>{WD[i]}</span>
                <span className={`text-sm font-medium ${heute ? 'text-[#ff6b01]' : 'text-gray-700'}`}>{parse(d).getDate()}</span>
                <span className={`text-[10px] mt-0.5 ${sum > 0 ? 'text-gray-500' : 'text-gray-300'}`}>{sum > 0 ? fmtH(sum) + 'h' : '–'}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 px-1">
          <span className="text-xs text-gray-400">Woche gesamt</span>
          <span className="text-xs font-medium text-gray-700">
            <span className="text-[#ff6b01] font-semibold">{fmtH(weekSum)}h</span>
            {sollWoche > 0 && <span className="text-gray-400"> / {fmtH(sollWoche)}h Soll ({weekSum - sollWoche >= 0 ? '+' : ''}{fmtH(weekSum - sollWoche)}h)</span>}
          </span>
        </div>
      </div>

      {/* Eingabe */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">
            {anchorDate.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}
            {isToday && <span className="ml-2 text-[10px] text-[#ff6b01] font-medium">HEUTE</span>}
          </p>
          {editId && <button onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-600">Abbrechen</button>}
        </div>
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
          {saving ? 'Speichert…' : editId ? 'Änderung speichern' : '+ Eintrag hinzufügen'}
        </button>
      </div>

      {/* Tagesliste */}
      {loading ? <Spinner /> : dayEntries.length > 0 ? (
        <div className="card divide-y divide-gray-50">
          {dayEntries.map(e => (
            <div key={e.id} className="flex items-start gap-3 p-4">
              <span className={`pill flex-shrink-0 ${e.ist_intern ? 'bg-gray-100 text-gray-600' : 'bg-[#ff6b01]/10 text-[#ff6b01]'}`}>{kontoLabel(e)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{e.beschreibung}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-sm font-semibold text-gray-700">{fmtH(e.stunden)}h</span>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(e)} className="text-xs text-gray-400 hover:text-gray-600">✎</button>
                  <button onClick={() => remove(e.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                </div>
              </div>
            </div>
          ))}
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
  )
}

/* ═══════════════════════════════════════
   URLAUB
═══════════════════════════════════════ */
export function Urlaub() {
  const { profile, isAdmin } = useAuth()
  const [antraege, setAntraege] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ typ: 'urlaub', von_datum: '', bis_datum: '', grund: '' })
  const jahr = new Date().getFullYear()

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    // RLS: MA sieht eigene, Admin sieht alle
    const { data } = await supabase
      .from('urlaubsantraege')
      .select('*, profiles(full_name)')
      .order('von_datum', { ascending: false })
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

  async function submit() {
    if (!form.von_datum || !form.bis_datum || tageForm <= 0) return
    await supabase.from('urlaubsantraege').insert({
      user_id: profile.id, typ: form.typ, von_datum: form.von_datum,
      bis_datum: form.bis_datum, tage: tageForm, grund: form.grund || null,
    })
    setForm({ typ: 'urlaub', von_datum: '', bis_datum: '', grund: '' }); setShowForm(false); fetchAll()
  }

  async function entscheide(id, status) {
    await supabase.from('urlaubsantraege').update({
      status, entschieden_von: profile.id, entschieden_am: new Date().toISOString(),
    }).eq('id', id)
    fetchAll()
  }
  async function zuruecknehmen(id) {
    await supabase.from('urlaubsantraege').delete().eq('id', id)
    fetchAll()
  }

  const statusPill = { offen: 'bg-yellow-100 text-yellow-700', genehmigt: 'bg-green-100 text-green-700', abgelehnt: 'bg-red-100 text-red-600' }
  const typLabel = { urlaub: 'Urlaub', sonderurlaub: 'Sonderurlaub', unbezahlt: 'Unbezahlt', krankheit: 'Krankheit' }
  const fmtDate = s => new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })

  if (loading) return <Spinner />

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="page-header">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Urlaub</h2>
          <p className="text-xs text-gray-400">Anträge stellen & Resturlaub im Blick</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-xs py-1.5 px-3">+ Antrag</button>
      </div>

      {/* Resturlaub */}
      <div className="grid grid-cols-3 gap-3">
        {[['Anspruch', anspruch, 'text-gray-700'], ['Genommen', genehmigtDiesesJahr, 'text-gray-700'], ['Rest ' + jahr, rest, 'text-[#ff6b01]']].map(([l, v, c]) => (
          <div key={l} className="card p-4 text-center">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{l}</p>
            <p className={`text-xl font-semibold ${c}`}>{anspruch > 0 || l === 'Genommen' ? fmtH(v) : '–'}</p>
            <p className="text-[10px] text-gray-400">Tage</p>
          </div>
        ))}
      </div>
      {anspruch === 0 && <p className="text-xs text-gray-400 text-center">Urlaubsanspruch wird von Felix in den Einstellungen hinterlegt.</p>}

      {showForm && (
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Von</label><input type="date" className="input text-sm" value={form.von_datum} onChange={e => setForm(p => ({ ...p, von_datum: e.target.value }))} /></div>
            <div><label className="label">Bis</label><input type="date" className="input text-sm" value={form.bis_datum} onChange={e => setForm(p => ({ ...p, bis_datum: e.target.value }))} /></div>
          </div>
          <div><label className="label">Art</label>
            <select className="input text-sm" value={form.typ} onChange={e => setForm(p => ({ ...p, typ: e.target.value }))}>
              {Object.entries(typLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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

      {/* Admin: offene Anträge anderer */}
      {isAdmin && offeneFremde.length > 0 && (
        <div className="card p-4">
          <h3 className="section-title text-yellow-600">Zu genehmigen ({offeneFremde.length})</h3>
          <div className="space-y-2">
            {offeneFremde.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{a.profiles?.full_name || '—'} · {typLabel[a.typ]}</p>
                  <p className="text-xs text-gray-400">{fmtDate(a.von_datum)} – {fmtDate(a.bis_datum)} · {fmtH(a.tage)} Tage{a.grund ? ` · ${a.grund}` : ''}</p>
                </div>
                <button onClick={() => entscheide(a.id, 'genehmigt')} className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-md font-medium hover:bg-green-200">✓ Genehmigen</button>
                <button onClick={() => entscheide(a.id, 'abgelehnt')} className="text-xs bg-red-50 text-red-600 px-2.5 py-1 rounded-md font-medium hover:bg-red-100">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meine Anträge */}
      <div className="card p-4">
        <h3 className="section-title">Meine Anträge</h3>
        {meine.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Noch keine Anträge gestellt</p>
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
   AUSWERTUNG (Monat)
═══════════════════════════════════════ */
export function Auswertung() {
  const { profile, isAdmin } = useAuth()
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [entries, setEntries] = useState([])
  const [members, setMembers] = useState([])
  const [selUser, setSelUser] = useState('alle')
  const [loading, setLoading] = useState(true)
  const [showReport, setShowReport] = useState(false)

  const von = toStr(new Date(month.getFullYear(), month.getMonth(), 1))
  const bis = toStr(new Date(month.getFullYear(), month.getMonth() + 1, 0))

  useEffect(() => {
    if (isAdmin) supabase.from('profiles').select('id, full_name, soll_stunden_woche').order('created_at').then(({ data }) => setMembers(data || []))
  }, [isAdmin])
  useEffect(() => { fetchEntries() }, [von, bis])

  async function fetchEntries() {
    setLoading(true)
    const { data } = await supabase
      .from('zeiteintraege')
      .select('*, proj_kunden(name), profiles(full_name)')
      .gte('datum', von).lte('datum', bis)
      .order('datum')
    setEntries(data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    if (!isAdmin) return entries.filter(e => e.user_id === profile?.id)
    return selUser === 'alle' ? entries : entries.filter(e => e.user_id === selUser)
  }, [entries, selUser, isAdmin, profile?.id])

  const total = filtered.reduce((s, e) => s + Number(e.stunden || 0), 0)
  const perKunde = useMemo(() => {
    const m = {}
    filtered.forEach(e => { const k = kontoLabel(e); m[k] = (m[k] || 0) + Number(e.stunden || 0) })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [filtered])
  const perUser = useMemo(() => {
    const m = {}
    filtered.forEach(e => { const k = e.profiles?.full_name || '—'; m[k] = (m[k] || 0) + Number(e.stunden || 0) })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [filtered])

  // grobes Monats-Soll (nur bei Einzel-MA sinnvoll)
  const werktageMonat = werktage(von, bis)
  const einzelSoll = useMemo(() => {
    if (selUser === 'alle') return 0
    const m = members.find(x => x.id === selUser) || (!isAdmin ? profile : null)
    const sw = Number(m?.soll_stunden_woche || 0)
    return sw > 0 ? (sw / 5) * werktageMonat : 0
  }, [selUser, members, werktageMonat, isAdmin, profile])

  function buildReport() {
    const label = selUser === 'alle' ? 'Alle Mitarbeiter' : (members.find(m => m.id === selUser)?.full_name || profile?.full_name || '')
    let t = `ZEITAUSWERTUNG ${month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}\n${label} · Gesamt: ${fmtH(total)}h\n\n`
    t += `— NACH KONTO —\n`
    perKunde.forEach(([k, h]) => { t += `${k}: ${fmtH(h)}h (${total ? Math.round(h / total * 100) : 0}%)\n` })
    if (isAdmin && selUser === 'alle') { t += `\n— NACH MITARBEITER —\n`; perUser.forEach(([k, h]) => { t += `${k}: ${fmtH(h)}h\n` }) }
    t += `\n— EINTRÄGE —\n`
    const byDay = {}
    filtered.forEach(e => { (byDay[e.datum] = byDay[e.datum] || []).push(e) })
    Object.keys(byDay).sort().forEach(d => {
      t += `\n${new Date(d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}\n`
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
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="btn-secondary text-xs px-3">‹</button>
          <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }} className="btn-secondary text-xs px-3">Aktuell</button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="btn-secondary text-xs px-3">›</button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-gray-800">{month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</p>
        {isAdmin && (
          <select className="input text-xs w-auto" value={selUser} onChange={e => setSelUser(e.target.value)}>
            <option value="alle">Alle Mitarbeiter</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        )}
      </div>

      {loading ? <Spinner /> : (
        <>
          {/* Kennzahlen */}
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

          {/* Nach Konto */}
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
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#ff6b01] rounded-full" style={{ width: `${(h / maxKunde) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Nach Mitarbeiter (nur Admin + alle) */}
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

          {/* Text-Report für Monatsauswertung */}
          {filtered.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="section-title mb-0">Report</h3>
                  <p className="text-xs text-gray-400 mt-1">Kompletter Text zum Kopieren – ideal für die Monatsauswertung.</p>
                </div>
                <button onClick={() => setShowReport(!showReport)} className="btn-secondary text-xs py-1.5 px-3">{showReport ? 'Verbergen' : '📋 Anzeigen'}</button>
              </div>
              {showReport && (
                <textarea readOnly className="input text-xs font-mono mt-3 leading-relaxed" rows={14} value={buildReport()} onFocus={e => e.target.select()} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

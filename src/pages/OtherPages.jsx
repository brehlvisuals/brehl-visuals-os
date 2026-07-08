import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

/* ═══════════════════════════════════════
   TASKS
═══════════════════════════════════════ */
export function Tasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ titel: '', faellig_am: '' })

  useEffect(() => { fetchTasks() }, [])

  async function fetchTasks() {
    const { data } = await supabase.from('crm_tasks').select('*, crm_leads(name), crm_darsteller(name)')
      .eq('erledigt', false).order('faellig_am')
    if (data) setTasks(data)
    setLoading(false)
  }

  async function complete(id) {
    await supabase.from('crm_tasks').update({ erledigt: true }).eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  async function addTask() {
    if (!form.titel.trim()) return
    await supabase.from('crm_tasks').insert(form)
    setForm({ titel: '', faellig_am: '' }); setShowAdd(false); fetchTasks()
  }

  const now = new Date()
  const overdue = tasks.filter(t => t.faellig_am && new Date(t.faellig_am) < now)
  const thisWeek = tasks.filter(t => {
    if (!t.faellig_am) return false
    const d = new Date(t.faellig_am)
    const next7 = new Date(); next7.setDate(next7.getDate() + 7)
    return d >= now && d <= next7
  })
  const later = tasks.filter(t => {
    if (!t.faellig_am) return true
    return new Date(t.faellig_am) > new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  })

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{tasks.length} offene Tasks</p>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-xs py-1.5 px-3">+ Neuer Task</button>
      </div>

      {showAdd && (
        <div className="card p-4 space-y-3">
          <div><label className="label">Titel</label><input className="input text-xs" value={form.titel} onChange={e => setForm(p => ({ ...p, titel: e.target.value }))} placeholder="Task beschreiben..." /></div>
          <div><label className="label">Fällig am</label><input type="datetime-local" className="input text-xs" value={form.faellig_am} onChange={e => setForm(p => ({ ...p, faellig_am: e.target.value }))} /></div>
          <div className="flex gap-3">
            <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1 text-xs">Abbrechen</button>
            <button onClick={addTask} className="btn-primary flex-1 text-xs">Speichern →</button>
          </div>
        </div>
      )}

      {overdue.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-3">Überfällig ({overdue.length})</h3>
          <TaskList tasks={overdue} onComplete={complete} />
        </div>
      )}

      {thisWeek.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Diese Woche</h3>
          <TaskList tasks={thisWeek} onComplete={complete} />
        </div>
      )}

      {later.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Später</h3>
          <TaskList tasks={later} onComplete={complete} />
        </div>
      )}

      {tasks.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-2xl mb-2">🎉</p>
          <p className="text-sm text-gray-400">Keine offenen Tasks!</p>
        </div>
      )}
    </div>
  )
}

function TaskList({ tasks, onComplete }) {
  return (
    <div className="space-y-0.5">
      {tasks.map(t => {
        const overdue = t.faellig_am && new Date(t.faellig_am) < new Date()
        const linkedName = t.crm_leads?.name || t.crm_darsteller?.name
        return (
          <div key={t.id} className={`flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0`}>
            <button onClick={() => onComplete(t.id)} className="w-4 h-4 rounded-full border-2 border-gray-300 hover:border-[#ff6b01] flex-shrink-0 mt-0.5 transition-colors" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">{t.titel}</p>
              <p className={`text-xs mt-0.5 ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                {linkedName && `${linkedName} · `}
                {overdue ? '⚠ Überfällig' : t.faellig_am ? new Date(t.faellig_am).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════
   FUNNELS & LPs
═══════════════════════════════════════ */
export function Funnels() {
  const [tab, setTab] = useState('kunden')
  const [lps, setLPs] = useState([])
  const [intern, setIntern] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', kunde: '', status: 'aktiv', notizen: '' })
  const [internForm, setInternForm] = useState({ kanal: '', leads_monat: '', conversion: '', notizen: '' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [l, i] = await Promise.all([
      supabase.from('funnel_lps').select('*').order('created_at', { ascending: false }),
      supabase.from('funnel_intern').select('*').order('leads_monat', { ascending: false }),
    ])
    if (l.data) setLPs(l.data)
    if (i.data) setIntern(i.data)
    setLoading(false)
  }

  async function addLP() {
    if (!form.name || !form.url) return
    await supabase.from('funnel_lps').insert(form)
    setForm({ name: '', url: '', kunde: '', status: 'aktiv', notizen: '' }); setShowAdd(false); fetchAll()
  }

  const statusColor = { aktiv: 'bg-green-100 text-green-700', pausiert: 'bg-yellow-100 text-yellow-700', 'in_bau': 'bg-blue-100 text-blue-700' }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex bg-gray-100 rounded-lg p-1 w-fit gap-0.5">
        {[['kunden','Kunden LPs & Funnels'],['intern','Interner Funnel']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'kunden' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{lps.length} Landing Pages & Funnels</p>
            <button onClick={() => setShowAdd(true)} className="btn-primary text-xs py-1.5 px-3">+ Neue LP/Funnel</button>
          </div>

          {showAdd && (
            <div className="card p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Name</label><input className="input text-xs" value={form.name} onChange={e => set('name', e.target.value)} placeholder="LP Name..." /></div>
                <div><label className="label">Kunde</label><input className="input text-xs" value={form.kunde} onChange={e => set('kunde', e.target.value)} placeholder="Kundenname" /></div>
              </div>
              <div><label className="label">URL</label><input className="input text-xs" value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://..." /></div>
              <div>
                <label className="label">Status</label>
                <select className="input text-xs" value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="aktiv">Aktiv</option>
                  <option value="in_bau">In Bau</option>
                  <option value="pausiert">Pausiert</option>
                </select>
              </div>
              <div><label className="label">Notizen</label><textarea className="input text-xs" rows={2} value={form.notizen} onChange={e => set('notizen', e.target.value)} placeholder="Notizen..." /></div>
              <div className="flex gap-3">
                <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1 text-xs">Abbrechen</button>
                <button onClick={addLP} className="btn-primary flex-1 text-xs">Speichern →</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {lps.map(lp => (
              <div key={lp.id} className="card p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{lp.name}</p>
                    {lp.kunde && <p className="text-xs text-gray-400">{lp.kunde}</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[lp.status] || 'bg-gray-100 text-gray-600'}`}>
                    {lp.status === 'in_bau' ? 'In Bau' : lp.status?.charAt(0).toUpperCase() + lp.status?.slice(1)}
                  </span>
                </div>
                {lp.url && (
                  <a href={lp.url} target="_blank" rel="noreferrer" className="text-xs text-[#ff6b01] hover:underline block truncate mb-2">
                    🔗 {lp.url}
                  </a>
                )}
                {lp.notizen && <p className="text-xs text-gray-500 leading-relaxed">{lp.notizen}</p>}
                <div className="flex gap-2 mt-3">
                  <button className="text-xs text-gray-400 hover:text-gray-600">Bearbeiten</button>
                  <button onClick={async () => { await supabase.from('funnel_lps').delete().eq('id', lp.id); fetchAll() }} className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                </div>
              </div>
            ))}
          </div>

          {lps.length === 0 && !showAdd && (
            <div className="card p-12 text-center">
              <p className="text-2xl mb-2">🔗</p>
              <p className="text-sm text-gray-400 mb-3">Noch keine Landing Pages eingetragen</p>
              <button onClick={() => setShowAdd(true)} className="btn-primary text-xs py-1.5 px-4">Erste LP hinzufügen</button>
            </div>
          )}
        </>
      )}

      {tab === 'intern' && (
        <>
          <div className="bg-[#ff6b01]/5 border border-[#ff6b01]/20 rounded-xl p-4 mb-4">
            <p className="text-sm font-semibold text-gray-800 mb-1">Euer interner Funnel</p>
            <p className="text-xs text-gray-500 leading-relaxed">Hier tragt ihr ein woher eure Leads kommen und wie gut jeder Kanal konvertiert. Hilft euch zu verstehen welcher Content am meisten bringt.</p>
          </div>

          <div className="flex justify-end mb-2">
            <button onClick={async () => {
              const { error } = await supabase.from('funnel_intern').insert(internForm)
              if (!error) { setInternForm({ kanal: '', leads_monat: '', conversion: '', notizen: '' }); fetchAll() }
            }} className="btn-primary text-xs py-1.5 px-3">+ Kanal hinzufügen</button>
          </div>

          <div className="card p-4 space-y-3 mb-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Kanal</label><input className="input text-xs" value={internForm.kanal} onChange={e => setInternForm(p => ({ ...p, kanal: e.target.value }))} placeholder="z.B. TikTok, Instagram..." /></div>
              <div><label className="label">Leads / Monat</label><input type="number" className="input text-xs" value={internForm.leads_monat} onChange={e => setInternForm(p => ({ ...p, leads_monat: e.target.value }))} placeholder="z.B. 15" /></div>
            </div>
            <div><label className="label">Conversion Rate (%)</label><input type="number" className="input text-xs" value={internForm.conversion} onChange={e => setInternForm(p => ({ ...p, conversion: e.target.value }))} placeholder="z.B. 25" /></div>
            <div><label className="label">Notizen</label><textarea className="input text-xs" rows={2} value={internForm.notizen} onChange={e => setInternForm(p => ({ ...p, notizen: e.target.value }))} placeholder="Was funktioniert gut? Was nicht?" /></div>
          </div>

          <div className="space-y-3">
            {intern.map(k => (
              <div key={k.id} className="card p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{k.kanal}</p>
                    <div className="flex gap-4 mt-1">
                      {k.leads_monat && <span className="text-xs text-gray-500"><span className="font-semibold text-[#ff6b01]">{k.leads_monat}</span> Leads/Monat</span>}
                      {k.conversion && <span className="text-xs text-gray-500"><span className="font-semibold text-green-600">{k.conversion}%</span> Conversion</span>}
                    </div>
                    {k.notizen && <p className="text-xs text-gray-400 mt-1 leading-relaxed">{k.notizen}</p>}
                  </div>
                  <button onClick={async () => { await supabase.from('funnel_intern').delete().eq('id', k.id); fetchAll() }} className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                </div>
              </div>
            ))}
          </div>

          {intern.length === 0 && (
            <div className="card p-12 text-center">
              <p className="text-2xl mb-2">📊</p>
              <p className="text-sm text-gray-400">Noch keine Kanäle eingetragen</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════
   KALENDER
═══════════════════════════════════════ */
export function Kalender() {
  const [drehs, setDrehs] = useState([])
  const [month, setMonth] = useState(new Date())

  useEffect(() => { fetchDrehs() }, [])

  async function fetchDrehs() {
    const { data } = await supabase.from('proj_drehs').select('datum, kunde_name, status').order('datum')
    if (data) setDrehs(data)
  }

  const year = month.getFullYear()
  const mon = month.getMonth()
  const firstDay = new Date(year, mon, 1)
  const lastDay = new Date(year, mon + 1, 0)
  const startPad = (firstDay.getDay() + 6) % 7
  const daysInMonth = lastDay.getDate()
  const today = new Date()

  const statusColor = {
    planung: { bg: 'rgba(245,158,11,0.12)', text: '#b45309' },
    abnahme_kunde: { bg: 'rgba(99,102,241,0.12)', text: '#4338ca' },
    dreh: { bg: 'rgba(59,130,246,0.12)', text: '#1d4ed8' },
    cutting: { bg: 'rgba(139,92,246,0.12)', text: '#6d28d9' },
    posting: { bg: 'rgba(249,115,22,0.12)', text: '#c2410c' },
    abgeschlossen: { bg: 'rgba(22,163,74,0.12)', text: '#15803d' },
  }

  function getDrehsForDay(day) {
    const date = new Date(year, mon, day)
    return drehs.filter(d => {
      if (!d.datum) return false
      const dd = new Date(d.datum)
      return dd.getDate() === day && dd.getMonth() === mon && dd.getFullYear() === year
    })
  }

  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">
          {month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex gap-2">
          <button onClick={() => setMonth(new Date(year, mon - 1, 1))} className="btn-secondary text-xs px-3">‹</button>
          <button onClick={() => setMonth(new Date())} className="btn-secondary text-xs px-3">Heute</button>
          <button onClick={() => setMonth(new Date(year, mon + 1, 1))} className="btn-secondary text-xs px-3">›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {days.map(d => <div key={d} className="text-center text-xs font-semibold text-gray-400 py-2">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {Array(startPad).fill(null).map((_, i) => <div key={`pad-${i}`} className="min-h-14 rounded-lg" />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const dayDrehs = getDrehsForDay(day)
          const isToday = today.getDate() === day && today.getMonth() === mon && today.getFullYear() === year
          return (
            <div key={day} className={`min-h-14 rounded-lg p-1 border ${isToday ? 'bg-[#ff6b01]/6 border-[#ff6b01]/30' : 'border-transparent hover:bg-gray-50'}`}>
              <p className={`text-xs font-medium mb-1 ${isToday ? 'text-[#ff6b01]' : 'text-gray-600'}`}>{day}</p>
              {dayDrehs.slice(0, 2).map((d, i) => {
                const sc = statusColor[d.status] || { bg: '#f3f4f6', text: '#6b7280' }
                return (
                  <div key={i} className="text-[9px] font-medium px-1 py-0.5 rounded mb-0.5 truncate" style={{ background: sc.bg, color: sc.text }}>
                    {d.kunde_name}
                  </div>
                )
              })}
              {dayDrehs.length > 2 && <div className="text-[9px] text-gray-400">+{dayDrehs.length - 2}</div>}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-3 mt-4 px-1">
        {Object.entries(statusColor).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: v.bg, border: `1px solid ${v.text}` }} />
            <span className="text-xs text-gray-400 capitalize">{k.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════
   TEAM
═══════════════════════════════════════ */
export function Team() {
  const { isAdmin, user } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'extern' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [kundenList, setKundenList] = useState([])
  const [lohnMap, setLohnMap] = useState({})       // user_id -> Stundenlohn
  const [zuordnung, setZuordnung] = useState({})   // user_id -> Set(kunde_id)
  const [stundenMap, setStundenMap] = useState({}) // user_id -> Stunden diesen Monat

  const MODULES = [
    { id: 'projekte', label: 'Projekte' },
    { id: 'crm', label: 'CRM' },
    { id: 'tasks', label: 'Tasks *' },
  ]

  useEffect(() => { if (isAdmin) { fetchMembers(); fetchExternData() } }, [isAdmin])

  async function fetchExternData() {
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const first = `${now.getFullYear()}-${mm}-01`
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const last = `${now.getFullYear()}-${mm}-${String(lastDay).padStart(2, '0')}`
    const [k, v, z, s] = await Promise.all([
      supabase.from('proj_kunden').select('id, name').order('name'),
      supabase.from('extern_verguetung').select('*'),
      supabase.from('extern_kunden').select('*'),
      supabase.from('minijob_stunden').select('user_id, stunden').gte('datum', first).lte('datum', last),
    ])
    setKundenList(k.data || [])
    setLohnMap(Object.fromEntries((v.data || []).map(r => [r.user_id, Number(r.stundenlohn)])))
    const zmap = {}; (z.data || []).forEach(r => { (zmap[r.user_id] ||= new Set()).add(r.kunde_id) }); setZuordnung(zmap)
    const smap = {}; (s.data || []).forEach(r => { smap[r.user_id] = (smap[r.user_id] || 0) + Number(r.stunden || 0) }); setStundenMap(smap)
  }

  async function saveLohn(uid, val) {
    const n = parseFloat(String(val).replace(',', '.')) || 0
    setLohnMap(p => ({ ...p, [uid]: n }))
    await supabase.from('extern_verguetung').upsert({ user_id: uid, stundenlohn: n, updated_at: new Date().toISOString() })
  }
  async function toggleKunde(uid, kid) {
    const has = zuordnung[uid]?.has(kid)
    setZuordnung(p => { const s = new Set(p[uid] || []); has ? s.delete(kid) : s.add(kid); return { ...p, [uid]: s } })
    if (has) await supabase.from('extern_kunden').delete().eq('user_id', uid).eq('kunde_id', kid)
    else await supabase.from('extern_kunden').insert({ user_id: uid, kunde_id: kid })
  }

  async function fetchMembers() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    if (data) setMembers(data)
    setLoading(false)
  }

  // Zugangs-Verwaltung via Edge Function admin-users (läuft mit Service-Rolle)
  async function callAdmin(body) {
    const { data, error } = await supabase.functions.invoke('admin-users', { body })
    if (error) {
      let m = error.message
      try { const j = await error.context.json(); if (j?.error) m = j.error } catch { /* ignore */ }
      throw new Error(m)
    }
    return data
  }
  async function createUser() {
    setErr(''); setMsg('')
    if (!form.email || !form.password) { setErr('E-Mail und Passwort nötig.'); return }
    if (form.password.length < 8) { setErr('Passwort mind. 8 Zeichen.'); return }
    setBusy(true)
    try {
      await callAdmin({ action: 'create', email: form.email.trim(), password: form.password, full_name: form.full_name.trim(), role: form.role })
      setMsg(`✓ Zugang für ${form.email.trim()} angelegt.`)
      setForm({ full_name: '', email: '', password: '', role: 'extern' })
      setShowAdd(false); fetchMembers()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function changeRole(id, role) {
    setErr(''); setMsg('')
    try { await callAdmin({ action: 'update', id, role }); fetchMembers() } catch (e) { setErr(e.message) }
  }
  async function resetPw(id, email) {
    setErr(''); setMsg('')
    const pw = window.prompt(`Neues Passwort für ${email} (mind. 8 Zeichen):`)
    if (!pw) return
    try { await callAdmin({ action: 'update', id, password: pw }); setMsg(`✓ Passwort für ${email} gesetzt.`) } catch (e) { setErr(e.message) }
  }
  async function removeUser(id, email) {
    setErr(''); setMsg('')
    if (!window.confirm(`Zugang ${email} wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return
    try { await callAdmin({ action: 'delete', id }); setMsg(`✓ Zugang ${email} gelöscht.`); fetchMembers() } catch (e) { setErr(e.message) }
  }

  function setLocalStamm(id, patch) {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
  }
  async function saveStamm(id, field, raw) {
    const n = parseFloat(String(raw ?? '').replace(',', '.'))
    await supabase.from('profiles').update({ [field]: isNaN(n) ? null : n }).eq('id', id)
  }
  async function saveModus(id, val) {
    setLocalStamm(id, { soll_modus: val })
    await supabase.from('profiles').update({ soll_modus: val }).eq('id', id)
  }
  async function toggleArbeitstag(m, tag) {
    const cur = Array.isArray(m.arbeitstage) && m.arbeitstage.length ? m.arbeitstage : [1, 2, 3, 4, 5]
    const next = cur.includes(tag) ? cur.filter(x => x !== tag) : [...cur, tag].sort((a, b) => a - b)
    setLocalStamm(m.id, { arbeitstage: next })
    await supabase.from('profiles').update({ arbeitstage: next }).eq('id', m.id)
  }

  async function togglePermission(memberId, mod, currentPerms) {
    const perms = currentPerms || []
    let newPerms
    if (mod === 'crm' && perms.includes('crm')) {
      newPerms = perms.filter(p => p !== 'crm' && p !== 'tasks')
    } else {
      newPerms = perms.includes(mod) ? perms.filter(p => p !== mod) : [...perms, mod]
    }
    if (mod === 'tasks' && !perms.includes('crm') && !newPerms.includes('crm')) return
    await supabase.from('profiles').update({ permissions: newPerms }).eq('id', memberId)
    fetchMembers()
  }

  if (!isAdmin) return <div className="p-6 text-center text-sm text-gray-400">Kein Zugriff.</div>
  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{members.length} Zugänge</p>
        <button onClick={() => { setShowAdd(true); setErr(''); setMsg('') }} className="btn-primary text-xs py-1.5 px-3">+ Zugang anlegen</button>
      </div>

      {msg && <div className="bg-green-50 border border-green-200 text-green-700 text-xs rounded-xl px-4 py-3">{msg}</div>}
      {err && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-4 py-3">{err}</div>}

      <div className="card overflow-hidden table-scroll">
        <table className="w-full min-w-[560px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Person</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Rolle</th>
              {MODULES.map(m => <th key={m.id} className="text-center px-2 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">{m.label}</th>)}
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-all">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-[#ff6b01]/10 flex items-center justify-center text-xs font-semibold text-[#ff6b01]">
                      {(m.full_name || m.email || '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{m.full_name || '—'}</p>
                      <p className="text-xs text-gray-400">{m.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <select value={m.role || 'mitarbeiter'} disabled={m.id === user?.id}
                    onChange={e => changeRole(m.id, e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none focus:border-[#ff6b01] disabled:opacity-50">
                    <option value="admin">Admin</option>
                    <option value="mitarbeiter">Mitarbeiter</option>
                    <option value="videograph">Videograph</option>
                    <option value="extern">Extern/Darsteller</option>
                  </select>
                </td>
                {MODULES.map(mod => (
                  <td key={mod.id} className="px-2 py-3 text-center">
                    {m.role === 'admin' ? (
                      <span className="text-[#ff6b01] text-sm">✓</span>
                    ) : ['extern', 'videograph'].includes(m.role) ? (
                      mod.id === 'projekte' ? <span className="text-green-600 text-sm">✓</span> : <span className="text-gray-300 text-sm">–</span>
                    ) : mod.id === 'tasks' ? (
                      <button
                        onClick={() => togglePermission(m.id, 'tasks', m.permissions)}
                        disabled={!(m.permissions || []).includes('crm')}
                        className={`w-5 h-5 rounded border-2 mx-auto block transition-all ${
                          (m.permissions || []).includes('tasks') && (m.permissions || []).includes('crm')
                            ? 'bg-[#ff6b01] border-[#ff6b01]'
                            : (m.permissions || []).includes('crm')
                            ? 'border-gray-300 hover:border-[#ff6b01]'
                            : 'border-gray-200 opacity-30 cursor-not-allowed'
                        }`}>
                        {(m.permissions || []).includes('tasks') && (m.permissions || []).includes('crm') && <span className="text-white text-[10px]">✓</span>}
                      </button>
                    ) : (
                      <button onClick={() => togglePermission(m.id, mod.id, m.permissions)}
                        className={`w-5 h-5 rounded border-2 mx-auto block transition-all ${(m.permissions || []).includes(mod.id) ? 'bg-[#ff6b01] border-[#ff6b01]' : 'border-gray-300 hover:border-[#ff6b01]'}`}>
                        {(m.permissions || []).includes(mod.id) && <span className="text-white text-[10px]">✓</span>}
                      </button>
                    )}
                  </td>
                ))}
                <td className="px-3 py-3 whitespace-nowrap text-right">
                  <button onClick={() => resetPw(m.id, m.email)} className="text-xs text-gray-400 hover:text-gray-700 mr-3">Passwort</button>
                  {m.id !== user?.id && <button onClick={() => removeUser(m.id, m.email)} className="text-xs text-red-400 hover:text-red-600">Löschen</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
        * Tasks nur mit CRM-Zugriff. „Extern" (Videograf/Darsteller) sieht ausschließlich Projekte – CRM &amp; Co. sind auch technisch (DB) gesperrt.
      </div>

      {/* Soll-Stunden, Arbeitstage & Urlaubsanspruch */}
      <div className="card p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Soll-Stunden, Arbeitstage & Urlaub</h3>
        <div className="space-y-3">
          {members.map(m => {
            const at = Array.isArray(m.arbeitstage) && m.arbeitstage.length ? m.arbeitstage : [1, 2, 3, 4, 5]
            return (
              <div key={m.id} className="py-2 border-b border-gray-50 last:border-0 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[120px]">
                    <p className="text-sm font-medium text-gray-800 truncate">{m.full_name || '—'}</p>
                    <p className="text-xs text-gray-400 truncate">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input type="number" step="0.5" inputMode="decimal" className="input text-xs w-16 text-center px-1"
                      value={m.soll_stunden ?? ''} onChange={e => setLocalStamm(m.id, { soll_stunden: e.target.value })}
                      onBlur={e => saveStamm(m.id, 'soll_stunden', e.target.value)} placeholder="–" />
                    <select className="input text-xs w-20 px-1" value={m.soll_modus || 'woche'} onChange={e => saveModus(m.id, e.target.value)}>
                      <option value="woche">h/Woche</option>
                      <option value="monat">h/Monat</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input type="number" step="1" inputMode="decimal" className="input text-xs w-16 text-center px-1"
                      value={m.urlaub_anspruch_tage ?? ''} onChange={e => setLocalStamm(m.id, { urlaub_anspruch_tage: e.target.value })}
                      onBlur={e => saveStamm(m.id, 'urlaub_anspruch_tage', e.target.value)} placeholder="–" />
                    <span className="text-[10px] text-gray-400 w-14">Urlaubst.</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider mr-1">Arbeitstage</span>
                  {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((lbl, i) => {
                    const tag = i + 1, on = at.includes(tag)
                    return (
                      <button key={tag} onClick={() => toggleArbeitstag(m, tag)}
                        className={`w-7 h-7 rounded-md text-[10px] font-semibold transition-all ${on ? 'bg-[#ff6b01] text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                        {lbl}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-gray-400 mt-3">Soll-Stunden (pro Woche oder Monat) & Urlaubstage/Jahr — leer lassen = keine Vorgabe (z.B. für dich als Chef). Arbeitstage steuern Soll & Feiertagsberechnung. Wird automatisch gespeichert.</p>
      </div>

      {/* Externe / Minijob: Stundenlohn & Kundenzuordnung */}
      <div className="card p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Externe / Minijob – Stundenlohn & Kunden</h3>
        {members.filter(m => ['extern', 'videograph'].includes(m.role)).length === 0 ? (
          <p className="text-xs text-gray-400">Noch keine Zugänge mit Rolle „Extern" oder „Videograph".</p>
        ) : (
          <div className="space-y-4">
            {members.filter(m => ['extern', 'videograph'].includes(m.role)).map(m => {
              const h = stundenMap[m.id] || 0
              const lohn = Number(lohnMap[m.id]) || 0
              return (
                <div key={m.id} className="py-2 border-b border-gray-50 last:border-0 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[120px]">
                      <p className="text-sm font-medium text-gray-800 truncate">{m.full_name || '—'}</p>
                      <p className="text-xs text-gray-400 truncate">{m.email}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input type="number" step="0.5" inputMode="decimal" className="input text-xs w-20 text-center px-1"
                        value={lohnMap[m.id] ?? ''} onChange={e => setLohnMap(p => ({ ...p, [m.id]: e.target.value }))}
                        onBlur={e => saveLohn(m.id, e.target.value)} placeholder="€/h" />
                      <span className="text-[10px] text-gray-400">€/Std.</span>
                    </div>
                    <div className="text-xs text-gray-500 whitespace-nowrap">
                      {new Date().toLocaleDateString('de-DE', { month: 'long' })}: <span className="font-semibold text-gray-800">{(Math.round(h * 100) / 100).toLocaleString('de-DE')} Std.</span>
                      {' · '}<span className="font-semibold text-[#c2410c]">{(h * lohn).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                    </div>
                  </div>
                  {m.role === 'videograph' ? (
                    <p className="text-[10px] text-gray-400">Videograph – sieht alle Drehs außer „Abgeschlossen" (keine Kundenzuordnung nötig).</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider mr-1 self-center">Kunden</span>
                      {kundenList.map(k => {
                        const on = zuordnung[m.id]?.has(k.id)
                        return (
                          <button key={k.id} onClick={() => toggleKunde(m.id, k.id)}
                            className={`text-xs px-2 py-1 rounded-md transition-all ${on ? 'bg-[#ff6b01] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                            {k.name}
                          </button>
                        )
                      })}
                      {kundenList.length === 0 && <span className="text-xs text-gray-400">Keine Kunden angelegt.</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <p className="text-[10px] text-gray-400 mt-3">Stundenlohn wird automatisch gespeichert (nur du & die Person sehen ihn). Zugeordnete Kunden bestimmen, welche Drehs (Status „Dreh") der/die Externe sieht. „Stunden" = laufender Monat.</p>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/20 z-[70] flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-gray-100 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Zugang anlegen</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="space-y-3">
              <div><label className="label">Name</label><input className="input" value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} placeholder="Max Mustermann" /></div>
              <div><label className="label">E-Mail</label><input className="input" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="max@brehlvisuals.de" /></div>
              <div><label className="label">Passwort</label><input className="input" type="text" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Min. 8 Zeichen" /></div>
              <div>
                <label className="label">Rolle</label>
                <select className="input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                  <option value="videograph">Videograph – Projekte (alles außer Abgeschlossen)</option>
                  <option value="extern">Extern/Darsteller – nur eigene Drehs (Status „Dreh")</option>
                  <option value="mitarbeiter">Mitarbeiter</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
              <p className="text-xs text-gray-400">Die Person meldet sich direkt mit E-Mail + Passwort an – keine Bestätigungs-Mail nötig.</p>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1">Abbrechen</button>
              <button onClick={createUser} disabled={busy} className="btn-primary flex-1">{busy ? 'Legt an...' : 'Zugang anlegen →'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════
   EINSTELLUNGEN
═══════════════════════════════════════ */
export function Einstellungen() {
  const { profile, signOut } = useAuth()
  const [newPw, setNewPw] = useState('')
  const [msg, setMsg] = useState('')

  async function changePassword() {
    if (newPw.length < 8) { setMsg('Mindestens 8 Zeichen'); return }
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) setMsg('Fehler: ' + error.message)
    else { setMsg('Passwort geändert!'); setNewPw('') }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-lg">
      <div className="card p-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Mein Profil</h3>
        <div className="space-y-0.5">
          {[['E-Mail', profile?.email], ['Rolle', profile?.role === 'admin' ? 'Administrator' : profile?.role === 'videograph' ? 'Videograph' : profile?.role === 'extern' ? 'Extern' : 'Mitarbeiter']].map(([l, v]) => (
            <div key={l} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
              <span className="text-xs text-gray-400 w-24">{l}</span>
              <span className="text-sm text-gray-700">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Passwort ändern</h3>
        <div className="space-y-3">
          <div><label className="label">Neues Passwort</label><input type="password" className="input" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 8 Zeichen" /></div>
          {msg && <p className={`text-xs ${msg.includes('Fehler') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>}
          <button onClick={changePassword} className="btn-primary text-xs py-2 px-4">Passwort speichern</button>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Account</h3>
        <button onClick={signOut} className="text-sm text-red-500 hover:text-red-700 font-medium transition-colors">Ausloggen</button>
      </div>
    </div>
  )
}

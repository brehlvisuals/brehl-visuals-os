import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const STATUSES = [
  { id: 'planung',        label: 'Planung',         color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  text: '#b45309' },
  { id: 'abnahme_kunde', label: 'Abnahme Kunde',    color: '#6366f1', bg: 'rgba(99,102,241,0.1)',  text: '#4338ca' },
  { id: 'dreh',          label: 'Dreh',             color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  text: '#1d4ed8' },
  { id: 'cutting',       label: 'Cutting',          color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', text: '#6d28d9' },
  { id: 'posting',       label: 'Posting',          color: '#f97316', bg: 'rgba(249,115,22,0.1)',  text: '#c2410c' },
  { id: 'abgeschlossen', label: 'Abgeschlossen',    color: '#16a34a', bg: 'rgba(22,163,74,0.1)',   text: '#15803d' },
]

const INTERN_STATUSES = [
  { id: 'planung',  label: 'Planung',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  text: '#b45309' },
  { id: 'dreh',     label: 'Dreh',     color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  text: '#1d4ed8' },
  { id: 'cutting',  label: 'Cutting',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', text: '#6d28d9' },
  { id: 'posting',  label: 'Posting',  color: '#f97316', bg: 'rgba(249,115,22,0.1)',  text: '#c2410c' },
]

// Leere Auswahl-/Datumsfelder müssen als null gespeichert werden –
// Postgres lehnt "" bei uuid- und date-Spalten sonst mit einem 400 ab.
const NULLABLE_KEYS = ['datum', 'kunde_id', 'zustaendig_id', 'darsteller_id']
function cleanDreh(data) {
  const out = { ...data }
  for (const k of NULLABLE_KEYS) if (out[k] === '') out[k] = null
  return out
}

function Pill({ status, statuses = STATUSES }) {
  const s = statuses.find(x => x.id === status)
  if (!s) return null
  return <span className="inline-flex text-xs font-medium px-2 py-0.5 rounded-md" style={{ background: s.bg, color: s.text }}>{s.label}</span>
}

// Feste Farbpalette – jeder Kunde bekommt anhand seines Namens stabil eine Farbe
const KUNDE_COLORS = [
  { bg: 'rgba(59,130,246,0.12)',  text: '#1d4ed8' },
  { bg: 'rgba(22,163,74,0.12)',   text: '#15803d' },
  { bg: 'rgba(239,68,68,0.12)',   text: '#b91c1c' },
  { bg: 'rgba(249,115,22,0.12)',  text: '#c2410c' },
  { bg: 'rgba(139,92,246,0.12)',  text: '#6d28d9' },
  { bg: 'rgba(14,165,233,0.12)',  text: '#0369a1' },
  { bg: 'rgba(217,70,239,0.12)',  text: '#a21caf' },
  { bg: 'rgba(245,158,11,0.14)',  text: '#b45309' },
  { bg: 'rgba(20,184,166,0.12)',  text: '#0f766e' },
  { bg: 'rgba(236,72,153,0.12)',  text: '#be185d' },
]
function kundeStyle(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return KUNDE_COLORS[h % KUNDE_COLORS.length]
}
// Ein Dreh gilt als vollständig gesichert, wenn RAW UND FINAL auf NAS liegen
const istGesichert = d => !!(d?.raw_gesichert && d?.final_gesichert)

// Plaintext (z.B. aus Airtable-Migration) sicher in HTML wandeln, sonst HTML unverändert lassen
function toHtml(v) {
  if (v == null || v === '') return ''
  const s = String(v)
  if (/<[a-z][\s\S]*>/i.test(s)) return s
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
}

// Rich-Text-Editor: fett/kursiv/Überschrift/Liste, wächst automatisch mit dem Inhalt
function RichText({ value, onChange, placeholder }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.innerHTML = toHtml(value)
    // nur beim Mount setzen, sonst springt der Cursor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const exec = (cmd, arg) => {
    document.execCommand(cmd, false, arg)
    if (ref.current) onChange(ref.current.innerHTML)
  }
  const B = 'w-7 h-7 rounded text-xs text-gray-600 hover:bg-gray-100 flex items-center justify-center'
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:border-[#ff6b01]">
      <div className="flex items-center gap-0.5 border-b border-gray-100 bg-gray-50 px-1 py-1">
        <button type="button" title="Fett" onMouseDown={e => { e.preventDefault(); exec('bold') }} className={B} style={{ fontWeight: 700 }}>B</button>
        <button type="button" title="Kursiv" onMouseDown={e => { e.preventDefault(); exec('italic') }} className={B} style={{ fontStyle: 'italic' }}>I</button>
        <button type="button" title="Überschrift" onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'H3') }} className={B + ' font-bold'}>H</button>
        <button type="button" title="Liste" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList') }} className={B}>•</button>
        <button type="button" title="Formatierung entfernen" onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'DIV'); exec('removeFormat') }} className={B}>⌫</button>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning
        onInput={e => onChange(e.currentTarget.innerHTML)}
        data-ph={placeholder || ''}
        className="rt-edit text-xs text-gray-700 leading-relaxed px-2.5 py-2 outline-none min-h-[2.5rem]" />
    </div>
  )
}

// Textarea, die automatisch so hoch wird wie ihr Inhalt
function AutoTextarea({ className = '', value, onChange, ...rest }) {
  const ref = useRef(null)
  const fit = el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }
  useEffect(() => { fit(ref.current) }, [value])
  return (
    <textarea ref={ref} rows={1} value={value}
      onChange={e => { fit(e.target); onChange?.(e) }}
      className={className + ' resize-none overflow-hidden'} {...rest} />
  )
}

export default function Projekte() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('kunden')
  const [view, setView] = useState('kanban')
  const [drehs, setDrehs] = useState([])
  const [intern, setIntern] = useState([])
  const [kunden, setKunden] = useState([])
  const [darsteller, setDarsteller] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selected, setSelected] = useState(null)
  const [kundeFilter, setKundeFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showAddIntern, setShowAddIntern] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAddKunde, setShowAddKunde] = useState(false)
  const [showAddDarsteller, setShowAddDarsteller] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [d, i, k, dar, p] = await Promise.all([
      supabase.from('proj_drehs').select('*').order('datum', { ascending: false }),
      supabase.from('proj_intern').select('*').order('created_at', { ascending: false }),
      supabase.from('proj_kunden').select('*').order('name'),
      supabase.from('crm_darsteller').select('id, name').order('name'),
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
    ])
    if (d.data) setDrehs(d.data)
    if (i.data) setIntern(i.data)
    if (k.data) setKunden(k.data)
    if (dar.data) setDarsteller(dar.data)
    if (p.data) setProfiles(p.data)
    setLoading(false)
  }

  async function updateDrehStatus(id, status) {
    const dreh = drehs.find(d => d.id === id)
    if (status === 'abgeschlossen' && !istGesichert(dreh)) return false
    await supabase.from('proj_drehs').update({ status }).eq('id', id)
    fetchAll()
    if (selected?.id === id) setSelected(prev => ({ ...prev, status }))
    return true
  }

  async function deleteDreh(id) {
    await supabase.from('proj_notizen').delete().eq('dreh_id', id)
    await supabase.from('proj_drehs').delete().eq('id', id)
    setSelected(null)
    fetchAll()
  }

  // Drag & Drop: Karte auf eine andere Status-Spalte ziehen
  async function handleDrop(status) {
    const id = draggingId
    setDraggingId(null); setDragOverCol(null)
    if (!id) return
    const dreh = drehs.find(d => d.id === id)
    if (!dreh || dreh.status === status) return
    if (status === 'abgeschlossen' && !istGesichert(dreh)) {
      alert('Erst RAW und Final auf NAS sichern (beide Häkchen im Dreh öffnen), dann auf „Abgeschlossen" ziehen.')
      return
    }
    setDrehs(prev => prev.map(d => d.id === id ? { ...d, status } : d))   // optimistisch
    await supabase.from('proj_drehs').update({ status }).eq('id', id)
    fetchAll()
  }

  const filtered = kundeFilter ? drehs.filter(d => d.kunde_name === kundeFilter) : drehs

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-lg p-1 w-fit gap-0.5 overflow-x-auto">
        {[['kunden','Kunden-Drehs'],['intern','Intern'],['verwalten','Verwalten']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* KUNDEN */}
      {tab === 'kunden' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={kundeFilter} onChange={e => setKundeFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white text-gray-700 outline-none focus:border-[#ff6b01]">
              <option value="">Alle Kunden</option>
              {kunden.map(k => <option key={k.id} value={k.name}>{k.name}</option>)}
            </select>
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              {['kanban','tabelle'].map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-all ${view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                  {v}
                </button>
              ))}
            </div>
            <button onClick={() => setShowAdd(true)} className="ml-auto btn-primary text-xs py-1.5 px-3">+ Neuer Dreh</button>
          </div>

          {view === 'kanban' && (
            <div className="kanban-scroll">
              {STATUSES.map(st => {
                const cols = filtered.filter(d => d.status === st.id)
                return (
                  <div key={st.id}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverCol !== st.id) setDragOverCol(st.id) }}
                    onDrop={() => handleDrop(st.id)}
                    className={`w-full md:w-52 md:flex-shrink-0 rounded-xl transition-colors ${dragOverCol === st.id && draggingId ? 'bg-[#ff6b01]/5 ring-1 ring-[#ff6b01]/30' : ''}`}>
                    <div className="flex items-center justify-between mb-2 px-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
                        <span className="text-xs font-semibold text-gray-500">{st.label}</span>
                      </div>
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{cols.length}</span>
                    </div>
                    <div className="space-y-2 min-h-8">
                      {cols.map(dreh => {
                        const ks = kundeStyle(dreh.kunde_name)
                        const gesichert = istGesichert(dreh)
                        return (
                        <div key={dreh.id}
                          draggable
                          onDragStart={e => { setDraggingId(dreh.id); e.dataTransfer.effectAllowed = 'move' }}
                          onDragEnd={() => { setDraggingId(null); setDragOverCol(null) }}
                          onClick={() => setSelected(dreh)}
                          className={`bg-white border rounded-xl p-3 cursor-grab active:cursor-grabbing hover:shadow-sm hover:-translate-y-0.5 transition-all ${selected?.id === dreh.id ? 'border-[#ff6b01] shadow-sm' : 'border-gray-100'} ${draggingId === dreh.id ? 'opacity-40' : ''}`}>
                          <p className="text-xs font-semibold text-gray-800 mb-1">{dreh.datum ? new Date(dreh.datum).toLocaleDateString('de-DE') : '—'}</p>
                          {kundeFilter ? (
                            <>
                              <p className="text-xs text-gray-400 mb-2">{dreh.kunde_name}</p>
                              <Pill status={dreh.status} />
                            </>
                          ) : (
                            <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-md" style={{ background: ks.bg, color: ks.text }}>{dreh.kunde_name}</span>
                          )}
                          <p className="text-xs text-gray-400 mt-1.5">📹 {dreh.video_count || 0} Videos</p>
                          {!gesichert && ['dreh','cutting','posting'].includes(dreh.status) && (
                            <div className="mt-1.5 text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-md inline-block">🔒 Sicherung fehlt</div>
                          )}
                          {gesichert && (
                            <div className="mt-1.5 text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-md inline-block">✓ Gesichert</div>
                          )}
                          {dreh.status === 'abnahme_kunde' && dreh.abnahme_bestaetigt && (
                            <div className="mt-1.5 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md inline-block">✓ Abgenommen</div>
                          )}
                        </div>
                        )
                      })}
                      <button onClick={() => setShowAdd(true)}
                        className="w-full border border-dashed border-gray-200 rounded-xl py-2 text-xs text-gray-400 hover:border-[#ff6b01] hover:text-[#ff6b01] transition-all">
                        + Dreh
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {view === 'tabelle' && (
            <div className="bg-white border border-gray-100 rounded-xl table-scroll">
              <table className="w-full min-w-max">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Datum','Kunde','Status','Videos','Darsteller','NAS'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(dreh => (
                    <tr key={dreh.id} onClick={() => setSelected(dreh)}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-all">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-800">{dreh.datum ? new Date(dreh.datum).toLocaleDateString('de-DE') : '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{dreh.kunde_name}</td>
                      <td className="px-4 py-3"><Pill status={dreh.status} /></td>
                      <td className="px-4 py-3 text-sm text-gray-600">{dreh.video_count || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{dreh.darsteller_name || '—'}</td>
                      <td className="px-4 py-3 text-sm">{dreh.nas_gesichert ? <span className="text-green-600">✓</span> : <span className="text-red-500">✗</span>}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan="6" className="text-center py-10 text-sm text-gray-400">Keine Drehs</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* INTERN */}
      {tab === 'intern' && (
        <>
          <div className="flex justify-end">
            <button onClick={() => setShowAddIntern(true)} className="btn-primary text-xs py-1.5 px-3">+ Neues Konzept</button>
          </div>
          <div className="kanban-scroll">
            {INTERN_STATUSES.map(st => {
              const cols = intern.filter(i => i.status === st.id)
              return (
                <div key={st.id} className="w-full md:w-52 md:flex-shrink-0">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
                      <span className="text-xs font-semibold text-gray-500">{st.label}</span>
                    </div>
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{cols.length}</span>
                  </div>
                  <div className="space-y-2 min-h-8">
                    {cols.map(item => (
                      <div key={item.id} className="bg-white border border-gray-100 rounded-xl p-3 cursor-pointer hover:border-orange-200 hover:shadow-sm transition-all">
                        <p className="text-xs font-semibold text-gray-800 mb-1">{item.titel}</p>
                        <p className="text-xs text-gray-400">{item.drehtag ? new Date(item.drehtag).toLocaleDateString('de-DE') : 'Kein Drehtag'}{item.zustaendig ? ` · ${item.zustaendig}` : ''}</p>
                      </div>
                    ))}
                    <button className="w-full border border-dashed border-gray-200 rounded-xl py-2 text-xs text-gray-400 hover:border-[#ff6b01] hover:text-[#ff6b01] transition-all">
                      + Konzept
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* VERWALTEN */}
      {tab === 'verwalten' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Kunden</h3>
              <button onClick={() => setShowAddKunde(true)} className="btn-primary text-xs py-1 px-2.5">+ Neu</button>
            </div>
            <div className="space-y-0.5">
              {kunden.map(k => (
                <div key={k.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{k.name}</p>
                    {k.kontakt && <p className="text-xs text-gray-400">{k.kontakt}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => navigate('/journal', { state: { kundeId: k.id } })} className="text-xs text-[#ff6b01] hover:text-[#e05f00]">Journal</button>
                    <button className="text-xs text-gray-500 hover:text-gray-700">Bearbeiten</button>
                    <button onClick={async () => { await supabase.from('proj_kunden').delete().eq('id', k.id); fetchAll() }} className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                  </div>
                </div>
              ))}
              {kunden.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">Noch keine Kunden</p>}
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Darsteller</h3>
              <button onClick={() => setShowAddDarsteller(true)} className="btn-primary text-xs py-1 px-2.5">+ Neu</button>
            </div>
            <div className="space-y-0.5">
              {darsteller.map(d => (
                <div key={d.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                  <p className="text-sm font-medium text-gray-800">{d.name}</p>
                  <div className="flex gap-2">
                    <button className="text-xs text-gray-500 hover:text-gray-700">Bearbeiten</button>
                    <button onClick={async () => { await supabase.from('crm_darsteller').delete().eq('id', d.id); fetchAll() }} className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                  </div>
                </div>
              ))}
              {darsteller.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">Noch keine Darsteller</p>}
            </div>
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {selected && (
        <DrehDetail dreh={selected} kunden={kunden} darsteller={darsteller} profiles={profiles}
          onClose={() => setSelected(null)}
          onStatusChange={s => updateDrehStatus(selected.id, s)}
          onRefresh={fetchAll}
          onDelete={() => deleteDreh(selected.id)}
        />
      )}

      {/* Add Dreh Modal */}
      {showAdd && (
        <Modal title="Neuer Dreh" onClose={() => setShowAdd(false)}>
          <AddDrehForm kunden={kunden} darsteller={darsteller} profiles={profiles}
            onSave={async data => {
              await supabase.from('proj_drehs').insert(cleanDreh(data))
              setShowAdd(false); fetchAll()
            }}
            onClose={() => setShowAdd(false)}
          />
        </Modal>
      )}

      {showAddKunde && (
        <Modal title="Neuer Kunde" onClose={() => setShowAddKunde(false)}>
          <AddKundeForm onSave={async data => { await supabase.from('proj_kunden').insert(data); setShowAddKunde(false); fetchAll() }} onClose={() => setShowAddKunde(false)} />
        </Modal>
      )}

      {showAddDarsteller && (
        <Modal title="Neuer Darsteller" onClose={() => setShowAddDarsteller(false)}>
          <AddDarstellerForm onSave={async data => { await supabase.from('crm_darsteller').insert(data); setShowAddDarsteller(false); fetchAll() }} onClose={() => setShowAddDarsteller(false)} />
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/20 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function AddDrehForm({ kunden, darsteller, profiles, onSave, onClose }) {
  const [form, setForm] = useState({ datum: '', kunde_id: '', kunde_name: '', zustaendig_id: '', video_count: 8, status: 'planung' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-3">
      <div><label className="label">Datum</label><input type="date" className="input" value={form.datum} onChange={e => set('datum', e.target.value)} /></div>
      <div>
        <label className="label">Kunde</label>
        <select className="input" value={form.kunde_id} onChange={e => {
          const k = kunden.find(k => k.id === e.target.value)
          setForm(p => ({ ...p, kunde_id: e.target.value, kunde_name: k?.name || '' }))
        }}>
          <option value="">Kunde wählen</option>
          {kunden.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Videograph</label>
        <select className="input" value={form.zustaendig_id} onChange={e => set('zustaendig_id', e.target.value)}>
          <option value="">Person wählen</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
        </select>
      </div>
      <div><label className="label">Geplante Videos</label><input type="number" className="input" value={form.video_count} onChange={e => set('video_count', parseInt(e.target.value) || 0)} min={1} /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => onSave(form)} className="btn-primary flex-1">Anlegen →</button>
      </div>
    </div>
  )
}

function AddKundeForm({ onSave, onClose }) {
  const [form, setForm] = useState({ name: '', kontakt: '', email: '' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-3">
      <div><label className="label">Name</label><input className="input" placeholder="Kundenname" value={form.name} onChange={e => set('name', e.target.value)} /></div>
      <div><label className="label">Kontakt (Telefon/E-Mail)</label><input className="input" placeholder="info@kunde.de" value={form.kontakt} onChange={e => set('kontakt', e.target.value)} /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => { if (form.name) onSave(form) }} className="btn-primary flex-1">Hinzufügen →</button>
      </div>
    </div>
  )
}

function AddDarstellerForm({ onSave, onClose }) {
  const [form, setForm] = useState({ name: '', telefon: '', email: '', status: 'neu' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-3">
      <div><label className="label">Name</label><input className="input" placeholder="Vor- und Nachname" value={form.name} onChange={e => set('name', e.target.value)} /></div>
      <div><label className="label">Telefon</label><input className="input" placeholder="+49..." value={form.telefon} onChange={e => set('telefon', e.target.value)} /></div>
      <div><label className="label">E-Mail</label><input className="input" type="email" placeholder="email@..." value={form.email} onChange={e => set('email', e.target.value)} /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => { if (form.name) onSave(form) }} className="btn-primary flex-1">Hinzufügen →</button>
      </div>
    </div>
  )
}

function DrehDetail({ dreh, kunden, darsteller, profiles, onClose, onStatusChange, onRefresh, onDelete }) {
  const [tab, setTab] = useState('info')
  const [form, setForm] = useState({ ...dreh })
  const [videos, setVideos] = useState(dreh.videos || [])
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const [nasWarn, setNasWarn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [recruitingOn, setRecruitingOn] = useState(!!(dreh.recruiting && String(dreh.recruiting).trim()))
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { fetchNotes() }, [dreh.id])

  async function fetchNotes() {
    const { data } = await supabase.from('proj_notizen').select('*').eq('dreh_id', dreh.id).order('created_at', { ascending: false })
    if (data) setNotes(data)
  }

  async function save() {
    setSaving(true)
    const payload = { ...form, videos, nas_gesichert: !!(form.raw_gesichert && form.final_gesichert) }
    await supabase.from('proj_drehs').update(cleanDreh(payload)).eq('id', dreh.id)
    setSaving(false); onRefresh()
  }

  async function addNote() {
    if (!noteText.trim()) return
    await supabase.from('proj_notizen').insert({ dreh_id: dreh.id, text: noteText.trim() })
    setNoteText(''); fetchNotes()
  }

  function handleStatusChange(status) {
    if (status === 'abgeschlossen' && !(form.raw_gesichert && form.final_gesichert)) {
      // Ohne RAW+Final-Sicherung nicht abschließbar -> zurück auf Posting
      setNasWarn(true); set('status', 'posting'); onStatusChange('posting'); return
    }
    setNasWarn(false)
    set('status', status)
    onStatusChange(status)
  }

  // Sicherung umschalten; wird ein Häkchen entfernt und der Dreh war "Abgeschlossen" -> zurück auf Posting
  function toggleSicherung(field, val) {
    const beide = field === 'raw_gesichert' ? (val && !!form.final_gesichert) : (!!form.raw_gesichert && val)
    set(field, val)
    if (beide) setNasWarn(false)
    else if (form.status === 'abgeschlossen') { set('status', 'posting'); onStatusChange('posting'); setNasWarn(true) }
  }

  function addVideo() { setVideos(prev => [...prev, { titel: '', planung: '', datei_url: '', datei_name: '' }]) }
  function removeVideo(i) { setVideos(prev => prev.filter((_, idx) => idx !== i)) }

  return (
    <div className="fixed inset-0 bg-black/10 z-[60] flex" onClick={onClose}>
      <div className="ml-auto bg-white w-full max-w-md h-full flex flex-col shadow-2xl border-l border-gray-100" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="font-bold text-gray-900">{dreh.datum ? new Date(dreh.datum).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }) : 'Dreh'}</p>
            <p className="text-xs text-gray-400">{dreh.kunde_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving} className="btn-primary text-xs py-1.5 px-3">{saving ? 'Speichert...' : 'Speichern'}</button>
            <button onClick={() => { if (window.confirm('Diesen Dreh wirklich löschen? Das kann nicht rückgängig gemacht werden.')) onDelete?.() }}
              title="Dreh löschen"
              className="w-7 h-7 bg-red-50 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-100 text-sm">🗑</button>
            <button onClick={onClose} className="w-6 h-6 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-200 text-sm">×</button>
          </div>
        </div>

        {/* Status row */}
        <div className="px-4 py-2.5 border-b border-gray-100 flex gap-1.5 flex-wrap flex-shrink-0">
          {STATUSES.map(s => (
            <button key={s.id} onClick={() => handleStatusChange(s.id)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full transition-all border ${form.status === s.id ? 'border-current shadow-sm' : 'border-transparent opacity-50 hover:opacity-80'}`}
              style={{ background: s.bg, color: s.text, borderColor: form.status === s.id ? s.color : 'transparent' }}>
              {s.label}
            </button>
          ))}
        </div>

        {nasWarn && (
          <div className="mx-4 mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600 flex-shrink-0">
            🔒 Erst RAW und Final auf NAS sichern (beide Häkchen), dann „Abgeschlossen". Zurück auf Posting gesetzt.
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          {['Info','Videos','Kommentare'].map(t => (
            <button key={t} onClick={() => setTab(t.toLowerCase())}
              className={`flex-1 py-2.5 text-xs font-medium transition-all border-b-2 ${tab === t.toLowerCase() ? 'text-[#ff6b01] border-[#ff6b01]' : 'text-gray-400 border-transparent'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === 'info' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Kunde</label>
                  <select className="input text-xs" value={form.kunde_id || ''} onChange={e => { const k = kunden.find(k => k.id === e.target.value); setForm(p => ({ ...p, kunde_id: e.target.value, kunde_name: k?.name || '' })) }}>
                    {kunden.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Datum</label><input type="date" className="input text-xs" value={form.datum || ''} onChange={e => set('datum', e.target.value)} /></div>
              </div>
              <div><label className="label">Videograph</label>
                <select className="input text-xs" value={form.zustaendig_id || ''} onChange={e => set('zustaendig_id', e.target.value)}>
                  <option value="">—</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Sicherung</label>
                <div className="space-y-1 mt-1">
                  <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={!!form.raw_gesichert} onChange={e => toggleSicherung('raw_gesichert', e.target.checked)} className="rounded" />
                    RAW auf NAS gesichert
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={!!form.final_gesichert} onChange={e => toggleSicherung('final_gesichert', e.target.checked)} className="rounded" />
                    Final auf NAS gesichert
                  </label>
                </div>
              </div>
              {form.status === 'abnahme_kunde' && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-indigo-800 mb-1">Abnahme Kunde</p>
                  <p className="text-xs text-indigo-600 mb-2">Kunden-E-Mail für Abnahme auswählen:</p>
                  <select className="input text-xs mb-2">
                    <option>E-Mail aus Kundendaten</option>
                    {kunden.filter(k => k.kontakt?.includes('@')).map(k => <option key={k.id}>{k.kontakt}</option>)}
                  </select>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="checkbox" id="abnahme" checked={form.abnahme_bestaetigt || false} onChange={e => set('abnahme_bestaetigt', e.target.checked)} className="rounded" />
                    <label htmlFor="abnahme" className="text-xs text-indigo-700 cursor-pointer">Kunde hat Abnahme bestätigt</label>
                  </div>
                </div>
              )}
              <div><label className="label">Erläuterungen Cutter</label><AutoTextarea className="input text-xs" value={form.erlaeuterungen_cutter || ''} onChange={e => set('erlaeuterungen_cutter', e.target.value)} placeholder="Hinweise für den Cutter..." /></div>
              <div><label className="label">Requisiten</label><AutoTextarea className="input text-xs" value={form.requisiten || ''} onChange={e => set('requisiten', e.target.value)} placeholder="Benötigte Requisiten..." /></div>
            </>
          )}

          {tab === 'videos' && (
            <>
              {videos.map((v, i) => (
                <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Video {i + 1}</span>
                    <button onClick={() => removeVideo(i)} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Entfernen</button>
                  </div>
                  <input className="input text-xs mb-2" value={v.titel} onChange={e => setVideos(prev => prev.map((vid, idx) => idx === i ? { ...vid, titel: e.target.value } : vid))} placeholder="Video-Titel..." />
                  <div className="mb-2"><RichText value={v.planung || ''} onChange={val => setVideos(prev => prev.map((vid, idx) => idx === i ? { ...vid, planung: val } : vid))} placeholder="Video-Planung / Konzept..." /></div>
                  {v.datei_name ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-green-600 font-medium">▶ {v.datei_name}</span>
                    </div>
                  ) : (
                    <div className="border border-dashed border-gray-300 rounded-lg py-3 text-center text-xs text-gray-400">
                      📁 Datei hochladen (nach Deployment verfügbar)
                    </div>
                  )}
                </div>
              ))}
              <button onClick={addVideo} className="w-full py-2 border border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:border-[#ff6b01] hover:text-[#ff6b01] transition-all">
                + Video hinzufügen
              </button>

              {recruitingOn ? (
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recruiting</span>
                    <button onClick={() => { setRecruitingOn(false); set('recruiting', '') }} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Entfernen</button>
                  </div>
                  <RichText value={form.recruiting || ''} onChange={val => set('recruiting', val)} placeholder="Recruiting / Casting-Bedarf..." />
                </div>
              ) : (
                <button onClick={() => setRecruitingOn(true)} className="w-full py-2 border border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:border-[#ff6b01] hover:text-[#ff6b01] transition-all">
                  + Recruiting-Bereich
                </button>
              )}
            </>
          )}

          {tab === 'kommentare' && (
            <>
              {notes.map(n => (
                <div key={n.id} className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#ff6b01]/10 flex items-center justify-center text-xs font-semibold text-[#ff6b01] flex-shrink-0">?</div>
                  <div className="bg-gray-50 rounded-lg rounded-tl-none px-3 py-2 flex-1">
                    <p className="text-xs text-gray-700 leading-relaxed">{n.text}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{new Date(n.created_at).toLocaleDateString('de-DE')}</p>
                  </div>
                </div>
              ))}
              {notes.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Noch keine Kommentare</p>}
              <div className="flex gap-2 mt-2">
                <input className="input text-xs flex-1" value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Kommentar schreiben..." onKeyDown={e => e.key === 'Enter' && e.metaKey && addNote()} />
                <button onClick={addNote} className="btn-primary text-xs px-3">+</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

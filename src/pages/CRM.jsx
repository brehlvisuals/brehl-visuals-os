import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const DEFAULT_CATS = [
  { id: 'leads', label: 'Leads', icon: '◉', table: 'crm_leads',
    statuses: [
      { id:'neu', label:'Neu', color:'#6366f1', bg:'rgba(99,102,241,0.1)', text:'#4338ca' },
      { id:'qualifiziert', label:'Qualifiziert', color:'#f59e0b', bg:'rgba(245,158,11,0.1)', text:'#b45309' },
      { id:'erstgespraech', label:'Erstgespräch', color:'#3b82f6', bg:'rgba(59,130,246,0.1)', text:'#1d4ed8' },
      { id:'zweitgespraech', label:'Zweitgespräch', color:'#8b5cf6', bg:'rgba(139,92,246,0.1)', text:'#6d28d9' },
      { id:'erfolgreich', label:'Erfolgreich', color:'#16a34a', bg:'rgba(22,163,74,0.1)', text:'#15803d' },
      { id:'nicht_erfolgreich', label:'Nicht erfolgreich', color:'#9ca3af', bg:'rgba(156,163,175,0.1)', text:'#6b7280' },
    ]
  },
  { id: 'darsteller', label: 'Darsteller', icon: '🎬', table: 'crm_darsteller',
    statuses: [
      { id:'neu', label:'Neu', color:'#6366f1', bg:'rgba(99,102,241,0.1)', text:'#4338ca' },
      { id:'qualifiziert', label:'Qualifiziert', color:'#f59e0b', bg:'rgba(245,158,11,0.1)', text:'#b45309' },
      { id:'warteliste', label:'Warteliste', color:'#3b82f6', bg:'rgba(59,130,246,0.1)', text:'#1d4ed8' },
      { id:'erfolgreich', label:'Erfolgreich', color:'#16a34a', bg:'rgba(22,163,74,0.1)', text:'#15803d' },
      { id:'abgelehnt', label:'Abgelehnt', color:'#ef4444', bg:'rgba(239,68,68,0.1)', text:'#dc2626' },
    ]
  },
]

function ini(n='') { return (n).split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?' }

export default function CRM() {
  const [cats, setCats] = useState(DEFAULT_CATS)
  const [activeCat, setActiveCat] = useState('leads')
  const [data, setData] = useState({})
  const [tasks, setTasks] = useState([])
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const [loading, setLoading] = useState(true)

  const cat = cats.find(c => c.id === activeCat)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const results = await Promise.all([
      supabase.from('crm_leads').select('*').order('created_at', { ascending: false }),
      supabase.from('crm_darsteller').select('*').order('created_at', { ascending: false }),
      supabase.from('crm_tasks').select('*').eq('erledigt', false).order('faellig_am'),
    ])
    setData({ leads: results[0].data || [], darsteller: results[1].data || [] })
    setTasks(results[2].data || [])
    setLoading(false)
  }

  async function changeStatus(id, status) {
    await supabase.from(cat.table).update({ status }).eq('id', id)
    fetchAll()
    if (selected?.id === id) setSelected(p => ({ ...p, status }))
  }

  const items = data[activeCat] || []

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Category tabs + add */}
      <div className="flex items-center gap-2 flex-wrap">
        {cats.map(c => (
          <button key={c.id} onClick={() => setActiveCat(c.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${activeCat === c.id ? 'bg-[#ff6b01]/8 border-[#ff6b01]/30 text-[#ff6b01]' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            {c.icon} {c.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeCat === c.id ? 'bg-[#ff6b01]/12 text-[#ff6b01]' : 'bg-gray-100 text-gray-400'}`}>
              {(data[c.id] || []).length}
            </span>
          </button>
        ))}
        <button onClick={() => setShowAddCat(true)}
          className="w-7 h-7 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-[#ff6b01] hover:text-[#ff6b01] transition-all text-lg">
          +
        </button>
        <button onClick={() => setShowAdd(true)} className="ml-auto btn-primary text-xs py-1.5 px-3">+ Neu</button>
      </div>

      {/* Kanban */}
      <div className="kanban-scroll">
        {cat?.statuses.map(st => {
          const cols = items.filter(i => i.status === st.id)
          return (
            <div key={st.id} className="w-44 md:w-48 flex-shrink-0">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
                  <span className="text-xs font-semibold text-gray-500">{st.label}</span>
                </div>
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{cols.length}</span>
              </div>
              <div className="space-y-2 min-h-8">
                {cols.map(item => {
                  const itemTasks = tasks.filter(t => t[activeCat === 'leads' ? 'lead_id' : 'darsteller_id'] === item.id)
                  const hasOverdue = itemTasks.some(t => t.faellig_am && new Date(t.faellig_am) < new Date())
                  return (
                    <div key={item.id} onClick={() => setSelected(item)}
                      className={`bg-white border rounded-xl p-3 cursor-pointer hover:shadow-sm hover:-translate-y-0.5 transition-all ${selected?.id === item.id ? 'border-[#ff6b01] shadow-sm' : 'border-gray-100'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: st.bg, color: st.text }}>{ini(item.name)}</div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
                          {item.firma && <p className="text-[10px] text-gray-400 truncate">{item.firma}</p>}
                        </div>
                      </div>
                      {item.telefon && <p className="text-[10px] text-gray-400 mb-1">📞 {item.telefon}</p>}
                      {itemTasks.length > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${hasOverdue ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                          {hasOverdue ? '⚠' : '◷'} {itemTasks.length} Task{itemTasks.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  )
                })}
                <button className="w-full border border-dashed border-gray-200 rounded-xl py-2 text-xs text-gray-400 hover:border-[#ff6b01] hover:text-[#ff6b01] transition-all">
                  + Hinzufügen
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Detail Panel */}
      {selected && (
        <CRMDetail item={selected} cat={cat} tasks={tasks.filter(t => t[activeCat === 'leads' ? 'lead_id' : 'darsteller_id'] === selected.id)}
          onClose={() => setSelected(null)}
          onStatusChange={s => changeStatus(selected.id, s)}
          onRefresh={fetchAll}
          isLead={activeCat === 'leads'}
        />
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-gray-100 p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Neuer {cat?.label.slice(0, -1) || 'Eintrag'}</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <AddForm cat={cat} onSave={async data => {
              await supabase.from(cat.table).insert(data)
              setShowAdd(false); fetchAll()
            }} onClose={() => setShowAdd(false)} isLead={activeCat === 'leads'} />
          </div>
        </div>
      )}

      {/* Add Category Modal */}
      {showAddCat && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4" onClick={() => setShowAddCat(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-gray-100 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Neue Kategorie</h3>
              <button onClick={() => setShowAddCat(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <AddCatForm onSave={newCat => { setCats(prev => [...prev, newCat]); setActiveCat(newCat.id); setShowAddCat(false) }} onClose={() => setShowAddCat(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

function AddForm({ isLead, onSave, onClose }) {
  const [form, setForm] = useState({ name: '', firma: '', email: '', telefon: '', website: '', quelle: '', alter_jahre: '', erfahrung: '', instagram: '' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-3">
      <div><label className="label">Name *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Vor- und Nachname" /></div>
      {isLead && <div><label className="label">Firma</label><input className="input" value={form.firma} onChange={e => set('firma', e.target.value)} placeholder="Firma GmbH" /></div>}
      <div><label className="label">E-Mail</label><input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
      <div><label className="label">Telefon</label><input className="input" value={form.telefon} onChange={e => set('telefon', e.target.value)} placeholder="+49..." /></div>
      {isLead && <>
        <div><label className="label">Website</label><input className="input" value={form.website} onChange={e => set('website', e.target.value)} /></div>
        <div><label className="label">Quelle</label><input className="input" value={form.quelle} onChange={e => set('quelle', e.target.value)} placeholder="Instagram, Website, Empfehlung..." /></div>
      </>}
      {!isLead && <>
        <div><label className="label">Alter</label><input className="input" type="number" value={form.alter_jahre} onChange={e => set('alter_jahre', e.target.value)} /></div>
        <div><label className="label">Instagram</label><input className="input" value={form.instagram} onChange={e => set('instagram', e.target.value)} /></div>
      </>}
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => { if (form.name) onSave(form) }} className="btn-primary flex-1">Speichern →</button>
      </div>
    </div>
  )
}

function AddCatForm({ onSave, onClose }) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('⌁')
  const [statuses, setStatuses] = useState('Neu, In Bearbeitung, Abgeschlossen')
  return (
    <div className="space-y-3">
      <div><label className="label">Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Funnels, Partnerschaften..." /></div>
      <div><label className="label">Icon (Emoji)</label><input className="input" value={icon} onChange={e => setIcon(e.target.value)} /></div>
      <div><label className="label">Status-Spalten (kommagetrennt)</label><input className="input" value={statuses} onChange={e => setStatuses(e.target.value)} /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => {
          if (!name) return
          const id = name.toLowerCase().replace(/\s/g, '_')
          const sts = statuses.split(',').map((s, i) => {
            const colors = ['#6366f1','#f59e0b','#3b82f6','#8b5cf6','#16a34a','#ef4444']
            const bgs = ['rgba(99,102,241,0.1)','rgba(245,158,11,0.1)','rgba(59,130,246,0.1)','rgba(139,92,246,0.1)','rgba(22,163,74,0.1)','rgba(239,68,68,0.1)']
            const texts = ['#4338ca','#b45309','#1d4ed8','#6d28d9','#15803d','#dc2626']
            return { id: s.trim().toLowerCase().replace(/\s/g, '_'), label: s.trim(), color: colors[i] || colors[0], bg: bgs[i] || bgs[0], text: texts[i] || texts[0] }
          })
          onSave({ id, label: name, icon, table: 'crm_leads', statuses: sts })
        }} className="btn-primary flex-1">Anlegen →</button>
      </div>
    </div>
  )
}

function CRMDetail({ item, cat, tasks, isLead, onClose, onStatusChange, onRefresh }) {
  const [tab, setTab] = useState('info')
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const [newTask, setNewTask] = useState({ titel: '', faellig_am: '' })
  const [showTaskForm, setShowTaskForm] = useState(false)
  const fk = isLead ? 'lead_id' : 'darsteller_id'

  useEffect(() => { fetchNotes() }, [item.id])

  async function fetchNotes() {
    const { data } = await supabase.from('crm_notizen').select('*').eq(fk, item.id).order('created_at', { ascending: false })
    if (data) setNotes(data)
  }

  async function addNote() {
    if (!noteText.trim()) return
    await supabase.from('crm_notizen').insert({ [fk]: item.id, text: noteText.trim() })
    setNoteText(''); fetchNotes()
  }

  async function addTask() {
    if (!newTask.titel.trim()) return
    await supabase.from('crm_tasks').insert({ [fk]: item.id, titel: newTask.titel, faellig_am: newTask.faellig_am || null })
    setNewTask({ titel: '', faellig_am: '' }); setShowTaskForm(false); onRefresh()
  }

  async function completeTask(id) {
    await supabase.from('crm_tasks').update({ erledigt: true }).eq('id', id); onRefresh()
  }

  function quickFollowUp(days) {
    const d = new Date(); d.setDate(d.getDate() + days)
    setNewTask({ titel: `In ${days} Tagen kontaktieren`, faellig_am: d.toISOString().slice(0, 16) })
    setShowTaskForm(true); setTab('tasks')
  }

  const openTasks = tasks.filter(t => !t.erledigt)

  return (
    <div className="fixed inset-0 bg-black/10 z-40 flex" onClick={onClose}>
      <div className="ml-auto bg-white w-full max-w-md h-full flex flex-col shadow-2xl border-l border-gray-100" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between flex-shrink-0">
          <div>
            <p className="font-bold text-gray-900">{item.name}</p>
            {item.firma && <p className="text-xs text-gray-400">{item.firma}</p>}
            <div className="flex gap-2 mt-2 flex-wrap">
              {item.telefon && <a href={`tel:${item.telefon}`} onClick={e => e.stopPropagation()} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-all">📞 Anrufen</a>}
              {item.email && <a href={`mailto:${item.email}`} onClick={e => e.stopPropagation()} className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-all">✉️ E-Mail</a>}
              {[3,7,14].map(d => <button key={d} onClick={() => quickFollowUp(d)} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-lg">+{d}T</button>)}
            </div>
          </div>
          <button onClick={onClose} className="w-6 h-6 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500 text-sm ml-2">×</button>
        </div>

        <div className="px-4 py-2 border-b border-gray-100 flex gap-1.5 flex-wrap flex-shrink-0">
          {cat?.statuses.map(s => (
            <button key={s.id} onClick={() => onStatusChange(s.id)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full transition-all border ${item.status === s.id ? 'border-current shadow-sm' : 'border-transparent opacity-50 hover:opacity-80'}`}
              style={{ background: s.bg, color: s.text, borderColor: item.status === s.id ? s.color : 'transparent' }}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex border-b border-gray-100 flex-shrink-0">
          {[['info','Info'],['notizen',`Notizen (${notes.length})`],['tasks',`Tasks (${openTasks.length})`]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 py-2.5 text-xs font-medium transition-all border-b-2 ${tab === id ? 'text-[#ff6b01] border-[#ff6b01]' : 'text-gray-400 border-transparent'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === 'info' && [
            ['E-Mail', item.email, `mailto:${item.email}`],
            ['Telefon', item.telefon, `tel:${item.telefon}`],
            ['Website', item.website, `https://${item.website}`],
            ...(isLead ? [['Quelle', item.quelle], ['UTM Source', item.utm_source]] : [['Alter', item.alter_jahre ? `${item.alter_jahre} Jahre` : null], ['Instagram', item.instagram]]),
            ['Erstellt', item.created_at ? new Date(item.created_at).toLocaleDateString('de-DE') : null],
          ].filter(f => f[1]).map(([l, v, href]) => (
            <div key={l} className="flex items-center gap-3 py-2 border-b border-gray-50">
              <span className="text-xs text-gray-400 w-20 flex-shrink-0">{l}</span>
              {href ? <a href={href} className="text-xs text-[#ff6b01] hover:underline truncate">{v}</a> : <span className="text-xs text-gray-700">{v}</span>}
            </div>
          ))}

          {tab === 'notizen' && (
            <>
              <div className="flex gap-2">
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Notiz hinzufügen..." rows={3}
                  className="flex-1 text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-[#ff6b01] resize-none" />
                <button onClick={addNote} className="btn-primary self-end px-3 text-sm">+</button>
              </div>
              {notes.map(n => (
                <div key={n.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-1">{new Date(n.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  <p className="text-xs text-gray-700 leading-relaxed">{n.text}</p>
                </div>
              ))}
              {notes.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Noch keine Notizen</p>}
            </>
          )}

          {tab === 'tasks' && (
            <>
              <div className="flex gap-2 flex-wrap mb-2">
                {[3,7,14,30].map(d => <button key={d} onClick={() => quickFollowUp(d)} className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">In {d} Tagen</button>)}
                <button onClick={() => setShowTaskForm(true)} className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-all">+ Eigener Task</button>
              </div>
              {showTaskForm && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                  <input value={newTask.titel} onChange={e => setNewTask(p => ({ ...p, titel: e.target.value }))} placeholder="Task-Titel..." className="input text-xs" />
                  <input type="datetime-local" value={newTask.faellig_am} onChange={e => setNewTask(p => ({ ...p, faellig_am: e.target.value }))} className="input text-xs" />
                  <div className="flex gap-2">
                    <button onClick={addTask} className="btn-primary flex-1 text-xs">Speichern</button>
                    <button onClick={() => setShowTaskForm(false)} className="btn-secondary text-xs px-3">×</button>
                  </div>
                </div>
              )}
              {openTasks.map(t => {
                const overdue = t.faellig_am && new Date(t.faellig_am) < new Date()
                return (
                  <div key={t.id} className={`flex items-start gap-3 p-3 rounded-xl border ${overdue ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
                    <button onClick={() => completeTask(t.id)} className="w-4 h-4 rounded-full border-2 border-gray-300 hover:border-[#ff6b01] flex-shrink-0 mt-0.5 transition-colors" />
                    <div>
                      <p className="text-xs font-medium text-gray-800">{t.titel}</p>
                      {t.faellig_am && <p className={`text-xs mt-0.5 ${overdue ? 'text-red-500' : 'text-gray-400'}`}>{overdue ? '⚠ Überfällig · ' : ''}{new Date(t.faellig_am).toLocaleDateString('de-DE')}</p>}
                    </div>
                  </div>
                )
              })}
              {openTasks.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Keine Tasks</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

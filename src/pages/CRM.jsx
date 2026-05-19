import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Fallback Defaults (falls Supabase Tabelle leer/Fehler – sollte normalerweise nie greifen)
const FALLBACK_CATS = [
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

// Welche Supabase-Tabelle für welche Kategorie
function getTable(catId) {
  if (catId === 'leads') return 'crm_leads'
  if (catId === 'darsteller') return 'crm_darsteller'
  return 'crm_custom_entries'
}

function ini(n='') { return (n).split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?' }

export default function CRM() {
  const [cats, setCats] = useState(FALLBACK_CATS)
  const [activeCat, setActiveCat] = useState('leads')
  const [data, setData] = useState({})
  const [tasks, setTasks] = useState([])
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const [showQuickAdd, setShowQuickAdd] = useState(null) // { catId, statusId }
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState(null)

  const cat = cats.find(c => c.id === activeCat)
  const isLead = activeCat === 'leads'
  const isDarsteller = activeCat === 'darsteller'
  const isCustom = !isLead && !isDarsteller

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    try {
      // Kategorien aus Supabase laden
      const catRes = await supabase.from('crm_categories').select('*').order('position', { ascending: true })
      let loadedCats = FALLBACK_CATS
      if (catRes.data && catRes.data.length > 0) {
        loadedCats = catRes.data.map(c => ({
          id: c.id,
          label: c.label,
          icon: c.icon || '◉',
          table: getTable(c.id),
          statuses: Array.isArray(c.statuses) ? c.statuses : [],
          is_default: c.is_default,
        }))
      }
      setCats(loadedCats)

      // Daten laden: Leads, Darsteller, Tasks, Custom-Entries
      const [leadRes, darstRes, taskRes, customRes] = await Promise.all([
        supabase.from('crm_leads').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_darsteller').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_tasks').select('*').eq('erledigt', false).order('faellig_am'),
        supabase.from('crm_custom_entries').select('*').order('created_at', { ascending: false }),
      ])

      // Daten pro Kategorie zuordnen
      const newData = {
        leads: leadRes.data || [],
        darsteller: darstRes.data || [],
      }
      // Custom-Entries nach category_id gruppieren
      const customByCat = {}
      ;(customRes.data || []).forEach(e => {
        if (!customByCat[e.category_id]) customByCat[e.category_id] = []
        customByCat[e.category_id].push(e)
      })
      loadedCats.forEach(c => {
        if (c.id !== 'leads' && c.id !== 'darsteller') {
          newData[c.id] = customByCat[c.id] || []
        }
      })

      setData(newData)
      setTasks(taskRes.data || [])

      // Selected-Item mit frischen Daten aktualisieren (falls offen)
      if (selected) {
        const fresh = (newData[activeCat] || []).find(x => x.id === selected.id)
        if (fresh) setSelected(fresh)
      }
    } catch (e) {
      console.error('fetchAll error', e)
    }
    setLoading(false)
  }

  async function changeStatus(id, status) {
    const table = getTable(activeCat)
    const { error } = await supabase.from(table).update({ status }).eq('id', id)
    if (error) {
      alert('Status konnte nicht geändert werden:\n' + error.message)
      return
    }
    if (selected?.id === id) setSelected(p => ({ ...p, status }))
    fetchAll()
  }

  // Drag & Drop Handler
  function onDragStart(e, id) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  async function onDrop(e, newStatus) {
    e.preventDefault()
    if (!dragId) return
    await changeStatus(dragId, newStatus)
    setDragId(null)
  }

  // Kategorie löschen (außer Defaults)
  async function deleteCategory(catId) {
    const target = cats.find(c => c.id === catId)
    if (!target || target.is_default) {
      alert('Standard-Kategorien (Leads, Darsteller) können nicht gelöscht werden.')
      return
    }
    const count = (data[catId] || []).length
    if (!confirm(`Kategorie "${target.label}" mit ${count} Einträgen wirklich löschen?`)) return
    const r1 = await supabase.from('crm_custom_entries').delete().eq('category_id', catId)
    if (r1.error) { alert('Einträge konnten nicht gelöscht werden: ' + r1.error.message); return }
    const r2 = await supabase.from('crm_categories').delete().eq('id', catId)
    if (r2.error) { alert('Kategorie konnte nicht gelöscht werden: ' + r2.error.message); return }
    setActiveCat('leads')
    fetchAll()
  }

  const items = data[activeCat] || []

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Category tabs + add */}
      <div className="flex items-center gap-2 flex-wrap">
        {cats.map(c => (
          <div key={c.id} className="relative group">
            <button onClick={() => setActiveCat(c.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${activeCat === c.id ? 'bg-[#ff6b01]/8 border-[#ff6b01]/30 text-[#ff6b01]' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              {c.icon} {c.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeCat === c.id ? 'bg-[#ff6b01]/12 text-[#ff6b01]' : 'bg-gray-100 text-gray-400'}`}>
                {(data[c.id] || []).length}
              </span>
            </button>
            {!c.is_default && activeCat === c.id && (
              <button onClick={(e) => { e.stopPropagation(); deleteCategory(c.id) }}
                title="Kategorie löschen"
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md">
                ×
              </button>
            )}
          </div>
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
            <div key={st.id} className="w-44 md:w-48 flex-shrink-0"
              onDragOver={onDragOver}
              onDrop={e => onDrop(e, st.id)}>
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
                  <span className="text-xs font-semibold text-gray-500">{st.label}</span>
                </div>
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{cols.length}</span>
              </div>
              <div className="space-y-2 min-h-16">
                {cols.map(item => {
                  const itemTasks = tasks.filter(t => t[isLead ? 'lead_id' : isCustom ? 'custom_entry_id' : 'darsteller_id'] === item.id)
                  const hasOverdue = itemTasks.some(t => t.faellig_am && new Date(t.faellig_am) < new Date())
                  return (
                    <div key={item.id}
                      draggable
                      onDragStart={e => onDragStart(e, item.id)}
                      onClick={() => setSelected(item)}
                      className={`bg-white border rounded-xl p-3 cursor-grab active:cursor-grabbing hover:shadow-sm hover:-translate-y-0.5 transition-all ${selected?.id === item.id ? 'border-[#ff6b01] shadow-sm' : 'border-gray-100'} ${dragId === item.id ? 'opacity-50' : ''}`}>
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
                <button
                  onClick={() => setShowQuickAdd({ catId: activeCat, statusId: st.id })}
                  className="w-full border border-dashed border-gray-200 rounded-xl py-2 text-xs text-gray-400 hover:border-[#ff6b01] hover:text-[#ff6b01] transition-all">
                  + Hinzufügen
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Detail Panel */}
      {selected && (
        <CRMDetail item={selected} cat={cat} tasks={tasks.filter(t => t[isLead ? 'lead_id' : isCustom ? 'custom_entry_id' : 'darsteller_id'] === selected.id)}
          onClose={() => setSelected(null)}
          onStatusChange={s => changeStatus(selected.id, s)}
          onRefresh={fetchAll}
          onDelete={async () => {
            if (!confirm(`"${selected.name}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return
            const table = getTable(activeCat)
            const { error } = await supabase.from(table).delete().eq('id', selected.id)
            if (error) { alert('Eintrag konnte nicht gelöscht werden: ' + error.message); return }
            setSelected(null)
            fetchAll()
          }}
          isLead={isLead}
          isCustom={isCustom}
        />
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/20 z-[70] flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-gray-100 p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Neuer Eintrag in {cat?.label}</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <AddForm cat={cat} catId={activeCat} isLead={isLead} isCustom={isCustom}
              onSave={async data => {
                const cleaned = {}
                for (const [k, v] of Object.entries(data)) {
                  if (v === '' || v === undefined) cleaned[k] = null
                  else if (k === 'alter_jahre') {
                    const n = parseInt(v, 10)
                    cleaned[k] = isNaN(n) ? null : n
                  } else cleaned[k] = v
                }
                const table = getTable(activeCat)
                const defaultStatus = cat?.statuses?.[0]?.id || 'neu'
                const insertData = { ...cleaned, status: defaultStatus }
                if (isCustom) insertData.category_id = activeCat
                const { error } = await supabase.from(table).insert(insertData)
                if (error) {
                  alert('Fehler beim Speichern: ' + error.message)
                  return
                }
                setShowAdd(false); fetchAll()
              }} onClose={() => setShowAdd(false)} />
          </div>
        </div>
      )}

      {/* Quick Add (Klick auf "+ Hinzufügen" unter Spalte) */}
      {showQuickAdd && (
        <div className="fixed inset-0 bg-black/20 z-[70] flex items-center justify-center p-4" onClick={() => setShowQuickAdd(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-gray-100 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Schnell hinzufügen</h3>
              <button onClick={() => setShowQuickAdd(null)} className="text-gray-400 text-xl">×</button>
            </div>
            <QuickAddForm
              status={showQuickAdd.statusId}
              onSave={async (name) => {
                if (!name.trim()) return
                const table = getTable(activeCat)
                const insertData = { name: name.trim(), status: showQuickAdd.statusId }
                if (isCustom) insertData.category_id = activeCat
                const { error } = await supabase.from(table).insert(insertData)
                if (error) { alert('Fehler: ' + error.message); return }
                setShowQuickAdd(null); fetchAll()
              }}
              onClose={() => setShowQuickAdd(null)}
            />
          </div>
        </div>
      )}

      {/* Add Category Modal */}
      {showAddCat && (
        <div className="fixed inset-0 bg-black/20 z-[70] flex items-center justify-center p-4" onClick={() => setShowAddCat(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-gray-100 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Neue Kategorie</h3>
              <button onClick={() => setShowAddCat(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <AddCatForm
              existingIds={cats.map(c => c.id)}
              position={cats.length}
              onSave={async newCat => {
                const { error } = await supabase.from('crm_categories').insert(newCat)
                if (error) { alert('Fehler beim Anlegen: ' + error.message); return }
                setActiveCat(newCat.id)
                setShowAddCat(false)
                fetchAll()
              }}
              onClose={() => setShowAddCat(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function QuickAddForm({ status, onSave, onClose }) {
  const [name, setName] = useState('')
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Wird mit Status <strong>{status}</strong> angelegt. Mehr Details kannst du danach im Detail-Panel ergänzen.</p>
      <div>
        <label className="label">Name *</label>
        <input
          className="input"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSave(name) }}
          autoFocus
          placeholder="Vor- und Nachname"
        />
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => onSave(name)} className="btn-primary flex-1">Anlegen →</button>
      </div>
    </div>
  )
}

function AddForm({ isLead, isCustom, onSave, onClose }) {
  const [form, setForm] = useState({ name: '', firma: '', email: '', telefon: '', website: '', quelle: '', alter_jahre: '', erfahrung: '', instagram: '', notizen: '' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function handleSave() {
    if (!form.name) return
    let payload
    if (isLead) {
      payload = { name: form.name, firma: form.firma, email: form.email, telefon: form.telefon, website: form.website, quelle: form.quelle }
    } else if (isCustom) {
      payload = { name: form.name, firma: form.firma, email: form.email, telefon: form.telefon }
    } else {
      payload = { name: form.name, email: form.email, telefon: form.telefon, alter_jahre: form.alter_jahre, instagram: form.instagram, erfahrung: form.erfahrung }
    }
    onSave(payload)
  }

  return (
    <div className="space-y-3">
      <div><label className="label">Name *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Vor- und Nachname" autoFocus /></div>
      {(isLead || isCustom) && <div><label className="label">Firma</label><input className="input" value={form.firma} onChange={e => set('firma', e.target.value)} placeholder="Firma GmbH" /></div>}
      <div><label className="label">E-Mail</label><input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
      <div><label className="label">Telefon</label><input className="input" value={form.telefon} onChange={e => set('telefon', e.target.value)} placeholder="+49..." /></div>
      {isLead && <>
        <div><label className="label">Website</label><input className="input" value={form.website} onChange={e => set('website', e.target.value)} /></div>
        <div><label className="label">Quelle</label><input className="input" value={form.quelle} onChange={e => set('quelle', e.target.value)} placeholder="Instagram, Website, Empfehlung..." /></div>
      </>}
      {!isLead && !isCustom && <>
        <div><label className="label">Alter</label><input className="input" type="number" value={form.alter_jahre} onChange={e => set('alter_jahre', e.target.value)} /></div>
        <div><label className="label">Instagram</label><input className="input" value={form.instagram} onChange={e => set('instagram', e.target.value)} /></div>
      </>}
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={handleSave} className="btn-primary flex-1">Speichern →</button>
      </div>
    </div>
  )
}

function AddCatForm({ existingIds, position, onSave, onClose }) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('⌁')
  const [statuses, setStatuses] = useState('Neu, In Bearbeitung, Abgeschlossen')

  function generateId(label) {
    let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (!base) base = 'kategorie'
    let id = base
    let i = 2
    while (existingIds.includes(id)) {
      id = `${base}_${i}`
      i++
    }
    return id
  }

  return (
    <div className="space-y-3">
      <div><label className="label">Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Partner, Empfehlungen..." autoFocus /></div>
      <div><label className="label">Icon (Emoji)</label><input className="input" value={icon} onChange={e => setIcon(e.target.value)} /></div>
      <div><label className="label">Status-Spalten (kommagetrennt)</label><input className="input" value={statuses} onChange={e => setStatuses(e.target.value)} /></div>
      <p className="text-xs text-gray-400">Du kannst die Spalten später nicht mehr ändern, plane sie sorgfältig.</p>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => {
          if (!name) return
          const id = generateId(name)
          const colors = ['#6366f1','#f59e0b','#3b82f6','#8b5cf6','#16a34a','#ef4444','#10b981','#ec4899']
          const bgs = ['rgba(99,102,241,0.1)','rgba(245,158,11,0.1)','rgba(59,130,246,0.1)','rgba(139,92,246,0.1)','rgba(22,163,74,0.1)','rgba(239,68,68,0.1)','rgba(16,185,129,0.1)','rgba(236,72,153,0.1)']
          const texts = ['#4338ca','#b45309','#1d4ed8','#6d28d9','#15803d','#dc2626','#047857','#be185d']
          const sts = statuses.split(',').filter(s => s.trim()).map((s, i) => ({
            id: s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `status_${i+1}`,
            label: s.trim(),
            color: colors[i] || colors[0],
            bg: bgs[i] || bgs[0],
            text: texts[i] || texts[0],
          }))
          // Erstes Status muss "neu" sein (für Default-Status), wenn nicht vorhanden: ersten umbenennen
          if (sts.length > 0 && sts[0].id !== 'neu') {
            // Kein Problem - der DB-default ist 'neu', aber Items werden mit status: 'neu' eingefügt
            // Wir setzen einfach den ersten Status als Default für Insert
          }
          onSave({ id, label: name, icon, position, statuses: sts, is_default: false })
        }} className="btn-primary flex-1">Anlegen →</button>
      </div>
    </div>
  )
}

function CRMDetail({ item, cat, tasks, isLead, isCustom, onClose, onStatusChange, onRefresh, onDelete }) {
  const [tab, setTab] = useState('info')
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const [newTask, setNewTask] = useState({ titel: '', faellig_am: '' })
  const [showTaskForm, setShowTaskForm] = useState(false)
  // Foreign Key: je nach Item-Typ andere Spalte
  const fk = isLead ? 'lead_id' : isCustom ? 'custom_entry_id' : 'darsteller_id'

  useEffect(() => { fetchNotes() }, [item.id])

  async function fetchNotes() {
    const { data, error } = await supabase.from('crm_notizen').select('*').eq(fk, item.id).order('created_at', { ascending: false })
    if (error) {
      console.error('fetchNotes error:', error)
      return
    }
    if (data) setNotes(data)
  }

  async function addNote() {
    if (!noteText.trim()) return
    const { error } = await supabase.from('crm_notizen').insert({ [fk]: item.id, text: noteText.trim() })
    if (error) {
      console.error('addNote error:', error)
      alert('Notiz konnte nicht gespeichert werden:\n\n' + error.message + '\n\n(FK: ' + fk + ', ID: ' + item.id + ')')
      return
    }
    setNoteText(''); fetchNotes()
  }

  async function addTask() {
    if (!newTask.titel.trim()) return
    const { error } = await supabase.from('crm_tasks').insert({ [fk]: item.id, titel: newTask.titel, faellig_am: newTask.faellig_am || null })
    if (error) {
      console.error('addTask error:', error)
      alert('Task konnte nicht gespeichert werden:\n\n' + error.message + '\n\n(FK: ' + fk + ', ID: ' + item.id + ')')
      return
    }
    setNewTask({ titel: '', faellig_am: '' }); setShowTaskForm(false); onRefresh()
  }

  async function completeTask(id) {
    const { error } = await supabase.from('crm_tasks').update({ erledigt: true }).eq('id', id)
    if (error) { alert('Task konnte nicht als erledigt markiert werden: ' + error.message); return }
    onRefresh()
  }

  function quickFollowUp(days) {
    const d = new Date(); d.setDate(d.getDate() + days)
    setNewTask({ titel: `In ${days} Tagen kontaktieren`, faellig_am: d.toISOString().slice(0, 16) })
    setShowTaskForm(true); setTab('tasks')
  }

  const openTasks = tasks.filter(t => !t.erledigt)

  return (
    <div className="fixed inset-0 bg-black/10 z-[60] flex" onClick={onClose}>
      <div className="crm-detail-panel ml-auto bg-white w-full max-w-md h-full flex flex-col shadow-2xl border-l border-gray-100" onClick={e => e.stopPropagation()}>
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
              className={`flex-1 py-3 text-xs font-medium transition-all border-b-2 ${tab === id ? 'text-[#ff6b01] border-[#ff6b01]' : 'text-gray-400 border-transparent'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === 'info' && <>
            {(isLead
              ? [
                  ['name', 'Name', item.name, 'text'],
                  ['firma', 'Firma', item.firma, 'text'],
                  ['email', 'E-Mail', item.email, 'email'],
                  ['telefon', 'Telefon', item.telefon, 'tel'],
                  ['website', 'Website', item.website, 'text'],
                  ['Paket', 'Paket', item.Paket, 'text'],
                  ['quelle', 'Quelle', item.quelle, 'text'],
                  ['utm_source', 'UTM Source', item.utm_source, 'text'],
                  ['utm_medium', 'UTM Medium', item.utm_medium, 'text'],
                ['empfehler_name', 'Empfehler', item.empfehler_name, 'text'], 
                ['empfehler_email', 'Empfehler-Mail', item.empfehler_email, 'email'],
                ]
              : isCustom
              ? [
                  ['name', 'Name', item.name, 'text'],
                  ['firma', 'Firma', item.firma, 'text'],
                  ['email', 'E-Mail', item.email, 'email'],
                  ['telefon', 'Telefon', item.telefon, 'tel'],
                ]
              : [
                  ['name', 'Name', item.name, 'text'],
                  ['email', 'E-Mail', item.email, 'email'],
                  ['telefon', 'Telefon', item.telefon, 'tel'],
                  ['alter_jahre', 'Alter', item.alter_jahre, 'number'],
                  ['instagram', 'Instagram', item.instagram, 'text'],
                  ['erfahrung', 'Erfahrung', item.erfahrung, 'text'],
                ]
            ).map(([key, label, val, type]) => (
              <EditableField key={key} fieldKey={key} label={label} value={val} type={type} item={item} cat={cat} onSaved={onRefresh} />
            ))}
            {item.created_at && (
              <div className="flex items-center gap-3 py-2 border-b border-gray-50">
                <span className="text-xs text-gray-400 w-20 flex-shrink-0">Erstellt</span>
                <span className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
            {isLead && (
              <div className="pt-3 mt-2">
                <p className="text-xs text-gray-400 mb-1.5">Nachricht</p>
                <EditableTextarea fieldKey="Nachricht" value={item.Nachricht} item={item} cat={cat} onSaved={onRefresh} />
              </div>
            )}
            <div className="pt-6 mt-4 border-t border-gray-100">
              <button onClick={onDelete} className="w-full text-xs text-red-500 hover:text-white hover:bg-red-500 border border-red-200 hover:border-red-500 rounded-xl py-2.5 transition-all font-medium">
                🗑 Eintrag löschen
              </button>
            </div>
          </>}

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

function EditableField({ fieldKey, label, value, type, item, cat, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || '')
  const [saving, setSaving] = useState(false)

  // Sync local state with prop changes (z.B. nach fetchAll)
  useEffect(() => {
    if (!editing) setVal(value || '')
  }, [value, editing])

  async function save() {
    if (val === (value || '')) { setEditing(false); return }
    setSaving(true)
    let saveVal = val.trim() === '' ? null : val
    if (type === 'number' && saveVal !== null) saveVal = parseInt(saveVal, 10) || null
    const { error } = await supabase.from(cat.table).update({ [fieldKey]: saveVal }).eq('id', item.id)
    setSaving(false)
    if (error) {
      console.error('EditableField save error:', error)
      alert(`Feld "${label}" konnte nicht gespeichert werden:\n\n${error.message}\n\n(Tabelle: ${cat.table}, Feld: ${fieldKey})`)
      setVal(value || '')  // Reset auf alten Wert
      return
    }
    setEditing(false)
    onSaved()
  }

  const displayVal = type === 'number' && value ? `${value} Jahre` : value

  if (editing) {
    return (
      <div className="flex items-center gap-3 py-2 border-b border-gray-50">
        <span className="text-xs text-gray-400 w-20 flex-shrink-0">{label}</span>
        <input
          type={type}
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setVal(value || ''); setEditing(false) } }}
          autoFocus
          disabled={saving}
          className="flex-1 text-xs bg-[#ff6b01]/5 border border-[#ff6b01]/30 rounded-md px-2 py-1 focus:outline-none focus:border-[#ff6b01]"
        />
      </div>
    )
  }

  return (
    <div onClick={() => setEditing(true)} className="group flex items-center gap-3 py-2 border-b border-gray-50 cursor-pointer hover:bg-gray-50/50 -mx-2 px-2 rounded-md transition-colors">
      <span className="text-xs text-gray-400 w-20 flex-shrink-0">{label}</span>
      <span className={`text-xs flex-1 break-words ${value ? 'text-gray-700' : 'text-gray-300 italic'}`}>{displayVal || 'leer – klicken zum Bearbeiten'}</span>
      <span className="text-xs text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
    </div>
  )
}

function EditableTextarea({ fieldKey, value, item, cat, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setVal(value || '')
  }, [value, editing])

  async function save() {
    if (val === (value || '')) { setEditing(false); return }
    setSaving(true)
    const saveVal = val.trim() === '' ? null : val
    const { error } = await supabase.from(cat.table).update({ [fieldKey]: saveVal }).eq('id', item.id)
    setSaving(false)
    if (error) {
      console.error('EditableTextarea save error:', error)
      alert(`Feld "${fieldKey}" konnte nicht gespeichert werden:\n\n${error.message}\n\n(Tabelle: ${cat.table})`)
      setVal(value || '')
      return
    }
    setEditing(false)
    onSaved()
  }

  if (editing) {
    return (
      <textarea
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Escape') { setVal(value || ''); setEditing(false) } }}
        autoFocus
        disabled={saving}
        rows={5}
        placeholder="Nachricht eingeben..."
        className="w-full text-xs bg-[#ff6b01]/5 border border-[#ff6b01]/30 rounded-xl p-3 focus:outline-none focus:border-[#ff6b01] resize-none leading-relaxed"
      />
    )
  }

  return (
    <div onClick={() => setEditing(true)} className="group bg-gray-50 border border-gray-100 hover:border-[#ff6b01]/30 rounded-xl p-3 cursor-pointer transition-colors relative">
      {value ? (
        <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap break-words">{value}</p>
      ) : (
        <p className="text-xs text-gray-300 italic">Keine Nachricht – klicken zum Hinzufügen</p>
      )}
      <span className="absolute top-2 right-2 text-xs text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
    </div>
  )
}

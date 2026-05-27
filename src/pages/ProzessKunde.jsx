// ============================================================
// BREHL VISUALS - Prozess Kunde
// Kanban-Arbeitsboard: offene Betreuungs-Calls abhaken + verschieben.
// Spalten: Überfällig / Diesen Monat fällig / Erledigt
// ============================================================
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const CALL_META = {
  onboarding:     { label: 'Onboarding-Gespräch',       icon: '🚀', recurring: false },
  first_feedback: { label: 'First Feedback Gespräch',   icon: '💬', recurring: false },
  themencall:     { label: 'Monatlicher Themencall',    icon: '🎯', recurring: true },
  strategie:      { label: 'Feedback- & Wachstumscall', icon: '📈', recurring: true },
}

function todayStr() { return new Date().toISOString().slice(0, 10) }
function endOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}
function addDays(dateStr, days) {
  const d = new Date(dateStr); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

export default function ProzessKunde() {
  const [calls, setCalls] = useState([])
  const [kunden, setKunden] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null)   // { call } — Abhak-Popup
  const [busy, setBusy] = useState(false)
  const [dragId, setDragId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const { data: cats, error: catErr } = await supabase
        .from('crm_categories').select('id,label,statuses')
      if (catErr) throw catErr
      const kundenCat = (cats || []).find(
        c => (c.label || '').trim().toLowerCase() === 'kunden'
      )
      if (!kundenCat) { setErr('Kein Board namens "Kunden" gefunden.'); setLoading(false); return }

      const aktivStatusIds = (Array.isArray(kundenCat.statuses) ? kundenCat.statuses : [])
        .filter(s => (s.label || '').trim().toLowerCase() === 'aktiv')
        .map(s => s.id)

      const { data: entries, error: entErr } = await supabase
        .from('crm_custom_entries').select('id,name,firma,status')
        .eq('category_id', kundenCat.id)
      if (entErr) throw entErr
      const aktiveEntries = (entries || []).filter(e => aktivStatusIds.includes(e.status))
      const kMap = {}
      aktiveEntries.forEach(e => { kMap[e.id] = { name: e.name, firma: e.firma } })
      setKunden(kMap)

      const kundenIds = aktiveEntries.map(e => e.id)
      if (kundenIds.length === 0) { setCalls([]); setLoading(false); return }

      const { data: callsData, error: cErr } = await supabase
        .from('kunden_calls').select('*').in('kunde_id', kundenIds)
      if (cErr) throw cErr
      setCalls(callsData || [])
    } catch (e) {
      console.error('ProzessKunde load error:', e)
      setErr(e.message || 'Fehler beim Laden')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // --- Call abhaken (mit Datum + optionaler Notiz) ----------
  async function confirmDone(call, datum, notiz) {
    if (busy) return
    setBusy(true)
    const erledigtAm = datum || todayStr()
    try {
      const { data: updated, error } = await supabase.from('kunden_calls')
        .update({
          status: 'erledigt',
          erledigt_am: erledigtAm,
          notizen: notiz && notiz.trim() ? notiz.trim() : call.notizen,
        })
        .eq('id', call.id)
        .eq('status', 'offen')
        .select()
      if (error) throw error
      // Wiederkehrend → neuen offenen Slot +28 Tage ab Erledigt-Datum
      if (updated && updated.length > 0 && CALL_META[call.call_typ]?.recurring) {
        await supabase.from('kunden_calls').insert({
          kunde_id: call.kunde_id, call_typ: call.call_typ,
          status: 'offen', faellig_am: addDays(erledigtAm, 28),
        })
      }
      setModal(null)
      await load()
    } catch (e) {
      console.error('confirmDone error:', e)
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const heute = todayStr()
  const monatsEnde = endOfMonth()
  const offene = calls.filter(c => c.status === 'offen')
  const erledigte = calls.filter(c => c.status === 'erledigt')
    .sort((a, b) => (b.erledigt_am || '').localeCompare(a.erledigt_am || ''))

  const ueberfaellig = offene
    .filter(c => c.faellig_am && c.faellig_am < heute)
    .sort((a, b) => (a.faellig_am || '').localeCompare(b.faellig_am || ''))
  const diesenMonat = offene
    .filter(c => c.faellig_am && c.faellig_am >= heute && c.faellig_am <= monatsEnde)
    .sort((a, b) => (a.faellig_am || '').localeCompare(b.faellig_am || ''))

  const spalten = [
    { key: 'ueberfaellig', titel: 'Überfällig', dot: 'bg-red-500', cards: ueberfaellig, droppable: false },
    { key: 'monat',        titel: 'Diesen Monat fällig', dot: 'bg-[#ff6b01]', cards: diesenMonat, droppable: false },
    { key: 'erledigt',     titel: 'Erledigt', dot: 'bg-green-500', cards: erledigte, droppable: true },
  ]

  // Drag-Drop: Karte auf "Erledigt" gezogen → Abhak-Popup öffnen
  function onDrop(spalteKey) {
    if (spalteKey !== 'erledigt' || !dragId) { setDragId(null); return }
    const call = offene.find(c => c.id === dragId)
    setDragId(null)
    if (call) setModal({ call })
  }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Prozess Kunde</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Offene Betreuungs-Aufgaben abarbeiten — abhaken oder in „Erledigt" ziehen
        </p>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {spalten.map(sp => (
          <div key={sp.key}
            onDragOver={e => { if (sp.droppable) e.preventDefault() }}
            onDrop={() => onDrop(sp.key)}
            className={`bg-gray-50 rounded-2xl p-3 transition-colors ${
              sp.droppable && dragId ? 'ring-2 ring-green-300 ring-dashed' : ''}`}>
            <div className="flex items-center gap-2 px-1 mb-3">
              <span className={`w-2 h-2 rounded-full ${sp.dot}`} />
              <span className="text-sm font-bold text-gray-700">{sp.titel}</span>
              <span className="text-xs text-gray-400 ml-auto">{sp.cards.length}</span>
            </div>
            <div className="space-y-2 min-h-[60px]">
              {sp.cards.length === 0 && (
                <p className="text-xs text-gray-300 text-center py-6">
                  {sp.key === 'erledigt' ? 'Karte hierher ziehen' : 'Nichts hier'}
                </p>
              )}
              {sp.cards.map(call => {
                const k = kunden[call.kunde_id] || {}
                const meta = CALL_META[call.call_typ] || {}
                const isDone = call.status === 'erledigt'
                return (
                  <div key={call.id}
                    draggable={!isDone}
                    onDragStart={() => setDragId(call.id)}
                    onDragEnd={() => setDragId(null)}
                    className={`bg-white border border-gray-200 rounded-xl p-3 transition-all ${
                      isDone ? 'opacity-75' : 'hover:shadow-md cursor-grab active:cursor-grabbing'}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        isDone ? 'bg-green-100 text-green-600' : 'bg-[#ff6b01]/10 text-[#ff6b01]'}`}>
                        {initials(k.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-gray-800 truncate">{k.name || 'Unbekannt'}</div>
                        {k.firma && <div className="text-[10px] text-gray-400 truncate">{k.firma}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 pl-0.5 mb-1">
                      <span className="text-sm">{meta.icon}</span>
                      <span className="text-[11px] font-medium text-gray-600">{meta.label}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 pl-0.5">
                      {isDone ? `Erledigt ${fmtDate(call.erledigt_am)}` : `Fällig ${fmtDate(call.faellig_am)}`}
                    </div>
                    {isDone && call.notizen && (
                      <p className="text-[10px] text-gray-500 mt-1.5 bg-gray-50 rounded px-2 py-1 line-clamp-2">
                        {call.notizen}
                      </p>
                    )}
                    {!isDone && (
                      <button onClick={() => setModal({ call })}
                        className="mt-2 w-full bg-green-600 hover:bg-green-700 text-white text-[11px] font-semibold rounded-lg py-1.5 transition-colors">
                        ✓ Geführt
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Abhak-Popup */}
      {modal && (
        <DoneModal
          call={modal.call}
          kunde={kunden[modal.call.kunde_id] || {}}
          busy={busy}
          onConfirm={confirmDone}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// ============================================================
// Abhak-Popup mit Datum + Notiz
// ============================================================
function DoneModal({ call, kunde, busy, onConfirm, onClose }) {
  const meta = CALL_META[call.call_typ] || {}
  const [datum, setDatum] = useState(todayStr())
  const [notiz, setNotiz] = useState(call.notizen || '')

  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{meta.icon}</span>
          <h3 className="text-sm font-bold text-gray-900">{meta.label}</h3>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          {kunde.name}{kunde.firma ? ` · ${kunde.firma}` : ''}
        </p>

        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Wann wurde der Call geführt?
        </label>
        <input type="date" value={datum} max={todayStr()}
          onChange={e => setDatum(e.target.value)}
          className="input text-sm mb-4" />

        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Gesprächsnotiz
        </label>
        <textarea value={notiz} onChange={e => setNotiz(e.target.value)}
          placeholder="Was wurde besprochen? Wichtige Punkte, To-Dos, Stimmung …"
          rows={4} className="input text-sm resize-none mb-4" />

        <div className="flex gap-2">
          <button onClick={() => onConfirm(call, datum, notiz)} disabled={busy}
            className="btn-primary flex-1 disabled:opacity-50">
            {busy ? 'Speichert…' : '✓ Als geführt markieren'}
          </button>
          <button onClick={onClose} className="btn-secondary">Abbrechen</button>
        </div>
      </div>
    </div>
  )
}

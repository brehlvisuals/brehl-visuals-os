// ============================================================
// BREHL VISUALS - Prozess Kunde
// Kanban-Übersicht aller offenen Betreuungs-Aufgaben über alle Kunden.
// Spalten: Überfällig / Diesen Monat fällig / Alles erledigt
// ============================================================
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const CALL_META = {
  onboarding:     { label: 'Onboarding-Gespräch',       icon: '🚀' },
  first_feedback: { label: 'First Feedback Gespräch',   icon: '💬' },
  themencall:     { label: 'Monatlicher Themencall',    icon: '🎯' },
  strategie:      { label: 'Feedback- & Wachstumscall', icon: '📈' },
}

function todayStr() { return new Date().toISOString().slice(0, 10) }
function endOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
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
  const [kunden, setKunden] = useState({})   // id -> { name, firma }
  const [touchpoints, setTouchpoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      // 1. Kunden-Kategorie finden (Custom-Board "Kunden")
      const { data: cats, error: catErr } = await supabase
        .from('crm_categories').select('id,label')
      if (catErr) throw catErr
      const kundenCat = (cats || []).find(
        c => (c.label || '').trim().toLowerCase() === 'kunden'
      )
      if (!kundenCat) {
        setErr('Kein Board namens "Kunden" gefunden.')
        setLoading(false); return
      }

      // 2. Alle Kunden-Einträge
      const { data: entries, error: entErr } = await supabase
        .from('crm_custom_entries').select('id,name,firma')
        .eq('category_id', kundenCat.id)
      if (entErr) throw entErr
      const kMap = {}
      ;(entries || []).forEach(e => { kMap[e.id] = { name: e.name, firma: e.firma } })
      setKunden(kMap)

      const kundenIds = (entries || []).map(e => e.id)
      if (kundenIds.length === 0) {
        setCalls([]); setTouchpoints([]); setLoading(false); return
      }

      // 3. Alle Calls + Touchpoints dieser Kunden
      const [callsRes, tpRes] = await Promise.all([
        supabase.from('kunden_calls').select('*').in('kunde_id', kundenIds),
        supabase.from('kunden_touchpoints').select('*').in('kunde_id', kundenIds),
      ])
      if (callsRes.error) throw callsRes.error
      if (tpRes.error) throw tpRes.error
      setCalls(callsRes.data || [])
      setTouchpoints(tpRes.data || [])
    } catch (e) {
      console.error('ProzessKunde load error:', e)
      setErr(e.message || 'Fehler beim Laden')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

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

  // Spalten-Einteilung
  const ueberfaellig = offene
    .filter(c => c.faellig_am && c.faellig_am < heute)
    .sort((a, b) => (a.faellig_am || '').localeCompare(b.faellig_am || ''))
  const diesenMonat = offene
    .filter(c => c.faellig_am && c.faellig_am >= heute && c.faellig_am <= monatsEnde)
    .sort((a, b) => (a.faellig_am || '').localeCompare(b.faellig_am || ''))

  // "Alles erledigt" = Kunden die KEINE offene Aufgabe vor Monatsende haben
  const kundenMitOffen = new Set([...ueberfaellig, ...diesenMonat].map(c => c.kunde_id))
  const alleErledigtKunden = Object.keys(kunden).filter(id => !kundenMitOffen.has(id))

  const spalten = [
    { key: 'ueberfaellig', titel: 'Überfällig', farbe: '#dc2626',
      bg: 'bg-red-50', dot: 'bg-red-500', cards: ueberfaellig },
    { key: 'monat', titel: 'Diesen Monat fällig', farbe: '#ff6b01',
      bg: 'bg-orange-50', dot: 'bg-[#ff6b01]', cards: diesenMonat },
  ]

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Prozess Kunde</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Offene Betreuungs-Aufgaben über alle Kunden hinweg
        </p>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {spalten.map(sp => (
          <div key={sp.key} className="bg-gray-50 rounded-2xl p-3">
            <div className="flex items-center gap-2 px-1 mb-3">
              <span className={`w-2 h-2 rounded-full ${sp.dot}`} />
              <span className="text-sm font-bold text-gray-700">{sp.titel}</span>
              <span className="text-xs text-gray-400 ml-auto">{sp.cards.length}</span>
            </div>
            <div className="space-y-2">
              {sp.cards.length === 0 && (
                <p className="text-xs text-gray-300 text-center py-6">Nichts hier</p>
              )}
              {sp.cards.map(call => {
                const k = kunden[call.kunde_id] || {}
                const meta = CALL_META[call.call_typ] || {}
                return (
                  <div key={call.id}
                    className="bg-white border border-gray-200 rounded-xl p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-6 h-6 rounded-full bg-[#ff6b01]/10 flex items-center justify-center text-[10px] font-bold text-[#ff6b01] flex-shrink-0">
                        {initials(k.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-gray-800 truncate">{k.name || 'Unbekannt'}</div>
                        {k.firma && <div className="text-[10px] text-gray-400 truncate">{k.firma}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 pl-0.5">
                      <span className="text-sm">{meta.icon}</span>
                      <span className="text-[11px] font-medium text-gray-600">{meta.label}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1 pl-0.5">
                      Fällig {fmtDate(call.faellig_am)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Spalte "Alles erledigt" */}
        <div className="bg-gray-50 rounded-2xl p-3">
          <div className="flex items-center gap-2 px-1 mb-3">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm font-bold text-gray-700">Alles erledigt</span>
            <span className="text-xs text-gray-400 ml-auto">{alleErledigtKunden.length}</span>
          </div>
          <div className="space-y-2">
            {alleErledigtKunden.length === 0 && (
              <p className="text-xs text-gray-300 text-center py-6">Nichts hier</p>
            )}
            {alleErledigtKunden.map(id => {
              const k = kunden[id] || {}
              return (
                <div key={id}
                  className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-[10px] font-bold text-green-600 flex-shrink-0">
                    {initials(k.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-gray-800 truncate">{k.name || 'Unbekannt'}</div>
                    {k.firma && <div className="text-[10px] text-gray-400 truncate">{k.firma}</div>}
                  </div>
                  <span className="ml-auto text-green-500 text-sm">✓</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

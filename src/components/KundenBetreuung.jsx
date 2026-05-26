// ============================================================
// BREHL VISUALS - Kundenbetreuung Tab
// Calls (Onboarding, First Feedback, Themencall, Strategie) + Touchpoints
// Einbinden in CRM.jsx im Detail-Panel: 
//   {tab === 'betreuung' && <KundenBetreuung kundeId={item.id} />}
// ============================================================
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const CALL_TYPES = {
  onboarding: {
    label: 'Onboarding-Gespräch', recurring: false, icon: '🚀',
    erklaerung: 'Einmalig innerhalb der ersten 48 Stunden nach Vertragsunterzeichnung. Hier werden alle Erwartungen, Zugänge und Ziele geklärt, damit die Zusammenarbeit sauber startet.',
  },
  first_feedback: {
    label: 'First Feedback Gespräch', recurring: false, icon: '💬',
    erklaerung: 'Einmalig direkt nach Erhalt der ersten Videos. Wir checken den Prozess ab, gehen auf Korrekturwünsche ein und stellen sicher, dass der Kunde sich von Anfang an gut aufgehoben fühlt.',
  },
  themencall: {
    label: 'Monatlicher Themencall', recurring: true, icon: '🎯',
    erklaerung: 'Alle 4 Wochen. Vor jedem Dreh wird die inhaltliche Ausrichtung abgestimmt: Welche Themen, welche Formate, welche Botschaften. Sorgt dafür, dass jeder Dreh strategisch sitzt.',
  },
  strategie: {
    label: 'Strategie- & Wachstums-Call', recurring: true, icon: '📈',
    erklaerung: 'Alle 4 Wochen. Strategische Abholung des Kunden: Warum haben bestimmte Inhalte funktioniert, welche Trigger wurden genutzt, wo steht das 90-Tage-Ziel. Macht Wachstum sichtbar und festigt die Zusammenarbeit als langfristige Investition.',
  },
}

const TOUCHPOINT_TYPES = {
  whatsapp:   { label: 'WhatsApp',   icon: '💚' },
  anruf:      { label: 'Anruf',      icon: '📞' },
  email:      { label: 'E-Mail',     icon: '✉️' },
  newsletter: { label: 'Newsletter', icon: '📰' },
  meeting:    { label: 'Meeting',    icon: '🤝' },
  sonstiges:  { label: 'Sonstiges',  icon: '•'  },
}

const TOUCHPOINT_ZIEL = 2

function addDays(dateStr, days) {
  const d = new Date(dateStr); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function todayStr() { return new Date().toISOString().slice(0, 10) }
function mondayOfWeek(date = new Date()) {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function KundenBetreuung({ kundeId }) {
  const [calls, setCalls] = useState([])
  const [touchpoints, setTouchpoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [savingNote, setSavingNote] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [callsRes, tpRes] = await Promise.all([
        supabase.from('kunden_calls').select('*').eq('kunde_id', kundeId).order('created_at', { ascending: false }),
        supabase.from('kunden_touchpoints').select('*').eq('kunde_id', kundeId).order('datum', { ascending: false }),
      ])
      if (callsRes.error) throw callsRes.error
      if (tpRes.error) throw tpRes.error
      setCalls(callsRes.data || [])
      setTouchpoints(tpRes.data || [])
    } catch (e) {
      console.error('Betreuung load error:', e)
      setErr(e.message || 'Fehler beim Laden')
    } finally {
      setLoading(false)
    }
  }, [kundeId])

  useEffect(() => { load() }, [load])

  // Fehlende Calls beim ersten Laden automatisch anlegen
  useEffect(() => {
    if (loading) return
    const ensureMissing = async () => {
      const existing = new Set(calls.map(c => c.call_typ))
      const toCreate = Object.keys(CALL_TYPES)
        .filter(t => !existing.has(t))
        .map(t => ({ kunde_id: kundeId, call_typ: t, status: 'offen', faellig_am: todayStr() }))
      if (toCreate.length > 0) {
        const { error } = await supabase.from('kunden_calls').insert(toCreate)
        if (!error) load()
        else console.error('ensureMissing error:', error)
      }
    }
    ensureMissing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  async function markCallDone(call) {
    const heute = todayStr()
    try {
      const { error } = await supabase.from('kunden_calls')
        .update({ status: 'erledigt', erledigt_am: heute }).eq('id', call.id)
      if (error) throw error
      if (CALL_TYPES[call.call_typ]?.recurring) {
        await supabase.from('kunden_calls').insert({
          kunde_id: kundeId, call_typ: call.call_typ, status: 'offen', faellig_am: addDays(heute, 28),
        })
      }
      load()
    } catch (e) { console.error('markCallDone error:', e); setErr(e.message) }
  }

  async function saveNote(callId, text) {
    setSavingNote(callId)
    try {
      const { error } = await supabase.from('kunden_calls').update({ notizen: text }).eq('id', callId)
      if (error) throw error
      setCalls(cs => cs.map(c => (c.id === callId ? { ...c, notizen: text } : c)))
    } catch (e) { console.error('saveNote error:', e); setErr(e.message) }
    finally { setSavingNote(null) }
  }

  async function addTouchpoint(typ, notiz) {
    try {
      const { error } = await supabase.from('kunden_touchpoints')
        .insert({ kunde_id: kundeId, typ, notiz: notiz || null, datum: todayStr() })
      if (error) throw error
      load()
    } catch (e) { console.error('addTouchpoint error:', e); setErr(e.message) }
  }

  async function deleteTouchpoint(id) {
    try {
      const { error } = await supabase.from('kunden_touchpoints').delete().eq('id', id)
      if (error) throw error
      setTouchpoints(tps => tps.filter(t => t.id !== id))
    } catch (e) { console.error('deleteTouchpoint error:', e); setErr(e.message) }
  }

  if (loading) return <p className="text-xs text-gray-400 text-center py-4">Lädt…</p>

  const wochenStart = mondayOfWeek()
  const tpDieseWoche = touchpoints.filter(t => t.datum >= wochenStart)
  const tpProgress = Math.min(tpDieseWoche.length, TOUCHPOINT_ZIEL)
  const offeneCalls = calls.filter(c => c.status === 'offen')
  const erledigteCalls = calls.filter(c => c.status === 'erledigt')

  return (
    <>
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-3 py-2">
          {err}
        </div>
      )}

      <TouchpointSection
        tpDieseWoche={tpDieseWoche} tpProgress={tpProgress} touchpoints={touchpoints}
        onAdd={addTouchpoint} onDelete={deleteTouchpoint} />

      <p className="text-[10px] font-bold tracking-wider uppercase text-gray-400 mt-5 mb-2">
        Anstehende Gespräche
      </p>
      {offeneCalls.length === 0 && (
        <p className="text-xs text-gray-400 py-2">Keine offenen Gespräche.</p>
      )}
      {offeneCalls.map(call => (
        <CallCard key={call.id} call={call} onDone={() => markCallDone(call)}
          onSaveNote={saveNote} savingNote={savingNote === call.id} />
      ))}

      {erledigteCalls.length > 0 && (
        <>
          <p className="text-[10px] font-bold tracking-wider uppercase text-gray-400 mt-5 mb-2">
            Verlauf ({erledigteCalls.length})
          </p>
          {erledigteCalls.map(call => (
            <CallCard key={call.id} call={call} done
              onSaveNote={saveNote} savingNote={savingNote === call.id} />
          ))}
        </>
      )}
    </>
  )
}

function TouchpointSection({ tpDieseWoche, tpProgress, touchpoints, onAdd, onDelete }) {
  const [open, setOpen] = useState(false)
  const [typ, setTyp] = useState('whatsapp')
  const [notiz, setNotiz] = useState('')
  const erfuellt = tpProgress >= TOUCHPOINT_ZIEL

  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-bold text-gray-800">Touchpoints diese Woche</span>
        <span className={`text-xs font-bold ${erfuellt ? 'text-green-600' : 'text-[#ff6b01]'}`}>
          {tpDieseWoche.length} / {TOUCHPOINT_ZIEL}
        </span>
      </div>

      <div className="flex gap-1 mb-2">
        {Array.from({ length: TOUCHPOINT_ZIEL }).map((_, i) => (
          <div key={i} className={`flex-1 h-1.5 rounded-full ${
            i < tpProgress ? (erfuellt ? 'bg-green-500' : 'bg-[#ff6b01]') : 'bg-gray-200'}`} />
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mb-2 leading-relaxed">
        Ziel: mindestens 2 Touchpoints pro Woche (WhatsApp, Anruf, Mail, Newsletter …), um die Kundenbeziehung aktiv zu halten.
      </p>

      {!open ? (
        <button onClick={() => setOpen(true)}
          className="text-xs font-semibold text-[#ff6b01] hover:underline">
          + Touchpoint hinzufügen
        </button>
      ) : (
        <div className="space-y-2">
          <select value={typ} onChange={e => setTyp(e.target.value)}
            className="input text-xs">
            {Object.entries(TOUCHPOINT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
          <input value={notiz} onChange={e => setNotiz(e.target.value)}
            placeholder="Kurze Notiz (optional)" className="input text-xs" />
          <div className="flex gap-2">
            <button onClick={() => { onAdd(typ, notiz); setNotiz(''); setOpen(false) }}
              className="btn-primary flex-1 text-xs">Speichern</button>
            <button onClick={() => { setOpen(false); setNotiz('') }}
              className="btn-secondary text-xs px-3">×</button>
          </div>
        </div>
      )}

      {touchpoints.length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-100 space-y-1">
          {touchpoints.slice(0, 12).map(tp => (
            <div key={tp.id} className="flex items-center gap-2 text-xs text-gray-600 py-0.5">
              <span>{TOUCHPOINT_TYPES[tp.typ]?.icon || '•'}</span>
              <span className="font-medium">{TOUCHPOINT_TYPES[tp.typ]?.label || tp.typ}</span>
              <span className="text-gray-400">{fmtDate(tp.datum)}</span>
              {tp.notiz && <span className="text-gray-400 truncate">— {tp.notiz}</span>}
              <button onClick={() => onDelete(tp.id)}
                className="ml-auto text-gray-300 hover:text-red-500 text-sm">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CallCard({ call, onDone, onSaveNote, savingNote, done }) {
  const cfg = CALL_TYPES[call.call_typ] || {}
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState(call.notizen || '')
  const ueberfaellig = !done && call.faellig_am && call.faellig_am < todayStr()

  return (
    <div className={`border rounded-xl p-3 mb-2 ${done ? 'border-gray-100 bg-gray-50/60' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-gray-800">{cfg.label}</span>
            {cfg.recurring && (
              <span className="text-[9px] bg-indigo-50 text-indigo-500 rounded px-1.5 py-0.5 font-semibold">
                alle 4 Wochen
              </span>
            )}
            {ueberfaellig && (
              <span className="text-[9px] bg-red-50 text-red-500 rounded px-1.5 py-0.5 font-semibold">
                überfällig
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {done
              ? `Erledigt am ${fmtDate(call.erledigt_am)}`
              : call.faellig_am ? `Fällig ab ${fmtDate(call.faellig_am)}` : ''}
          </p>
        </div>
        {!done && (
          <button onClick={onDone}
            className="bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg px-2.5 py-1.5 whitespace-nowrap transition-colors">
            ✓ Geführt
          </button>
        )}
      </div>

      {cfg.erklaerung && !done && (
        <p className="text-[11px] text-gray-500 leading-relaxed mt-2 bg-gray-50 rounded-lg px-2.5 py-2">
          {cfg.erklaerung}
        </p>
      )}

      <div className="mt-2">
        {!noteOpen ? (
          <div onClick={() => setNoteOpen(true)} className="cursor-pointer">
            {call.notizen ? (
              <p className="text-[11px] text-gray-600 whitespace-pre-wrap bg-[#ff6b01]/5 border-l-2 border-[#ff6b01] rounded px-2.5 py-1.5">
                {call.notizen}
              </p>
            ) : (
              <span className="text-[11px] text-[#ff6b01] font-semibold">+ Notiz hinzufügen</span>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
              placeholder="Was wurde besprochen? Wichtige Punkte, To-Dos, Stimmung …" rows={3}
              className="input text-xs resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { onSaveNote(call.id, noteText); setNoteOpen(false) }}
                disabled={savingNote} className="btn-primary text-xs px-3">
                {savingNote ? 'Speichert…' : 'Notiz speichern'}
              </button>
              <button onClick={() => { setNoteText(call.notizen || ''); setNoteOpen(false) }}
                className="btn-secondary text-xs px-3">Abbrechen</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

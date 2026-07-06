import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { MeineSpesen } from './Spesen'

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

// Stunden aus Von/Bis (über Mitternacht wird +24h gerechnet)
function hoursBetween(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return Math.round((mins / 60) * 100) / 100
}

export default function MeineStunden({ userId }) {
  const { user } = useAuth()
  const uid = userId || user.id
  const acting = !!userId   // Admin erfasst für eine andere Person (dann alle Monate bearbeitbar)
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [entries, setEntries] = useState([])
  const [lohn, setLohn] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState({ datum: '', start_zeit: '', end_zeit: '', notiz: '' })

  const now = new Date()
  const isCurrentMonth = now.getFullYear() === month.y && now.getMonth() === month.m
  const canEdit = acting || isCurrentMonth   // Admin darf jeden Monat bearbeiten

  useEffect(() => { load() }, [month.y, month.m, uid])
  useEffect(() => {
    supabase.from('extern_verguetung').select('stundenlohn').eq('user_id', uid).maybeSingle()
      .then(({ data }) => setLohn(Number(data?.stundenlohn || 0)))
  }, [uid])

  async function load() {
    setLoading(true)
    const mm = String(month.m + 1).padStart(2, '0')
    const lastDay = new Date(month.y, month.m + 1, 0).getDate()
    const { data } = await supabase.from('minijob_stunden').select('*').eq('user_id', uid)
      .gte('datum', `${month.y}-${mm}-01`).lte('datum', `${month.y}-${mm}-${String(lastDay).padStart(2, '0')}`)
      .order('datum')
    setEntries(data || []); setLoading(false)
  }

  async function addEntry() {
    setMsg('')
    if (!form.datum || !form.start_zeit || !form.end_zeit) { setMsg('Bitte Datum, Von und Bis ausfüllen.'); return }
    const stunden = hoursBetween(form.start_zeit, form.end_zeit)
    if (stunden <= 0) { setMsg('„Bis" muss nach „Von" liegen.'); return }
    setSaving(true)
    const { error } = await supabase.from('minijob_stunden').insert({
      user_id: uid, datum: form.datum, start_zeit: form.start_zeit, end_zeit: form.end_zeit, stunden, notiz: form.notiz || null,
    })
    setSaving(false)
    if (error) { setMsg('Fehler: ' + error.message); return }
    // Ansicht auf den Monat des neuen Eintrags springen, damit er sofort sichtbar ist
    const d = new Date(form.datum); setMonth({ y: d.getFullYear(), m: d.getMonth() })
    setForm({ datum: '', start_zeit: '', end_zeit: '', notiz: '' }); load()
  }

  async function del(id) {
    if (!window.confirm('Diesen Eintrag löschen?')) return
    await supabase.from('minijob_stunden').delete().eq('id', id); load()
  }

  function shiftMonth(delta) {
    setMonth(p => { const d = new Date(p.y, p.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  }

  const totalH = entries.reduce((s, e) => s + Number(e.stunden || 0), 0)
  const betrag = totalH * lohn
  const fmtH = h => (Math.round(h * 100) / 100).toLocaleString('de-DE')
  const eur = n => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
  const preview = hoursBetween(form.start_zeit, form.end_zeit)

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Meine Stunden</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="btn-secondary text-xs px-3">‹</button>
          <span className="text-sm font-medium text-gray-700 w-32 text-center">{MONTHS[month.m]} {month.y}</span>
          <button onClick={() => shiftMonth(1)} className="btn-secondary text-xs px-3">›</button>
        </div>
      </div>

      {/* Zusammenfassung */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Stunden</p><p className="text-lg font-bold text-gray-900">{fmtH(totalH)}</p></div>
        <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Stundenlohn</p><p className="text-lg font-bold text-gray-900">{lohn ? eur(lohn) : '—'}</p></div>
        <div className="card p-4 bg-[#ff6b01]/5 border-[#ff6b01]/20"><p className="text-[10px] uppercase tracking-wider text-[#c2410c] mb-1">Betrag</p><p className="text-lg font-bold text-[#c2410c]">{eur(betrag)}</p></div>
      </div>
      {!lohn && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Dein Stundenlohn ist noch nicht hinterlegt – melde dich bei Felix. Deine Stunden kannst du trotzdem schon eintragen.</div>}

      {/* Erfassen (nur laufender Monat) */}
      {canEdit ? (
        <div className="card p-4 space-y-3">
          <p className="section-title mb-0">Einsatz eintragen</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="col-span-2 md:col-span-1"><label className="label">Datum</label><input type="date" className="input text-sm" value={form.datum} onChange={e => setForm(p => ({ ...p, datum: e.target.value }))} /></div>
            <div><label className="label">Von</label><input type="time" className="input text-sm" value={form.start_zeit} onChange={e => setForm(p => ({ ...p, start_zeit: e.target.value }))} /></div>
            <div><label className="label">Bis</label><input type="time" className="input text-sm" value={form.end_zeit} onChange={e => setForm(p => ({ ...p, end_zeit: e.target.value }))} /></div>
            <div className="flex items-end"><div className="text-xs text-gray-500 pb-2.5">{preview > 0 ? `= ${fmtH(preview)} Std.` : ''}</div></div>
          </div>
          <div><label className="label">Notiz (optional)</label><input className="input text-sm" value={form.notiz} onChange={e => setForm(p => ({ ...p, notiz: e.target.value }))} placeholder="z.B. Dreh Autohaus Müller" /></div>
          {msg && <p className="text-xs text-red-600">{msg}</p>}
          <button onClick={addEntry} disabled={saving} className="btn-primary text-sm w-full">{saving ? 'Speichert...' : '+ Stunden eintragen'}</button>
        </div>
      ) : (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">Abgeschlossener Monat – nur Ansicht. Änderungen bitte über Felix.</div>
      )}

      {/* Liste */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-24"><div className="w-5 h-5 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Noch keine Stunden in diesem Monat.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {entries.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-14 flex-shrink-0">
                  <p className="text-sm font-semibold text-gray-800">{new Date(e.datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</p>
                  <p className="text-[10px] text-gray-400">{new Date(e.datum).toLocaleDateString('de-DE', { weekday: 'short' })}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">{e.start_zeit?.slice(0, 5)}–{e.end_zeit?.slice(0, 5)} Uhr · <span className="font-medium">{fmtH(Number(e.stunden))} Std.</span></p>
                  {e.notiz && <p className="text-xs text-gray-400 truncate">{e.notiz}</p>}
                </div>
                {canEdit && <button onClick={() => del(e.id)} className="text-xs text-gray-300 hover:text-red-500 flex-shrink-0">Löschen</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fahrtkosten / Umkosten */}
      <MeineSpesen month={new Date(month.y, month.m, 1)} userId={userId} />

      <p className="text-[10px] text-gray-400 leading-relaxed">
        Deine Einträge werden mit Datum, Beginn, Ende und Dauer gespeichert (Aufzeichnung nach § 17 MiLoG) und sind rechtlich dein Stundennachweis.
        Trage deine Zeiten zeitnah ein. Abgeschlossene Monate sind gesperrt – Korrekturen macht Felix.
      </p>
    </div>
  )
}

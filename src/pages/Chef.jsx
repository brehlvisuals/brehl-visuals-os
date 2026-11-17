import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

// Chefbereich – nur Admin (Route adminOnly + RLS auf os_chef_erinnerungen).
// Wiederkehrende Erinnerungen werden rechtzeitig (Vorlauf) als Aufgabe auf dem Dashboard angelegt;
// abhaken schaltet automatisch auf den nächsten Termin.

const RHYTHMUS = [
  ['woechentlich', 'Jede Woche'],
  ['monatlich', 'Jeden Monat'],
  ['quartalsweise', 'Jedes Quartal'],
  ['halbjaehrlich', 'Jedes halbe Jahr'],
  ['jaehrlich', 'Jedes Jahr'],
]
const rhythmusText = r => RHYTHMUS.find(x => x[0] === r)?.[1] || r
const datum = d => new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
function inTagen(d) {
  const h = new Date(); h.setHours(0, 0, 0, 0)
  const n = Math.round((new Date(d + 'T00:00') - h) / 86400000)
  return n === 0 ? 'heute' : n === 1 ? 'morgen' : n < 0 ? `seit ${-n} Tag${n === -1 ? '' : 'en'} fällig` : `in ${n} Tagen`
}

export default function Chef() {
  const { isAdmin } = useAuth()
  const [liste, setListe] = useState([])
  const [laden, setLaden] = useState(true)
  const [bearbeiten, setBearbeiten] = useState(null)

  useEffect(() => { if (isAdmin) laden_() }, [isAdmin])
  async function laden_() {
    await supabase.rpc('chef_erinnerungen_pruefen')
    const { data } = await supabase.from('os_chef_erinnerungen').select('*').order('naechster_termin')
    setListe(data || []); setLaden(false)
  }
  async function speichern(f) {
    const row = { titel: f.titel.trim(), notiz: f.notiz?.trim() || null, rhythmus: f.rhythmus, naechster_termin: f.naechster_termin, vorlauf_tage: Number(f.vorlauf_tage) || 0, aktiv: f.aktiv, updated_at: new Date().toISOString() }
    const { error } = f.id ? await supabase.from('os_chef_erinnerungen').update(row).eq('id', f.id) : await supabase.from('os_chef_erinnerungen').insert(row)
    if (error) { alert('Speichern fehlgeschlagen: ' + error.message); return }
    setBearbeiten(null); laden_()
  }
  async function aktivSchalten(e) {
    setListe(prev => prev.map(x => x.id === e.id ? { ...x, aktiv: !e.aktiv } : x))
    await supabase.from('os_chef_erinnerungen').update({ aktiv: !e.aktiv, updated_at: new Date().toISOString() }).eq('id', e.id)
  }
  async function loeschen(e) {
    if (!window.confirm(`Erinnerung „${e.titel}“ löschen?\n\nSie landet im Papierkorb und kann wiederhergestellt werden.`)) return
    const { error } = await supabase.from('os_chef_erinnerungen').delete().eq('id', e.id)
    if (error) { alert('Löschen fehlgeschlagen: ' + error.message); return }
    setBearbeiten(null); laden_()
  }

  if (!isAdmin) return <div className="p-6 text-center text-sm text-ink-3">Kein Zugriff.</div>

  return (
    <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8 space-y-5 max-w-4xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Chefbereich</h1>
          <p className="text-[13px] text-ink-2 mt-1.5 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/[0.06] text-ink">🔒 Nur für dich</span>
            Firmeninternes, das kein anderer sieht.
          </p>
        </div>
        <button onClick={() => setBearbeiten({ rhythmus: 'monatlich', vorlauf_tage: 7, aktiv: true })} className="btn-primary text-xs !py-2 !px-4">＋ Erinnerung</button>
      </div>

      {/* Erinnerungen */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[17px] font-semibold text-ink tracking-tight">Wiederkehrende Erinnerungen</h2>
        </div>
        <p className="text-xs text-ink-2 mb-4">Erscheinen rechtzeitig als Aufgabe auf deinem Dashboard. Abhaken springt automatisch zum nächsten Termin.</p>
        {laden ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-[2.5px] border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>
        ) : liste.length === 0 ? (
          <p className="text-sm text-ink-3 py-6 text-center">Noch keine Erinnerungen.</p>
        ) : (
          <div className="space-y-2">
            {liste.map(e => (
              <div key={e.id} className={`rounded-2xl bg-white/70 border border-white px-4 py-3.5 flex items-start gap-3 transition-opacity ${e.aktiv ? '' : 'opacity-50'}`}>
                <div className="w-11 h-11 rounded-2xl flex-shrink-0 flex flex-col items-center justify-center bg-[#ff6b01]/10 text-[#c2410c]">
                  <span className="text-[10px] font-semibold uppercase leading-none">{new Date(e.naechster_termin + 'T12:00').toLocaleDateString('de-DE', { month: 'short' })}</span>
                  <span className="text-[17px] font-bold leading-tight">{new Date(e.naechster_termin + 'T12:00').getDate()}</span>
                </div>
                <button onClick={() => setBearbeiten(e)} className="flex-1 min-w-0 text-left">
                  <p className="text-[15px] font-semibold text-ink tracking-tight">{e.titel}</p>
                  {e.notiz && <p className="text-xs text-ink-2 mt-0.5 line-clamp-2">{e.notiz}</p>}
                  <div className="flex flex-wrap gap-1 mt-2">
                    <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#7c3aed]/10 text-[#6d28d9]">{rhythmusText(e.rhythmus)}</span>
                    <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-black/[0.05] text-ink-2">Nächster Termin {datum(e.naechster_termin)} · {inTagen(e.naechster_termin)}</span>
                    <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-black/[0.05] text-ink-2">Aufgabe {e.vorlauf_tage} Tage vorher</span>
                  </div>
                </button>
                <button onClick={() => aktivSchalten(e)} role="switch" aria-checked={e.aktiv} title={e.aktiv ? 'Pausieren' : 'Aktivieren'}
                  className={`relative inline-block w-[38px] h-[22px] rounded-full transition-colors duration-300 flex-shrink-0 mt-1 ${e.aktiv ? 'bg-[#34c759]' : 'bg-black/[0.12]'}`}>
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform duration-300 ${e.aktiv ? 'translate-x-[16px]' : ''}`} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Finanzen – Vorschau, kommt als Nächstes */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[17px] font-semibold text-ink tracking-tight">Finanzen</h2>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#ff9f0a]/15 text-[#9a5b00]">In Planung</span>
        </div>
        <p className="text-xs text-ink-2 mb-4">Hier kommt deine Finanzübersicht hin.</p>
        <div className="grid sm:grid-cols-3 gap-2 mb-4">
          {[['Einnahmen', '#34c759'], ['Ausgaben', '#ff3b30'], ['Übrig nach Steuern', '#7c3aed']].map(([l, f]) => (
            <div key={l} className="rounded-2xl bg-white/60 border border-white px-3.5 py-3">
              <p className="text-[11px] text-ink-2 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: f }} />{l}</p>
              <div className="h-6 mt-1.5 w-20 rounded-md bg-black/[0.06] animate-pulse" />
            </div>
          ))}
        </div>
        <ul className="text-xs text-ink-2 space-y-1.5 list-disc pl-4">
          <li>Einnahmen & Ausgaben pro Monat als Grafik, Jahresverlauf</li>
          <li>Steuer-Rechner: was vor und nach Steuern übrig bleibt</li>
          <li>Daten aus deiner Excel-Tabelle – oder direkt live aus lexoffice</li>
          <li>KI-Auswertung: Auffälligkeiten, Trends, Tipps</li>
        </ul>
      </div>

      {bearbeiten && <ErinnerungFormular start={bearbeiten} onSave={speichern} onDelete={loeschen} onClose={() => setBearbeiten(null)} />}
    </div>
  )
}

function ErinnerungFormular({ start, onSave, onDelete, onClose }) {
  const morgen = (() => { const d = new Date(); d.setDate(d.getDate() + 7); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}` })()
  const [f, setF] = useState({ id: start.id, titel: start.titel || '', notiz: start.notiz || '', rhythmus: start.rhythmus || 'monatlich',
    naechster_termin: start.naechster_termin || morgen, vorlauf_tage: start.vorlauf_tage ?? 7, aktiv: start.aktiv ?? true })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const ok = f.titel.trim() && f.naechster_termin
  return (
    <div className="fixed inset-0 scrim z-[70] flex items-end sm:items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className="glass-strong rounded-[28px] w-full max-w-md max-h-[90vh] overflow-y-auto pop-in p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[17px] font-semibold text-ink tracking-tight">{f.id ? 'Erinnerung bearbeiten' : 'Neue Erinnerung'}</h3>
          <button onClick={onClose} className="btn-icon w-7 h-7 text-base leading-none">×</button>
        </div>
        <div className="space-y-3">
          <div><label className="label">Woran erinnern?</label><input autoFocus className="input" value={f.titel} onChange={e => set('titel', e.target.value)} placeholder="z. B. Firmenessen planen" /></div>
          <div><label className="label">Notiz</label><textarea className="input" rows={2} value={f.notiz} onChange={e => set('notiz', e.target.value)} placeholder="Optional" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Wie oft</label>
              <select className="input" value={f.rhythmus} onChange={e => set('rhythmus', e.target.value)}>
                {RHYTHMUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className="label">Nächster Termin</label><input type="date" className="input" value={f.naechster_termin} onChange={e => set('naechster_termin', e.target.value)} /></div>
          </div>
          <div><label className="label">Als Aufgabe … Tage vorher anzeigen</label>
            <input type="number" min="0" max="90" className="input" value={f.vorlauf_tage} onChange={e => set('vorlauf_tage', e.target.value)} />
          </div>
          <div className="flex gap-2 pt-1">
            {f.id && <button onClick={() => onDelete(start)} className="btn-secondary !text-[#ff3b30]">Löschen</button>}
            <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button onClick={() => ok && onSave(f)} disabled={!ok} className="btn-primary flex-1 disabled:opacity-40">Speichern</button>
          </div>
        </div>
      </div>
    </div>
  )
}

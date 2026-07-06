import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

export const KM_SATZ = 0.30
const eur = n => Number(n || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const num = v => parseFloat(String(v ?? '').replace(',', '.')) || 0
const fmtDe = n => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('de-DE')
function monthRange(d) {
  const y = d.getFullYear(), m = d.getMonth(), mm = String(m + 1).padStart(2, '0')
  const last = new Date(y, m + 1, 0).getDate()
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`]
}

// Eigene Fahrtkosten/Umkosten erfassen (für alle Nutzer) – auto berechnet & gespeichert
export function MeineSpesen({ month }) {
  const { profile } = useAuth()
  const [von, bis] = monthRange(month)
  const [list, setList] = useState([])
  const [form, setForm] = useState({ datum: '', art: 'fahrt', strecke: '', km: '', beschreibung: '', betrag: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [von, bis, profile?.id])
  async function load() {
    const { data } = await supabase.from('spesen').select('*').eq('user_id', profile.id).gte('datum', von).lte('datum', bis).order('datum')
    setList(data || [])
  }
  async function add() {
    if (!form.datum) return
    const betrag = form.art === 'fahrt' ? num(form.km) * KM_SATZ : num(form.betrag)
    setSaving(true)
    const { error } = await supabase.from('spesen').insert({
      user_id: profile.id, datum: form.datum, art: form.art,
      strecke: form.art === 'fahrt' ? (form.strecke || null) : null,
      km: form.art === 'fahrt' ? num(form.km) : null,
      betrag, beschreibung: form.beschreibung || null,
    })
    setSaving(false)
    if (error) { alert('Fehler: ' + error.message); return }
    setForm({ datum: '', art: 'fahrt', strecke: '', km: '', beschreibung: '', betrag: '' })
    load()
  }
  async function del(id) { await supabase.from('spesen').delete().eq('id', id); load() }

  const sum = list.reduce((s, x) => s + Number(x.betrag || 0), 0)
  const kmPreview = num(form.km) * KM_SATZ

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="section-title mb-0">Meine Fahrtkosten & Umkosten</h3>
        <span className="text-sm font-semibold text-[#c2410c]">{eur(sum)}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div><label className="label">Datum</label><input type="date" className="input text-xs" value={form.datum} onChange={e => setForm(p => ({ ...p, datum: e.target.value }))} /></div>
        <div><label className="label">Art</label>
          <select className="input text-xs" value={form.art} onChange={e => setForm(p => ({ ...p, art: e.target.value }))}>
            <option value="fahrt">Fahrt (km)</option>
            <option value="sonstige">Sonstige</option>
          </select>
        </div>
        {form.art === 'fahrt' ? (
          <>
            <div><label className="label">Strecke</label><input className="input text-xs" value={form.strecke} onChange={e => setForm(p => ({ ...p, strecke: e.target.value }))} placeholder="Ort A – Ort B" /></div>
            <div><label className="label">km</label><input type="number" inputMode="decimal" className="input text-xs" value={form.km} onChange={e => setForm(p => ({ ...p, km: e.target.value }))} /></div>
            <div className="flex items-end"><div className="text-xs text-gray-500 pb-2.5">{kmPreview > 0 ? `= ${eur(kmPreview)}` : '0,30 €/km'}</div></div>
          </>
        ) : (
          <>
            <div className="col-span-2 md:col-span-2"><label className="label">Beschreibung</label><input className="input text-xs" value={form.beschreibung} onChange={e => setForm(p => ({ ...p, beschreibung: e.target.value }))} placeholder="z.B. Material" /></div>
            <div><label className="label">Betrag €</label><input type="number" inputMode="decimal" className="input text-xs" value={form.betrag} onChange={e => setForm(p => ({ ...p, betrag: e.target.value }))} /></div>
          </>
        )}
      </div>
      <button onClick={add} disabled={saving} className="btn-primary text-sm w-full">{saving ? 'Speichert...' : '+ Hinzufügen'}</button>
      {list.length > 0 && (
        <div className="divide-y divide-gray-50">
          {list.map(s => (
            <div key={s.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="w-12 text-gray-500 text-xs flex-shrink-0">{new Date(s.datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
              <span className="flex-1 text-gray-700 truncate">{s.art === 'fahrt' ? `🚗 ${s.strecke || ''} · ${fmtDe(s.km)} km` : `• ${s.beschreibung || 'Umkosten'}`}</span>
              <span className="font-medium text-gray-800 flex-shrink-0">{eur(s.betrag)}</span>
              <button onClick={() => del(s.id)} className="text-xs text-gray-300 hover:text-red-500 flex-shrink-0">×</button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-400">Fahrtkosten werden mit 0,30 €/km automatisch berechnet und gespeichert.</p>
    </div>
  )
}

// Admin-Übersicht: Externe (Stunden × Stundenlohn) + alle Spesen im Monat
export function AdminSpesenUebersicht({ month }) {
  const [von, bis] = monthRange(month)
  const [externe, setExterne] = useState([])
  const [alle, setAlle] = useState([])

  useEffect(() => { load() }, [von, bis])
  async function load() {
    const [profs, verg, std, sp] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('role', 'extern'),
      supabase.from('extern_verguetung').select('*'),
      supabase.from('minijob_stunden').select('user_id, stunden').gte('datum', von).lte('datum', bis),
      supabase.from('spesen').select('*, profiles(full_name)').gte('datum', von).lte('datum', bis).order('datum'),
    ])
    const lohn = Object.fromEntries((verg.data || []).map(r => [r.user_id, Number(r.stundenlohn)]))
    const hrs = {}; (std.data || []).forEach(r => { hrs[r.user_id] = (hrs[r.user_id] || 0) + Number(r.stunden || 0) })
    setExterne((profs.data || []).map(p => ({ id: p.id, name: p.full_name, stunden: hrs[p.id] || 0, lohn: lohn[p.id] || 0 })))
    setAlle(sp.data || [])
  }
  const spesenSum = alle.reduce((s, x) => s + Number(x.betrag || 0), 0)

  return (
    <>
      <div className="card p-4">
        <h3 className="section-title">Externe – Stunden & Entgelt (Monat)</h3>
        {externe.length === 0 ? <p className="text-sm text-gray-400 py-2 text-center">Keine externen Zugänge.</p> : (
          <div className="space-y-1">
            {externe.map(e => (
              <div key={e.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-700">{e.name}</span>
                <span className="text-xs text-gray-500">{fmtDe(e.stunden)} Std × {eur(e.lohn)} = <span className="font-semibold text-[#c2410c] text-sm">{eur(e.stunden * e.lohn)}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="section-title mb-0">Fahrtkosten & Umkosten – Team (Monat)</h3>
          <span className="text-sm font-semibold text-[#c2410c]">{eur(spesenSum)}</span>
        </div>
        {alle.length === 0 ? <p className="text-sm text-gray-400 py-2 text-center">Keine Spesen in diesem Monat.</p> : (
          <div className="divide-y divide-gray-50">
            {alle.map(s => (
              <div key={s.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="w-12 text-gray-500 text-xs flex-shrink-0">{new Date(s.datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
                <span className="w-24 text-gray-700 truncate flex-shrink-0">{s.profiles?.full_name || '—'}</span>
                <span className="flex-1 text-gray-500 truncate text-xs">{s.art === 'fahrt' ? `🚗 ${s.strecke || ''} · ${fmtDe(s.km)} km` : (s.beschreibung || 'Umkosten')}</span>
                <span className="font-medium text-gray-800 flex-shrink-0">{eur(s.betrag)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

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

// Eigene Fahrtkosten/Umkosten erfassen (für alle Nutzer) – auto berechnet & gespeichert.
// Optional userId: Admin erfasst für eine andere Person.
export function MeineSpesen({ month, userId }) {
  const { profile } = useAuth()
  const uid = userId || profile.id
  const [von, bis] = monthRange(month)
  const [list, setList] = useState([])
  const [form, setForm] = useState({ datum: '', art: 'fahrt', strecke: '', km: '', beschreibung: '', betrag: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [von, bis, uid])
  async function load() {
    const { data } = await supabase.from('spesen').select('*').eq('user_id', uid).gte('datum', von).lte('datum', bis).order('datum')
    setList(data || [])
  }
  async function add() {
    if (!form.datum) return
    const betrag = form.art === 'fahrt' ? num(form.km) * KM_SATZ : num(form.betrag)
    setSaving(true)
    const { error } = await supabase.from('spesen').insert({
      user_id: uid, datum: form.datum, art: form.art,
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

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const hhmm = t => (t || '').slice(0, 5)

// Auswertung EINER ausgewählten Person (Admin): Stunden/Entgelt/Fahrtkosten + Kalender mit Klick auf den Tag
export function PersonSpesen({ month, userId, name }) {
  const [von, bis] = monthRange(month)
  const y = month.getFullYear(), mo = month.getMonth()
  const [lohn, setLohn] = useState(0)
  const [stunden, setStunden] = useState([])
  const [spesen, setSpesen] = useState([])
  const [tag, setTag] = useState(null)

  useEffect(() => { if (userId) load(); setTag(null) }, [von, bis, userId])
  async function load() {
    const [v, std, sp] = await Promise.all([
      supabase.from('extern_verguetung').select('stundenlohn').eq('user_id', userId).maybeSingle(),
      supabase.from('minijob_stunden').select('*').eq('user_id', userId).gte('datum', von).lte('datum', bis).order('datum'),
      supabase.from('spesen').select('*').eq('user_id', userId).gte('datum', von).lte('datum', bis).order('datum'),
    ])
    setLohn(Number(v.data?.stundenlohn || 0)); setStunden(std.data || []); setSpesen(sp.data || [])
  }

  const hSum = stunden.filter(x => x.status === 'genehmigt').reduce((s, x) => s + Number(x.stunden || 0), 0)
  const offenH = stunden.filter(x => (x.status || 'offen') === 'offen').reduce((s, x) => s + Number(x.stunden || 0), 0)
  const sSum = spesen.reduce((s, x) => s + Number(x.betrag || 0), 0)
  const hatMinijob = stunden.length > 0 || lohn > 0

  const byDay = {}
  const push = (d, item) => { (byDay[d] = byDay[d] || []).push(item) }
  stunden.forEach(s => push(s.datum, { kind: 'std', ...s }))
  spesen.forEach(s => push(s.datum, { kind: 'spesen', ...s }))

  const first = new Date(y, mo, 1)
  const startPad = (first.getDay() + 6) % 7
  const daysInMonth = new Date(y, mo + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let t = 1; t <= daysInMonth; t++) cells.push(`${y}-${String(mo + 1).padStart(2, '0')}-${String(t).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)

  return (
    <>
      {/* Kennzahlen der Person */}
      <div className="grid grid-cols-3 gap-3">
        {hatMinijob && <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Stunden (genehmigt)</p><p className="text-lg font-bold text-gray-900">{fmtDe(hSum)}</p>{offenH > 0 && <p className="text-[10px] text-yellow-600 mt-0.5">+ {fmtDe(offenH)} offen</p>}</div>}
        {hatMinijob && <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Entgelt ({eur(lohn)}/h)</p><p className="text-lg font-bold text-[#c2410c]">{eur(hSum * lohn)}</p></div>}
        <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Fahrtkosten</p><p className="text-lg font-bold text-[#c2410c]">{eur(sSum)}</p></div>
      </div>

      {/* Kalender: wann hat {name} was eingetragen */}
      <div className="card p-4">
        <h3 className="section-title">Eintragungen {name ? `– ${name}` : ''} (Tag antippen)</h3>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WD.map(d => <div key={d} className="text-center text-[10px] font-semibold text-gray-300 py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((ds, i) => {
            if (!ds) return <div key={i} className="min-h-[46px] rounded-md" />
            const items = byDay[ds] || []
            const dh = items.filter(x => x.kind === 'std').reduce((s, x) => s + Number(x.stunden || 0), 0)
            const de = items.filter(x => x.kind === 'spesen').reduce((s, x) => s + Number(x.betrag || 0), 0)
            const active = tag === ds
            return (
              <button key={i} onClick={() => setTag(active ? null : ds)}
                className={`min-h-[46px] rounded-md p-1 text-left border transition-all ${active ? 'border-[#ff6b01] bg-[#ff6b01]/5' : items.length ? 'border-gray-100 bg-gray-50 hover:border-[#ff6b01]/40' : 'border-transparent'}`}>
                <div className="text-[10px] text-gray-500">{parseInt(ds.slice(-2))}</div>
                {dh > 0 && <div className="text-[9px] font-semibold text-[#ff6b01] leading-tight">{fmtDe(dh)} Std</div>}
                {de > 0 && <div className="text-[9px] font-semibold text-[#c2410c] leading-tight">{eur(de)}</div>}
              </button>
            )
          })}
        </div>

        {tag && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-gray-600 mb-2">{new Date(tag).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
            {(byDay[tag] || []).length === 0 ? <p className="text-xs text-gray-400">Nichts eingetragen.</p> : (
              <div className="space-y-1.5">
                {(byDay[tag] || []).map((it, k) => (
                  <div key={k} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                    {it.kind === 'std' ? (
                      <span className="flex-1 text-gray-600 text-xs">🕒 {hhmm(it.start_zeit)}–{hhmm(it.end_zeit)} Uhr{it.notiz ? ` · ${it.notiz}` : ''}</span>
                    ) : (
                      <span className="flex-1 text-gray-600 text-xs">{it.art === 'fahrt' ? `🚗 ${it.strecke || ''} · ${fmtDe(it.km)} km` : `• ${it.beschreibung || 'Umkosten'}`}</span>
                    )}
                    <span className="font-medium text-gray-800 flex-shrink-0">{it.kind === 'std' ? `${fmtDe(it.stunden)} Std` : eur(it.betrag)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {stunden.length === 0 && spesen.length === 0 && <p className="text-sm text-gray-400 py-2 text-center">Keine Einträge in diesem Monat.</p>}
      </div>
    </>
  )
}

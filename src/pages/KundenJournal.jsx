import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

const heute = () => new Date().toISOString().slice(0, 10)

// Datum hübsch: "3. Juli 2026"
function fmtDatum(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function KundenJournal() {
  const { profile } = useAuth()
  const location = useLocation()
  const [kunden, setKunden] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selected, setSelected] = useState(null) // kunde-objekt
  const [eintraege, setEintraege] = useState([])
  const [counts, setCounts] = useState({}) // kunde_id -> anzahl
  const [suche, setSuche] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchBasis() }, [])

  async function fetchBasis() {
    setLoading(true)
    const [k, p, c] = await Promise.all([
      supabase.from('proj_kunden').select('id, name').order('name'),
      supabase.from('profiles').select('id, full_name, email'),
      supabase.from('kunden_journal').select('kunde_id'),
    ])
    if (k.data) {
      setKunden(k.data)
      // Aus der Projekte-Seite vorausgewählter Kunde (via navigate-state)
      const vorId = location.state?.kundeId
      if (vorId && !selected) {
        const vor = k.data.find(x => x.id === vorId)
        if (vor) openKunde(vor)
      }
    }
    if (p.data) setProfiles(p.data)
    if (c.data) {
      const map = {}
      for (const row of c.data) map[row.kunde_id] = (map[row.kunde_id] || 0) + 1
      setCounts(map)
    }
    setLoading(false)
  }

  async function fetchEintraege(kundeId) {
    const { data } = await supabase
      .from('kunden_journal')
      .select('*')
      .eq('kunde_id', kundeId)
      .order('datum', { ascending: false })
      .order('created_at', { ascending: false })
    setEintraege(data || [])
  }

  function openKunde(k) {
    setSelected(k)
    setEintraege([])
    fetchEintraege(k.id)
  }

  const namensMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name || p.email?.split('@')[0] || '']))
  const gefiltert = kunden.filter(k => k.name.toLowerCase().includes(suche.toLowerCase().trim()))

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Kunden-Journal</h1>
        <p className="text-sm text-gray-400">Calls, Feedback & Notizen pro Kunde — mit Datum, dauerhaft dokumentiert.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        {/* Kundenliste */}
        <div className={`md:w-64 flex-shrink-0 ${selected ? 'hidden md:block' : ''}`}>
          <input className="input mb-2 text-sm" placeholder="Kunde suchen…" value={suche} onChange={e => setSuche(e.target.value)} />
          <div className="space-y-1">
            {loading && <p className="text-xs text-gray-400 px-2 py-4">Lädt…</p>}
            {!loading && gefiltert.length === 0 && <p className="text-xs text-gray-400 px-2 py-4">Keine Kunden gefunden.</p>}
            {gefiltert.map(k => (
              <button key={k.id} onClick={() => openKunde(k)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${
                  selected?.id === k.id ? 'bg-[#ff6b01]/8 text-[#ff6b01] font-medium' : 'text-gray-600 hover:bg-gray-50'
                }`}>
                <span className="truncate">{k.name}</span>
                {counts[k.id] > 0 && (
                  <span className={`text-[10px] font-semibold rounded-full min-w-[18px] h-4 px-1 flex items-center justify-center ${
                    selected?.id === k.id ? 'bg-[#ff6b01]/15 text-[#ff6b01]' : 'bg-gray-100 text-gray-400'
                  }`}>{counts[k.id]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Journal */}
        <div className="flex-1 min-w-0">
          {!selected && (
            <div className="text-center text-gray-400 text-sm py-20 border border-dashed border-gray-200 rounded-xl">
              Wähle links einen Kunden aus.
            </div>
          )}
          {selected && (
            <Journal
              kunde={selected}
              eintraege={eintraege}
              namensMap={namensMap}
              profileId={profile?.id}
              onBack={() => setSelected(null)}
              onChanged={() => { fetchEintraege(selected.id); fetchBasis() }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function Journal({ kunde, eintraege, namensMap, profileId, onBack, onChanged }) {
  const [form, setForm] = useState({ datum: heute(), titel: '', text: '' })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState(null)
  const set = (key, val) => setForm(p => ({ ...p, [key]: val }))

  async function speichern() {
    if (!form.text.trim() || saving) return
    setSaving(true)
    const payload = {
      kunde_id: kunde.id,
      datum: form.datum || heute(),
      titel: form.titel.trim() || null,
      text: form.text.trim(),
    }
    let error
    if (editId) {
      ;({ error } = await supabase.from('kunden_journal').update(payload).eq('id', editId))
    } else {
      ;({ error } = await supabase.from('kunden_journal').insert({ ...payload, created_by: profileId }))
    }
    setSaving(false)
    if (error) { alert('Konnte nicht gespeichert werden:\n\n' + error.message); return }
    setForm({ datum: heute(), titel: '', text: '' })
    setEditId(null)
    onChanged()
  }

  function bearbeiten(e) {
    setEditId(e.id)
    setForm({ datum: e.datum, titel: e.titel || '', text: e.text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function abbrechen() {
    setEditId(null)
    setForm({ datum: heute(), titel: '', text: '' })
  }

  async function loeschen(id) {
    if (!confirm('Diesen Eintrag wirklich löschen?')) return
    const { error } = await supabase.from('kunden_journal').delete().eq('id', id)
    if (error) { alert('Konnte nicht gelöscht werden:\n\n' + error.message); return }
    if (editId === id) abbrechen()
    onChanged()
  }

  return (
    <div>
      {/* Kopf mit Mobile-Zurück */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onBack} className="md:hidden text-gray-400 text-sm">← </button>
        <h2 className="font-bold text-gray-900">{kunde.name}</h2>
      </div>

      {/* Eingabe */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 mb-5 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <div className="sm:w-40">
            <label className="label">Datum</label>
            <input type="date" className="input text-sm" value={form.datum} onChange={e => set('datum', e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="label">Titel (optional)</label>
            <input className="input text-sm" placeholder="z.B. Feedback-Call, Themen-Call…" value={form.titel} onChange={e => set('titel', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Notiz</label>
          <textarea className="input text-sm" rows={4} placeholder="Was wurde besprochen? Feedback, Absprachen, To-dos…"
            value={form.text} onChange={e => set('text', e.target.value)} />
        </div>
        <div className="flex gap-2 pt-3">
          {editId && <button onClick={abbrechen} className="btn-secondary flex-1 sm:flex-none">Abbrechen</button>}
          <button onClick={speichern} disabled={!form.text.trim() || saving}
            className="btn-primary flex-1 sm:flex-none disabled:opacity-40">
            {saving ? 'Speichert…' : editId ? 'Änderung speichern' : 'Eintrag speichern →'}
          </button>
        </div>
      </div>

      {/* Timeline */}
      {eintraege.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-10">Noch keine Einträge für {kunde.name}.</p>
      )}
      <div className="space-y-3">
        {eintraege.map(e => (
          <div key={e.id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-[#ff6b01]">{fmtDatum(e.datum)}</span>
                  {e.titel && <span className="text-sm font-semibold text-gray-900">· {e.titel}</span>}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => bearbeiten(e)} className="text-xs text-gray-400 hover:text-gray-700 px-1.5 py-0.5">Bearbeiten</button>
                <button onClick={() => loeschen(e.id)} className="text-xs text-gray-300 hover:text-red-500 px-1.5 py-0.5">Löschen</button>
              </div>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mt-1.5">{e.text}</p>
            {e.created_by && namensMap[e.created_by] && (
              <p className="text-[11px] text-gray-300 mt-2">— {namensMap[e.created_by]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

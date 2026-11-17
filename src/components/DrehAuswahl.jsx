// Auswahl „Für welchen Dreh?“ (Stunden/Fahrtkosten einem Kunden zuordnen – für den Stundensatz im Chefbereich)
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

let cache = null
export function useDrehs() {
  const [drehs, setDrehs] = useState(cache || [])
  useEffect(() => {
    if (cache) return
    const von = new Date(); von.setDate(von.getDate() - 150)
    const bis = new Date(); bis.setDate(bis.getDate() + 45)
    const z = d => d.toISOString().slice(0, 10)
    supabase.from('proj_drehs').select('id, datum, kunde_id, kunde_name').gte('datum', z(von)).lte('datum', z(bis)).order('datum', { ascending: false })
      .then(({ data }) => { cache = data || []; setDrehs(cache) })
  }, [])
  return drehs
}

export function DrehAuswahl({ value, onChange, className = 'input text-sm' }) {
  const drehs = useDrehs()
  return (
    <select className={className} value={value || ''} onChange={e => { const d = drehs.find(x => x.id === e.target.value); onChange(d || null) }}>
      <option value="">— kein Dreh / intern —</option>
      {drehs.map(d => <option key={d.id} value={d.id}>{d.kunde_name || 'Dreh'} · {d.datum ? new Date(d.datum + 'T12:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 'ohne Datum'}</option>)}
    </select>
  )
}

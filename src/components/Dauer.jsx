// Dauer in Stunden (Dezimal) – Anzeige „1 Std. 30 Min.“ und Eingabe als Stunden + Minuten
import { useEffect, useState } from 'react'

export function stdText(n) {
  if (n == null || n === '') return ''
  const v = Number(n)
  const h = Math.floor(v), m = Math.round((v - h) * 60)
  if (m === 60) return `${h + 1} Std.`
  return [h ? `${h} Std.` : '', m ? `${m} Min.` : ''].filter(Boolean).join(' ') || '0 Min.'
}

const MINUTEN = [0, 15, 30, 45]

// value: Stunden als Zahl oder null · onChange(null | Zahl)
export function DauerEingabe({ value, onChange, disabled, leerText = '—', autoFocus }) {
  const v = value == null || value === '' ? null : Number(value)
  const [h, setH] = useState(v == null ? '' : String(Math.floor(v)))
  const [m, setM] = useState(v == null ? 0 : Math.round((v - Math.floor(v)) * 60))
  useEffect(() => {
    const w = value == null || value === '' ? null : Number(value)
    setH(w == null ? '' : String(Math.floor(w))); setM(w == null ? 0 : Math.round((w - Math.floor(w)) * 60))
  }, [value])
  function melden(hh, mm) {
    const std = (Number(hh) || 0) + (Number(mm) || 0) / 60
    onChange(std > 0 ? Math.round(std * 100) / 100 : null)
  }
  const minuten = MINUTEN.includes(m) ? MINUTEN : [...MINUTEN, m].sort((a, b) => a - b)
  return (
    <div className="flex items-center gap-1.5">
      <input type="number" min="0" max="99" inputMode="numeric" disabled={disabled} autoFocus={autoFocus} placeholder={leerText}
        className="input !w-[3.6rem] !px-1.5 text-center !py-1.5" value={h}
        onChange={e => { setH(e.target.value); melden(e.target.value, m) }} />
      <span className="text-xs text-ink-2">Std.</span>
      <select disabled={disabled} className="input !w-[4.1rem] !px-2 !py-1.5" value={m} onChange={e => { const mm = Number(e.target.value); setM(mm); melden(h, mm) }}>
        {minuten.map(x => <option key={x} value={x}>{String(x).padStart(2, '0')}</option>)}
      </select>
      <span className="text-xs text-ink-2">Min.</span>
    </div>
  )
}

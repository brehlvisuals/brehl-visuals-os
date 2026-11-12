// Warnkarte im Master-Dashboard: Freigaben, die bald fällig sind, und fehlgeschlagene Beiträge (aus Metricool)
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { metricool, auswerten, alsDatum } from '../lib/kundenvideos'

export default function KundenvideosWarnungen() {
  const navigate = useNavigate()
  const [liste, setListe] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: kunden } = await supabase.from('proj_kunden').select('id, name, metricool_brand_ids, videos_pro_monat, freigabe_vorlauf_tage')
        const mit = (kunden || []).filter(k => k.metricool_brand_ids?.length)
        if (!mit.length) { if (alive) setListe([]); return }
        const heute = new Date(), z = n => String(n).padStart(2, '0')
        const fmt = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
        const r = await metricool({ aktion: 'posts', marken: mit.flatMap(k => k.metricool_brand_ids).join(','), von: fmt(new Date(heute.getTime() - 86400000)), bis: fmt(new Date(heute.getTime() + 30 * 86400000)) })
        const warn = []
        for (const k of mit) {
          const posts = k.metricool_brand_ids.flatMap(id => r.posts?.[id] || [])
          const a = auswerten(k, posts, heute)
          if (a.dringend.length) warn.push({ k, ton: 'rot', text: `${a.dringend.length} Beitrag${a.dringend.length > 1 ? 'e' : ''} wartet auf Freigabe – geht ab ${alsDatum(a.dringend[0].datum).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} online` })
          if (a.abgelehnt.length) warn.push({ k, ton: 'rot', text: `${a.abgelehnt.length} Beitrag${a.abgelehnt.length > 1 ? 'e' : ''} vom Kunden abgelehnt` })
          if (a.verpasst.length || a.fehler.length) warn.push({ k, ton: 'rot', text: `${a.verpasst.length + a.fehler.length} Beitrag${a.verpasst.length + a.fehler.length > 1 ? 'e' : ''} nicht veröffentlicht` })
        }
        if (alive) setListe(warn)
      } catch {
        if (alive) setListe([])   // Metricool nicht erreichbar/eingerichtet → Karte einfach nicht anzeigen
      }
    })()
    return () => { alive = false }
  }, [])

  if (!liste || liste.length === 0) return null
  return (
    <div className="card p-4 fade-up border-[#ff3b30]/20">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-semibold text-[#d70015]">⚠︎ Kundenvideos brauchen Aufmerksamkeit</p>
        <button onClick={() => navigate('/kundenvideos')} className="text-xs font-medium text-[#ff6b01]">Alle ansehen →</button>
      </div>
      <div className="space-y-1.5">
        {liste.slice(0, 6).map((w, i) => (
          <button key={i} onClick={() => navigate(`/kundenvideos?kunde=${w.k.id}`)} className="w-full flex items-center gap-2.5 text-left rounded-xl px-3 py-2 bg-[#ff3b30]/[0.06] hover:bg-[#ff3b30]/10 transition">
            <span className="text-[13px] font-semibold text-ink whitespace-nowrap">{w.k.name}</span>
            <span className="text-xs text-[#b0000f] truncate">{w.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

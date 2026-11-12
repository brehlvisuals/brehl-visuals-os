import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

// Allgemeiner Papierkorb: alles, was gelöscht wird, landet hier (DB-Trigger) und kann wiederhergestellt werden.
// Der Papierkorb wird nie automatisch geleert.

const BEREICHE = [
  { id: 'alle', label: 'Alle' },
  { id: 'projekte', label: 'Projekte', tabellen: ['proj_drehs', 'proj_intern', 'proj_notizen', 'proj_kunden'] },
  { id: 'crm', label: 'CRM', tabellen: ['crm_leads', 'crm_darsteller', 'crm_custom_entries', 'crm_categories', 'crm_notizen', 'crm_tasks', 'kunden_calls', 'kunden_touchpoints', 'kunden_journal', 'portal_news', 'funnel_lps', 'funnel_intern'] },
  { id: 'zeit', label: 'Zeit & Urlaub', tabellen: ['zeiteintraege', 'minijob_stunden', 'urlaubsantraege', 'spesen'] },
  { id: 'aufgaben', label: 'Aufgaben', tabellen: ['os_aufgaben'] },
]

const ART = {
  proj_drehs: 'Dreh', proj_intern: 'Konzept (intern)', proj_notizen: 'Dreh-Kommentar', proj_kunden: 'Kunde',
  crm_leads: 'Lead', crm_darsteller: 'Darsteller', crm_custom_entries: 'CRM-Eintrag', crm_categories: 'CRM-Kategorie',
  crm_notizen: 'CRM-Notiz', crm_tasks: 'CRM-Task', kunden_calls: 'Kunden-Call', kunden_touchpoints: 'Touchpoint',
  kunden_journal: 'Journal-Eintrag', portal_news: 'News', funnel_lps: 'Landingpage', funnel_intern: 'Funnel',
  zeiteintraege: 'Arbeitszeit', minijob_stunden: 'Minijob-Stunden', urlaubsantraege: 'Urlaub/Abwesenheit', spesen: 'Spesen',
  os_aufgaben: 'Aufgabe',
}

const fmtD = d => d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
const kurz = (t, n = 90) => { const s = String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }
const h = v => v != null && v !== '' ? `${Number(v).toLocaleString('de-DE')} h` : ''

function beschreibe(e, name) {
  const d = e.daten || {}
  switch (e.tabelle) {
    case 'proj_drehs': return [d.kunde_name || 'Dreh', d.datum && `Dreh am ${fmtD(d.datum)}`, Array.isArray(d.videos) && `${d.videos.length} Videos`]
    case 'proj_intern': return [d.titel || 'Konzept', d.drehtag && fmtD(d.drehtag)]
    case 'proj_notizen': case 'crm_notizen': return [kurz(d.text)]
    case 'proj_kunden': return [d.name, d.kontakt]
    case 'crm_leads': return [d.name, d.firma]
    case 'crm_darsteller': return [d.name, d.email]
    case 'crm_custom_entries': return [d.name || d.firma, d.firma && d.name ? d.firma : null]
    case 'crm_categories': return [d.label]
    case 'crm_tasks': case 'os_aufgaben': return [d.titel, d.faellig_am && `fällig ${fmtD(d.faellig_am)}`, d.assignee_id && name(d.assignee_id)]
    case 'kunden_calls': return [d.call_typ || 'Call', d.faellig_am && fmtD(d.faellig_am)]
    case 'kunden_touchpoints': return [d.typ, kurz(d.notiz, 60)]
    case 'kunden_journal': return [d.titel || 'Journal', d.datum && fmtD(d.datum)]
    case 'portal_news': return [d.titel]
    case 'funnel_lps': return [d.name, d.url]
    case 'funnel_intern': return [d.kanal]
    case 'zeiteintraege': return [name(d.user_id), fmtD(d.datum), h(d.stunden), kurz(d.beschreibung, 60)]
    case 'minijob_stunden': return [name(d.user_id), fmtD(d.datum), h(d.stunden), kurz(d.notiz, 60)]
    case 'urlaubsantraege': return [name(d.user_id), d.typ, `${fmtD(d.von_datum)} – ${fmtD(d.bis_datum)}`]
    case 'spesen': return [name(d.user_id), fmtD(d.datum), d.art, d.betrag != null && `${Number(d.betrag).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`]
    default: return [e.datensatz_id]
  }
}

export default function Papierkorb() {
  const { isAdmin } = useAuth()
  const [eintraege, setEintraege] = useState([])
  const [profiles, setProfiles] = useState([])
  const [bereich, setBereich] = useState('alle')
  const [ansicht, setAnsicht] = useState('offen')
  const [suche, setSuche] = useState('')
  const [laden, setLaden] = useState(true)
  const [busy, setBusy] = useState(null)
  const [meldung, setMeldung] = useState(null)

  useEffect(() => { laden_() }, [ansicht])
  async function laden_() {
    setLaden(true)
    let q = supabase.from('os_papierkorb').select('id, tabelle, datensatz_id, daten, geloescht_am, geloescht_von, wiederhergestellt_am')
      .order('geloescht_am', { ascending: false }).limit(500)
    q = ansicht === 'offen' ? q.is('wiederhergestellt_am', null) : q.not('wiederhergestellt_am', 'is', null)
    const [{ data }, { data: p }] = await Promise.all([q, supabase.from('profiles').select('id, full_name, email')])
    setEintraege(data || []); setProfiles(p || []); setLaden(false)
  }
  const name = uid => uid ? (profiles.find(p => p.id === uid)?.full_name || 'jemand') : null

  const liste = useMemo(() => {
    const b = BEREICHE.find(x => x.id === bereich)
    const s = suche.trim().toLowerCase()
    return eintraege
      .filter(e => !b?.tabellen || b.tabellen.includes(e.tabelle))
      .filter(e => !s || (ART[e.tabelle] + ' ' + beschreibe(e, name).filter(Boolean).join(' ')).toLowerCase().includes(s))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eintraege, bereich, suche, profiles])

  async function wiederherstellen(e) {
    setBusy(e.id); setMeldung(null)
    const { data, error } = await supabase.rpc('papierkorb_wiederherstellen', { p_id: e.id })
    setBusy(null)
    if (error) { setMeldung({ fehler: true, text: error.message }); return }
    setMeldung({ text: data?.wiederhergestellt > 1 ? `${ART[e.tabelle]} wiederhergestellt (inkl. ${data.wiederhergestellt - 1} zugehöriger Einträge).` : `${ART[e.tabelle]} wiederhergestellt.` })
    laden_()
  }

  if (!isAdmin) return <div className="p-6 text-center text-sm text-ink-3">Kein Zugriff.</div>

  return (
    <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8 space-y-5 max-w-4xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Papierkorb</h1>
          <p className="text-[13px] text-ink-2 mt-1.5">Alles Gelöschte bleibt hier und lässt sich mit einem Tipp wiederherstellen.</p>
        </div>
        <div className="seg">
          {[['offen', 'Gelöscht'], ['zurueck', 'Wiederhergestellt']].map(([v, l]) => (
            <button key={v} onClick={() => setAnsicht(v)} className={`seg-btn ${ansicht === v ? 'is-active' : ''}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="seg overflow-x-auto max-w-full">
          {BEREICHE.map(b => <button key={b.id} onClick={() => setBereich(b.id)} className={`seg-btn ${bereich === b.id ? 'is-active' : ''}`}>{b.label}</button>)}
        </div>
        <input className="input !w-auto flex-1 min-w-[180px] !rounded-full !py-2 !px-4 text-xs" placeholder="Suchen…" value={suche} onChange={e => setSuche(e.target.value)} />
      </div>

      {meldung && (
        <div className={`rounded-2xl px-4 py-3 text-xs fade-up ${meldung.fehler ? 'bg-[#ff3b30]/10 text-[#d70015]' : 'bg-[#34c759]/12 text-[#248a3d]'}`}>{meldung.text}</div>
      )}

      <div className="card overflow-hidden">
        {laden ? (
          <div className="flex justify-center py-14"><div className="w-6 h-6 border-[2.5px] border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>
        ) : liste.length === 0 ? (
          <div className="text-center py-14 px-6">
            <p className="text-3xl mb-2">🗑️</p>
            <p className="text-sm text-ink-2">{ansicht === 'offen' ? 'Der Papierkorb ist leer.' : 'Noch nichts wiederhergestellt.'}</p>
            {ansicht === 'offen' && <p className="text-xs text-ink-3 mt-1">Ab jetzt landet alles, was gelöscht wird, hier.</p>}
          </div>
        ) : (
          <div className="divide-y divide-black/[0.05]">
            {liste.map(e => {
              const teile = beschreibe(e, name).filter(Boolean)
              return (
                <div key={e.id} className="flex items-center gap-3 px-4 md:px-5 py-3.5">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-black/[0.05] text-ink-2 whitespace-nowrap flex-shrink-0">{ART[e.tabelle] || e.tabelle}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{teile[0] || '—'}</p>
                    <p className="text-[11px] text-ink-3 truncate">
                      {teile.slice(1).join(' · ')}{teile.length > 1 ? ' · ' : ''}
                      {ansicht === 'offen'
                        ? `gelöscht ${new Date(e.geloescht_am).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}${name(e.geloescht_von) ? ' von ' + name(e.geloescht_von) : ''}`
                        : `wiederhergestellt ${new Date(e.wiederhergestellt_am).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  </div>
                  {ansicht === 'offen' && (
                    <button onClick={() => wiederherstellen(e)} disabled={busy === e.id}
                      className="text-xs bg-[#ff6b01]/10 text-[#c2410c] px-3 py-1.5 rounded-full font-medium hover:bg-[#ff6b01]/20 active:scale-95 transition whitespace-nowrap flex-shrink-0 disabled:opacity-50">
                      {busy === e.id ? '…' : 'Wiederherstellen'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

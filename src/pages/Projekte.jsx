import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { useLiveDatensatz } from '../lib/useLiveDatensatz'

const STATUSES = [
  { id: 'planung',        label: 'Planung',         color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  text: '#b45309' },
  { id: 'abnahme_kunde', label: 'Abnahme Kunde',    color: '#6366f1', bg: 'rgba(99,102,241,0.1)',  text: '#4338ca' },
  { id: 'dreh',          label: 'Dreh',             color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  text: '#1d4ed8' },
  { id: 'cutting',       label: 'Cutting',          color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', text: '#6d28d9' },
  { id: 'posting',       label: 'Posting',          color: '#f97316', bg: 'rgba(249,115,22,0.1)',  text: '#c2410c' },
  { id: 'abgeschlossen', label: 'Abgeschlossen',    color: '#16a34a', bg: 'rgba(22,163,74,0.1)',   text: '#15803d' },
]

const INTERN_STATUSES = [
  { id: 'planung',  label: 'Planung',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  text: '#b45309' },
  { id: 'dreh',     label: 'Dreh',     color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  text: '#1d4ed8' },
  { id: 'cutting',  label: 'Cutting',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', text: '#6d28d9' },
  { id: 'posting',  label: 'Posting',  color: '#f97316', bg: 'rgba(249,115,22,0.1)',  text: '#c2410c' },
]

// Leere Auswahl-/Datumsfelder müssen als null gespeichert werden –
// Postgres lehnt "" bei uuid- und date-Spalten sonst mit einem 400 ab.
const NULLABLE_KEYS = ['datum', 'kunde_id', 'zustaendig_id', 'darsteller_id']
function cleanDreh(data) {
  const out = { ...data }
  for (const k of NULLABLE_KEYS) if (out[k] === '') out[k] = null
  return out
}

function Pill({ status, statuses = STATUSES }) {
  const s = statuses.find(x => x.id === status)
  if (!s) return null
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.text }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
}

// Feste Farbpalette – jeder Kunde bekommt anhand seines Namens stabil eine Farbe
const KUNDE_COLORS = [
  { bg: 'rgba(59,130,246,0.12)',  text: '#1d4ed8' },
  { bg: 'rgba(22,163,74,0.12)',   text: '#15803d' },
  { bg: 'rgba(239,68,68,0.12)',   text: '#b91c1c' },
  { bg: 'rgba(249,115,22,0.12)',  text: '#c2410c' },
  { bg: 'rgba(139,92,246,0.12)',  text: '#6d28d9' },
  { bg: 'rgba(14,165,233,0.12)',  text: '#0369a1' },
  { bg: 'rgba(217,70,239,0.12)',  text: '#a21caf' },
  { bg: 'rgba(245,158,11,0.14)',  text: '#b45309' },
  { bg: 'rgba(20,184,166,0.12)',  text: '#0f766e' },
  { bg: 'rgba(236,72,153,0.12)',  text: '#be185d' },
]
function kundeStyle(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return KUNDE_COLORS[h % KUNDE_COLORS.length]
}
// Ein Dreh gilt als vollständig gesichert, wenn RAW UND FINAL auf NAS liegen
const istGesichert = d => !!(d?.raw_gesichert && d?.final_gesichert)
// Ab „Cutting“ muss das RAW-Material gesichert sein
const BRAUCHT_RAW = ['cutting', 'posting', 'abgeschlossen']
const RAW_HINWEIS = 'Erst „RAW auf NAS gesichert“ anhaken (im Dreh unter Info) – dann kann der Dreh ins Cutting.'

// Deadline-Anzeige (Berliner Zeit aus dem Browser)
function deadlineInfo(ts, fertig) {
  if (!ts) return null
  const d = new Date(ts), jetzt = new Date()
  const tage = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate())) / 86400000)
  const text = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const ton = fertig ? 'ok' : d < jetzt ? 'ueber' : tage <= 1 ? 'bald' : 'normal'
  return { text, ton }
}
const TON = {
  ok: 'bg-[#34c759]/12 text-[#248a3d]',
  ueber: 'bg-[#ff3b30]/12 text-[#d70015]',
  bald: 'bg-[#ff9f0a]/15 text-[#9a5b00]',
  normal: 'bg-black/[0.05] text-ink-2',
}
// datetime-local <-> timestamptz
const zuLokal = ts => { if (!ts) return ''; const d = new Date(ts); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}` }
const ausLokal = v => v ? new Date(v).toISOString() : null

// Plaintext (z.B. aus Airtable-Migration) sicher in HTML wandeln, sonst HTML unverändert lassen
function toHtml(v) {
  if (v == null || v === '') return ''
  const s = String(v)
  if (/<[a-z][\s\S]*>/i.test(s)) return s
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
}

// Rich-Text-Editor: fett/kursiv/Überschrift/Liste, wächst automatisch mit dem Inhalt
function RichText({ value, onChange, onCommit, placeholder, readOnly }) {
  const ref = useRef(null)
  const cbRef = useRef({ onChange, onCommit })
  cbRef.current = { onChange, onCommit }
  const valueRef = useRef(value)
  valueRef.current = value
  // Nur wenn hier wirklich getippt/formatiert wurde, wird beim Verlassen gespeichert –
  // sonst würde reines Anklicken eine Änderung von jemand anderem mit dem alten Text überschreiben.
  const geaendert = useRef(false)
  useEffect(() => {
    const el = ref.current
    // Beim Mount UND bei externen Änderungen (Live-Sync, Umsortieren) setzen – aber nicht während des Tippens (fokussiert), sonst springt der Cursor
    if (el && document.activeElement !== el) el.innerHTML = toHtml(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  // Sicherung: schließt/wechselt man die App während des Tippens (ohne aus dem Feld zu klicken),
  // wird der aktuelle Inhalt sofort übernommen & gespeichert (v.a. iOS).
  useEffect(() => {
    if (readOnly) return
    const commit = () => {
      const el = ref.current
      if (el && geaendert.current) { geaendert.current = false; cbRef.current.onChange?.(el.innerHTML); cbRef.current.onCommit?.(el.innerHTML) }
    }
    const onVis = () => { if (document.visibilityState === 'hidden') commit() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', commit)
    // WICHTIG: auch beim Unmount (Panel schließen / Tab wechseln) den aktuellen Inhalt sichern
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', commit); commit() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const exec = (cmd, arg) => {
    document.execCommand(cmd, false, arg)
    geaendert.current = true
    if (ref.current) onChange(ref.current.innerHTML)
  }
  // Eingefügten Text bereinigen: Schriftgrößen/Farben/Fonts raus, nur einfache Struktur (fett/kursiv/Listen) bleibt
  const handlePaste = e => {
    e.preventDefault()
    const html = e.clipboardData?.getData('text/html')
    const plain = e.clipboardData?.getData('text/plain') || ''
    let out
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      doc.querySelectorAll('*').forEach(el => ['style', 'class', 'size', 'color', 'face', 'width', 'height'].forEach(a => el.removeAttribute(a)))
      out = doc.body.innerHTML
    } else {
      out = plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
    }
    document.execCommand('insertHTML', false, out)
    geaendert.current = true
    if (ref.current) onChange(ref.current.innerHTML)
  }
  const B = 'w-7 h-7 rounded-lg text-xs text-ink-2 hover:bg-black/5 active:scale-90 transition flex items-center justify-center'
  if (readOnly) {
    return <div className="rt-edit text-xs text-ink leading-relaxed px-3 py-2.5 border hairline bg-white/50 rounded-xl min-h-[2.5rem]"
      dangerouslySetInnerHTML={{ __html: toHtml(value) || '<span class="text-gray-300">—</span>' }} />
  }
  return (
    <div className="border hairline bg-white/70 rounded-xl overflow-hidden transition-shadow focus-within:border-[#ff6b01]/50 focus-within:shadow-[0_0_0_4px_rgba(255,107,1,0.12)] focus-within:bg-white">
      <div className="flex items-center gap-0.5 border-b hairline bg-white/40 px-1 py-1">
        <button type="button" title="Fett" onMouseDown={e => { e.preventDefault(); exec('bold') }} className={B} style={{ fontWeight: 700 }}>B</button>
        <button type="button" title="Kursiv" onMouseDown={e => { e.preventDefault(); exec('italic') }} className={B} style={{ fontStyle: 'italic' }}>I</button>
        <button type="button" title="Unterstreichen" onMouseDown={e => { e.preventDefault(); exec('underline') }} className={B} style={{ textDecoration: 'underline' }}>U</button>
        <button type="button" title="Überschrift an/aus" onMouseDown={e => { e.preventDefault(); const cur = (document.queryCommandValue('formatBlock') || '').replace(/[<>]/g, '').toLowerCase(); exec('formatBlock', cur === 'h3' ? 'div' : 'H3') }} className={B + ' font-bold'}>H</button>
        <button type="button" title="Liste" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList') }} className={B}>•</button>
        <button type="button" title="Formatierung entfernen" onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'DIV'); exec('removeFormat') }} className={B}>⌫</button>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning
        onInput={e => { geaendert.current = true; onChange(e.currentTarget.innerHTML) }}
        onPaste={handlePaste}
        onBlur={e => {
          if (geaendert.current) { geaendert.current = false; onChange(e.currentTarget.innerHTML); onCommit?.(e.currentTarget.innerHTML) }
          else e.currentTarget.innerHTML = toHtml(valueRef.current)   // nichts getippt → neuesten Stand anzeigen
        }}
        data-ph={placeholder || ''}
        className="rt-edit text-xs text-ink leading-relaxed px-3 py-2.5 outline-none min-h-[2.5rem]" />
    </div>
  )
}

// Textarea, die automatisch so hoch wird wie ihr Inhalt.
// Beim Anpassen der Höhe wird die Scroll-Position des Panels erhalten (sonst springt es beim Tippen nach unten).
function AutoTextarea({ className = '', value, onChange, ...rest }) {
  const ref = useRef(null)
  const fit = el => {
    if (!el) return
    const sc = el.closest('.overflow-y-auto')
    const top = sc ? sc.scrollTop : null
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
    if (sc && top != null) sc.scrollTop = top
  }
  useEffect(() => { fit(ref.current) }, [value])
  return (
    <textarea ref={ref} rows={1} value={value}
      onChange={e => { fit(e.target); onChange?.(e) }}
      className={className + ' resize-none overflow-hidden'} {...rest} />
  )
}

// Bilder/Dateien pro Video: Upload in Supabase Storage, Anzeige als Thumbnail/Link
// Mehrbenutzer-sicher: jede Datei wird einzeln angehängt/entfernt (onAdd/onRemove), nie die ganze Liste überschrieben.
function FileAttach({ files, onAdd, onRemove, prefix, readOnly }) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const isImg = n => /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i.test(n || '')
  const isPdf = n => /\.pdf$/i.test(n || '')
  async function upload(e) {
    const list = Array.from(e.target.files || [])
    if (!list.length) return
    setBusy(true)
    for (const f of list) {
      try {
        const safe = (f.name || 'datei').replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
        // Datei als Bytes lesen (auf iOS deutlich zuverlässiger als File direkt hochladen)
        const buf = await f.arrayBuffer()
        const { error } = await supabase.storage.from('dreh-dateien').upload(path, buf, {
          cacheControl: '3600', upsert: false, contentType: f.type || 'application/octet-stream',
        })
        if (error) { alert('Upload fehlgeschlagen: ' + error.message); continue }
        const { data } = supabase.storage.from('dreh-dateien').getPublicUrl(path)
        await onAdd?.({ url: data.publicUrl, name: f.name || safe, path })
      } catch (err) {
        alert('Upload fehlgeschlagen: ' + (err?.message || err))
      }
    }
    setBusy(false)
    e.target.value = ''
  }
  async function remove(i) {
    const f = files[i]
    if (!f) return
    // erst aus dem Dreh austragen, dann die Datei selbst löschen (so bleibt nie ein toter Link stehen)
    await onRemove?.(f)
    if (f.path) await supabase.storage.from('dreh-dateien').remove([f.path])
  }
  // Datei herunterladen: als Blob laden und mit richtigem Namen speichern (klappt auch cross-origin / iOS)
  async function download(f) {
    try {
      if (f.path) {
        const { data, error } = await supabase.storage.from('dreh-dateien').download(f.path)
        if (error || !data) throw error || new Error('leer')
        const url = URL.createObjectURL(data)
        const a = document.createElement('a')
        a.href = url; a.download = f.name || 'datei'
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
      } else {
        window.open(f.url, '_blank')
      }
    } catch {
      window.open(f.url, '_blank')   // Fallback
    }
  }
  return (
    <div className="space-y-2">
      {files?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={f.path || f.url || i} className="relative">
              {isImg(f.name) ? (
                <button type="button" onClick={() => setPreview(f)}><img src={f.url} alt={f.name} className="w-16 h-16 object-cover rounded-xl border border-white shadow-[0_4px_12px_-6px_rgba(0,0,0,0.35)]" /></button>
              ) : (
                <button type="button" onClick={() => setPreview(f)} className="flex items-center gap-1 text-xs text-[#c2410c] bg-[#ff6b01]/10 rounded-xl px-2.5 py-1.5 pr-6 max-w-[9rem] truncate">📄 {f.name}</button>
              )}
              <button onClick={() => download(f)} title="Herunterladen" className="absolute -bottom-1.5 -right-1.5 w-5 h-5 bg-white text-ink-2 rounded-full text-[9px] leading-none flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.18)] hover:text-ink">⬇</button>
              {!readOnly && <button onClick={() => remove(i)} title="Entfernen" className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#ff3b30] text-white rounded-full text-[11px] leading-none flex items-center justify-center shadow-[0_2px_6px_rgba(255,59,48,0.4)]">×</button>}
            </div>
          ))}
        </div>
      )}
      {!readOnly && <label className="dashed-add block text-center cursor-pointer !py-2 !rounded-xl">
        {busy ? 'Lädt hoch...' : '📎 Bild / Datei hinzufügen'}
        <input type="file" multiple className="hidden" onChange={upload} />
      </label>}

      {/* In-App-Vorschau (öffnet sich in der App, nicht im Browser) */}
      {preview && createPortal(
        <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col fade-up" onClick={() => setPreview(null)}>
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <span className="text-sm text-white/90 truncate mr-3">{preview.name}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => download(preview)} className="text-xs bg-white/15 text-white px-3 py-1.5 rounded-full font-medium hover:bg-white/25">⬇ Herunterladen</button>
              <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs text-white/70 underline">Im Browser</a>
              <button onClick={() => setPreview(null)} className="w-8 h-8 rounded-full bg-white/15 text-white text-lg flex items-center justify-center">×</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-2" onClick={e => e.stopPropagation()}>
            {isImg(preview.name) ? (
              <img src={preview.url} alt={preview.name} className="max-w-full max-h-full object-contain" />
            ) : isPdf(preview.name) ? (
              <iframe src={preview.url} title={preview.name} className="w-full h-full bg-white rounded-2xl" />
            ) : (
              <div className="text-center text-white/80 text-sm px-6">
                <p className="mb-4">Für diesen Dateityp gibt es keine Vorschau.</p>
                <a href={preview.url} target="_blank" rel="noreferrer" className="btn-primary inline-block">Datei öffnen</a>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default function Projekte() {
  const navigate = useNavigate()
  const { isExtern, isVideograph } = useAuth()
  const [tab, setTab] = useState('kunden')
  const [view, setView] = useState('kanban')
  const [drehs, setDrehs] = useState([])
  const [intern, setIntern] = useState([])
  const [kunden, setKunden] = useState([])
  const [darsteller, setDarsteller] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selected, setSelected] = useState(null)
  const [kundeFilter, setKundeFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showAddIntern, setShowAddIntern] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAddKunde, setShowAddKunde] = useState(false)
  const [showAddDarsteller, setShowAddDarsteller] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)
  const [selectedIntern, setSelectedIntern] = useState(null)
  const [geloeschte, setGeloeschte] = useState([])   // gelöschte Drehs (Papierkorb)

  useEffect(() => { fetchAll() }, [])
  // Direkt-Link aus dem Dashboard: /projekte?dreh=<id> öffnet den Dreh
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = params.get('dreh')
    if (!id || loading) return
    const d = drehs.find(x => x.id === id)
    if (d) { setSelected(d); setTab('kunden') }
    params.delete('dreh'); setParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, drehs.length])

  // Live-Aktualisierung: Änderungen anderer Nutzer sofort ins Board holen (leicht entprellt)
  useEffect(() => {
    let t
    const refresh = () => { clearTimeout(t); t = setTimeout(fetchAll, 400) }
    const ch = supabase.channel('projekte-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proj_drehs' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proj_intern' }, refresh)
      .subscribe()
    return () => { clearTimeout(t); supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchAll() {
    // kein setLoading(true) hier: sonst würde ein Refresh nach dem Speichern den
    // Lade-Spinner zeigen, das offene Detail-Panel abbauen und mit altem Stand neu aufbauen
    const [d, i, k, dar, p] = await Promise.all([
      supabase.from('proj_drehs').select('*').order('datum', { ascending: false }),
      supabase.from('proj_intern').select('*').order('created_at', { ascending: false }),
      supabase.from('proj_kunden').select('*').order('name'),
      supabase.from('crm_darsteller').select('id, name').order('name'),
      supabase.from('profiles').select('id, full_name, email, role, aktiv').order('full_name'),
    ])
    if (d.data) setDrehs(d.data)
    if (i.data) setIntern(i.data)
    if (k.data) setKunden(k.data)
    if (dar.data) setDarsteller(dar.data)
    if (p.data) setProfiles(p.data)
    setLoading(false)
    // Papierkorb: gelöschte Drehs (nur für Admin/MA lesbar)
    supabase.from('proj_verlauf').select('id, ref_id, snapshot, changed_at').eq('tabelle', 'proj_drehs').eq('aktion', 'delete').order('changed_at', { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setGeloeschte(data) })
  }

  async function restoreDreh(snap) {
    if (!snap?.id) return
    const { created_at, ...rest } = snap   // created_at neu setzen lassen
    await supabase.from('proj_drehs').insert({ ...rest })
    fetchAll()
  }

  // Status im geöffneten Dreh geändert: die Detailansicht speichert selbst (feldgenau) –
  // hier nur das Board sofort mitziehen, der Rest kommt per Live-Sync
  function updateDrehStatus(id, status) {
    setDrehs(prev => prev.map(d => d.id === id ? { ...d, status } : d))
  }

  // Löschen läuft über dreh_loeschen (Löschsperre in der DB) – Dreh + Kommentare landen im Papierkorb
  async function deleteDreh(id) {
    const { error } = await supabase.rpc('dreh_loeschen', { p_dreh_id: id, p_codewort: 'LOESCHEN' })
    if (error) { alert('Dreh konnte nicht gelöscht werden: ' + error.message); return }
    setSelected(null)
    fetchAll()
  }

  // Drag & Drop: Karte auf eine andere Status-Spalte ziehen
  async function handleDrop(status) {
    const id = draggingId
    setDraggingId(null); setDragOverCol(null)
    if (!id) return
    const dreh = drehs.find(d => d.id === id)
    if (!dreh || dreh.status === status) return
    if (BRAUCHT_RAW.includes(status) && !dreh.raw_gesichert) { alert(RAW_HINWEIS); return }
    if (status === 'abgeschlossen' && !istGesichert(dreh)) {
      alert('Erst RAW und Final auf NAS sichern (beide Häkchen im Dreh öffnen), dann auf „Abgeschlossen" ziehen.')
      return
    }
    setDrehs(prev => prev.map(d => d.id === id ? { ...d, status } : d))   // optimistisch
    const { error } = await supabase.rpc('dreh_felder_setzen', { p_tabelle: 'proj_drehs', p_id: id, p_felder: { status } })
    if (error) alert('Status konnte nicht gespeichert werden: ' + error.message)
    fetchAll()
  }

  // Videograph sieht keine abgeschlossenen Drehs (zusätzlich zur RLS-Sperre)
  const sichtbar = isVideograph ? drehs.filter(d => d.status !== 'abgeschlossen') : drehs
  const filtered = kundeFilter ? sichtbar.filter(d => d.kunde_name === kundeFilter) : sichtbar
  // Statusspalten/-buttons: Videograph ohne "Abgeschlossen"
  const visStatuses = isVideograph ? STATUSES.filter(s => s.id !== 'abgeschlossen') : STATUSES

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-7 h-7 border-[2.5px] border-[#ff6b01] border-t-transparent rounded-full animate-spin" /></div>

  // Externe (Videograf/Darsteller): aufgeräumte Liste ihrer anstehenden Drehs (Status "Dreh")
  if (isExtern) {
    return (
      <div className="px-4 pt-6 pb-4 md:p-8 space-y-4 max-w-2xl mx-auto">
        <div>
          <h1 className="page-title">Deine Drehs</h1>
          <p className="text-[13px] text-ink-2 mt-1.5">Anstehende Drehs deiner Kunden. Tippe einen Dreh für Details & Video-Planung.</p>
        </div>
        {drehs.length === 0 ? (
          <div className="card p-10 text-center text-sm text-gray-400">Aktuell keine Drehs für dich.</div>
        ) : (
          <div className="space-y-2">
            {drehs.map(dreh => {
              const ks = kundeStyle(dreh.kunde_name)
              return (
                <div key={dreh.id} onClick={() => setSelected(dreh)}
                  className="tile p-4 cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: ks.bg, color: ks.text }}>{dreh.kunde_name}</span>
                    <span className="text-[13px] font-medium text-ink">{dreh.datum ? new Date(dreh.datum).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '—'}</span>
                  </div>
                  <p className="text-xs text-ink-2 mt-2">{(dreh.videos?.length || dreh.video_count || 0)} Videos</p>
                </div>
              )
            })}
          </div>
        )}
        {selected && (
          <DrehDetail key={selected.id} dreh={selected} kunden={kunden} darsteller={darsteller} profiles={profiles} extern
            onClose={() => setSelected(null)}
            onStatusChange={s => updateDrehStatus(selected.id, s)}
            onRefresh={fetchAll}
          />
        )}
      </div>
    )
  }

  return (
    <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8 space-y-5">
      {/* Kopf + Tabs */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Projekte</h1>
          <p className="text-[13px] text-ink-2 mt-1.5">{sichtbar.filter(d => d.status !== 'abgeschlossen').length} laufende Drehs</p>
        </div>
        <div className="seg overflow-x-auto max-w-full">
          {[['kunden','Kunden-Drehs'],['intern','Intern'],['verwalten','Verwalten']].filter(([id]) => !(isVideograph && id === 'verwalten')).map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)} className={`seg-btn ${tab === id ? 'is-active' : ''}`}>{label}</button>
          ))}
        </div>
      </div>

      {/* KUNDEN */}
      {tab === 'kunden' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={kundeFilter} onChange={e => setKundeFilter(e.target.value)}
              className="input !w-auto !rounded-full !py-1.5 !pl-3.5 text-xs">
              <option value="">Alle Kunden</option>
              {kunden.map(k => <option key={k.id} value={k.name}>{k.name}</option>)}
            </select>
            <div className="seg">
              {[['kanban','Board'],['tabelle','Liste']].map(([v, l]) => (
                <button key={v} onClick={() => setView(v)} className={`seg-btn ${view === v ? 'is-active' : ''}`}>{l}</button>
              ))}
            </div>
            <button onClick={() => setShowAdd(true)} className="ml-auto btn-primary text-xs !py-2 !px-4">＋ Neuer Dreh</button>
          </div>

          {view === 'kanban' && (
            <div className="kanban-scroll">
              {visStatuses.map(st => {
                const cols = filtered.filter(d => d.status === st.id)
                return (
                  <div key={st.id}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverCol !== st.id) setDragOverCol(st.id) }}
                    onDrop={() => handleDrop(st.id)}
                    className={`lane w-full md:flex-1 md:min-w-[200px] md:max-w-[320px] ${dragOverCol === st.id && draggingId ? 'is-over' : ''}`}>
                    <div className="flex items-center justify-between mb-2.5 px-1.5 pt-0.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.8)]" style={{ background: st.color }} />
                        <span className="text-[13px] font-semibold text-ink">{st.label}</span>
                      </div>
                      <span className="text-[11px] font-semibold text-ink-2 bg-white/70 min-w-[22px] text-center px-1.5 py-0.5 rounded-full">{cols.length}</span>
                    </div>
                    <div className="space-y-2 min-h-8">
                      {cols.map(dreh => {
                        const ks = kundeStyle(dreh.kunde_name)
                        const gesichert = istGesichert(dreh)
                        return (
                        <div key={dreh.id}
                          draggable
                          onDragStart={e => { setDraggingId(dreh.id); e.dataTransfer.effectAllowed = 'move' }}
                          onDragEnd={() => { setDraggingId(null); setDragOverCol(null) }}
                          onClick={() => setSelected(dreh)}
                          className={`tile p-3.5 cursor-grab active:cursor-grabbing ${selected?.id === dreh.id ? '!border-[#ff6b01]/60' : ''} ${draggingId === dreh.id ? 'opacity-40' : ''}`}>
                          {(() => {
                            const vids = dreh.videos || []
                            const done = vids.filter(v => v.erledigt).length
                            const total = vids.length || dreh.video_count || 0
                            return (<>
                              <div className="flex items-start justify-between gap-2 mb-2">
                                {kundeFilter
                                  ? <p className="text-[13px] font-semibold text-ink leading-snug">{dreh.kunde_name}</p>
                                  : <span className="inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full leading-snug" style={{ background: ks.bg, color: ks.text }}>{dreh.kunde_name}</span>}
                              </div>
                              <p className="text-[13px] font-semibold text-ink tracking-tight">{dreh.datum ? new Date(dreh.datum).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : 'Kein Datum'}</p>
                              <div className="flex items-center gap-2 mt-2.5">
                                <div className="flex-1 h-1 rounded-full bg-black/[0.06] overflow-hidden">
                                  <div className="h-full rounded-full transition-all duration-500" style={{ width: total ? `${Math.round(done / total * 100)}%` : 0, background: st.color }} />
                                </div>
                                <span className="text-[11px] text-ink-2 tabular-nums">{done}/{total}</span>
                              </div>
                              {(() => {
                                const raw = ['planung', 'abnahme_kunde', 'dreh'].includes(dreh.status) ? deadlineInfo(dreh.deadline_raw, dreh.raw_gesichert) : null
                                const cut = ['dreh', 'cutting'].includes(dreh.status) ? deadlineInfo(dreh.deadline_cutting, false) : null
                                const cutter = profiles.find(p => p.id === dreh.cutter_id)
                                if (!raw && !cut && !cutter) return null
                                return (
                                  <div className="flex flex-wrap items-center gap-1 mt-2">
                                    {raw && <span className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full ${TON[raw.ton]}`}>RAW {raw.text}</span>}
                                    {cut && <span className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full ${TON[cut.ton]}`}>Cut {cut.text}</span>}
                                    {cutter && <span title={`Cutter: ${cutter.full_name}`} className="ml-auto w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#38b6ff,#ff6b01 55%,#7c3aed)' }}>{(cutter.full_name || '?')[0]}</span>}
                                  </div>
                                )
                              })()}
                            </>)
                          })()}
                          {(( !gesichert && ['dreh','cutting','posting'].includes(dreh.status)) || gesichert || (dreh.status === 'abnahme_kunde' && dreh.abnahme_bestaetigt)) && (
                            <div className="flex flex-wrap gap-1 mt-2.5">
                              {!gesichert && ['dreh','cutting','posting'].includes(dreh.status) && (
                                <span className="text-[11px] font-medium bg-[#ff3b30]/10 text-[#d70015] px-2 py-0.5 rounded-full">Sicherung fehlt</span>
                              )}
                              {gesichert && (
                                <span className="text-[11px] font-medium bg-[#34c759]/12 text-[#248a3d] px-2 py-0.5 rounded-full">✓ Gesichert</span>
                              )}
                              {dreh.status === 'abnahme_kunde' && dreh.abnahme_bestaetigt && (
                                <span className="text-[11px] font-medium bg-indigo-500/10 text-indigo-600 px-2 py-0.5 rounded-full">✓ Abgenommen</span>
                              )}
                            </div>
                          )}
                        </div>
                        )
                      })}
                      <button onClick={() => setShowAdd(true)} className="dashed-add">＋ Dreh</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {view === 'tabelle' && (
            <div className="card table-scroll overflow-hidden">
              <table className="w-full min-w-max">
                <thead className="border-b hairline">
                  <tr>
                    {['Datum','Kunde','Status','Videos','Darsteller','NAS'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-ink-3 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(dreh => (
                    <tr key={dreh.id} onClick={() => setSelected(dreh)}
                      className="border-b border-black/[0.04] last:border-0 hover:bg-white/60 cursor-pointer transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-800">{dreh.datum ? new Date(dreh.datum).toLocaleDateString('de-DE') : '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{dreh.kunde_name}</td>
                      <td className="px-4 py-3"><Pill status={dreh.status} /></td>
                      <td className="px-4 py-3 text-sm text-gray-600">{(dreh.videos?.length || dreh.video_count || 0)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{dreh.darsteller_name || '—'}</td>
                      <td className="px-4 py-3 text-sm">{dreh.nas_gesichert ? <span className="text-[#248a3d]">✓</span> : <span className="text-[#ff3b30]">✗</span>}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan="6" className="text-center py-10 text-sm text-gray-400">Keine Drehs</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* INTERN */}
      {tab === 'intern' && (
        <>
          <div className="flex justify-end">
            <button onClick={() => setShowAddIntern(true)} className="btn-primary text-xs !py-2 !px-4">＋ Neues Konzept</button>
          </div>
          <div className="kanban-scroll">
            {INTERN_STATUSES.map(st => {
              const cols = intern.filter(i => i.status === st.id)
              return (
                <div key={st.id} className="lane w-full md:flex-1 md:min-w-[200px] md:max-w-[320px]">
                  <div className="flex items-center justify-between mb-2.5 px-1.5 pt-0.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.8)]" style={{ background: st.color }} />
                      <span className="text-[13px] font-semibold text-ink">{st.label}</span>
                    </div>
                    <span className="text-[11px] font-semibold text-ink-2 bg-white/70 min-w-[22px] text-center px-1.5 py-0.5 rounded-full">{cols.length}</span>
                  </div>
                  <div className="space-y-2 min-h-8">
                    {cols.map(item => (
                      <div key={item.id} onClick={() => setSelectedIntern(item)} className="tile p-3.5 cursor-pointer">
                        <p className="text-[13px] font-semibold text-ink mb-1 tracking-tight">{item.titel}</p>
                        <p className="text-xs text-ink-2">{item.drehtag ? new Date(item.drehtag).toLocaleDateString('de-DE') : 'Kein Drehtag'}{item.zustaendig ? ` · ${item.zustaendig}` : ''}</p>
                      </div>
                    ))}
                    <button onClick={() => setShowAddIntern(true)} className="dashed-add">＋ Konzept</button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* VERWALTEN */}
      {tab === 'verwalten' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[15px] font-semibold text-ink">Kunden</h3>
              <button onClick={() => setShowAddKunde(true)} className="btn-primary text-xs !py-1.5 !px-3">＋ Neu</button>
            </div>
            <div className="space-y-0.5">
              {kunden.map(k => (
                <div key={k.id} className="flex items-center justify-between py-2.5 border-b border-black/[0.05] last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{k.name}</p>
                    {k.kontakt && <p className="text-xs text-gray-400">{k.kontakt}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button className="text-xs text-gray-500 hover:text-gray-700">Bearbeiten</button>
                    <button onClick={async () => { await supabase.from('proj_kunden').delete().eq('id', k.id); fetchAll() }} className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                  </div>
                </div>
              ))}
              {kunden.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">Noch keine Kunden</p>}
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[15px] font-semibold text-ink">Darsteller</h3>
              <button onClick={() => setShowAddDarsteller(true)} className="btn-primary text-xs !py-1.5 !px-3">＋ Neu</button>
            </div>
            <div className="space-y-0.5">
              {darsteller.map(d => (
                <div key={d.id} className="flex items-center justify-between py-2.5 border-b border-black/[0.05] last:border-0">
                  <p className="text-sm font-medium text-gray-800">{d.name}</p>
                  <div className="flex gap-2">
                    <button className="text-xs text-gray-500 hover:text-gray-700">Bearbeiten</button>
                    <button onClick={async () => { await supabase.from('crm_darsteller').delete().eq('id', d.id); fetchAll() }} className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                  </div>
                </div>
              ))}
              {darsteller.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">Noch keine Darsteller</p>}
            </div>
          </div>

          {/* Papierkorb: gelöschte Drehs wiederherstellen */}
          <div className="card p-5 md:col-span-2">
            <h3 className="text-[15px] font-semibold text-ink mb-1">Papierkorb</h3>
            <p className="text-xs text-ink-2 mb-3">Gelöschte Drehs – mit einem Tipp wiederherstellbar.</p>
            {(() => {
              const seen = new Set()
              const list = geloeschte
                .filter(g => !drehs.some(d => d.id === g.ref_id))
                .filter(g => { if (seen.has(g.ref_id)) return false; seen.add(g.ref_id); return true })
              if (list.length === 0) return <p className="text-xs text-gray-400 py-3 text-center">Keine gelöschten Drehs. Ab jetzt gelöschte Drehs landen hier und können wiederhergestellt werden.</p>
              return (
                <div className="space-y-0.5">
                  {list.map(g => {
                    const s = g.snapshot || {}
                    const anz = Array.isArray(s.videos) ? s.videos.length : 0
                    return (
                      <div key={g.id} className="flex items-center justify-between py-2.5 border-b border-black/[0.05] last:border-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{s.kunde_name || 'Dreh'}{s.datum ? ` · ${new Date(s.datum).toLocaleDateString('de-DE')}` : ''}</p>
                          <p className="text-[10px] text-gray-400">{anz} Video{anz === 1 ? '' : 's'} · gelöscht am {new Date(g.changed_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <button onClick={() => { if (window.confirm('Diesen Dreh wiederherstellen?')) restoreDreh(g.snapshot) }} className="text-xs bg-[#ff6b01]/10 text-[#c2410c] px-3 py-1.5 rounded-full font-medium hover:bg-[#ff6b01]/20 active:scale-95 transition whitespace-nowrap flex-shrink-0">Wiederherstellen</button>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {selected && (
        <DrehDetail key={selected.id} dreh={selected} kunden={kunden} darsteller={darsteller} profiles={profiles} videograph={isVideograph}
          onClose={() => setSelected(null)}
          onStatusChange={s => updateDrehStatus(selected.id, s)}
          onRefresh={fetchAll}
          onDelete={() => deleteDreh(selected.id)}
        />
      )}

      {/* Add Dreh Modal */}
      {showAdd && (
        <Modal title="Neuer Dreh" onClose={() => setShowAdd(false)}>
          <AddDrehForm kunden={kunden} darsteller={darsteller} profiles={profiles}
            onSave={async data => {
              // Angegebene Videoanzahl direkt als leere Video-Slots anlegen (max. 100 als Sicherung)
              const anzahl = Math.min(Math.max(parseInt(data.video_count) || 0, 0), 100)
              const videos = Array.from({ length: anzahl }, () => ({ titel: '', planung: '', datei_url: '', datei_name: '', dateien: [] }))
              await supabase.from('proj_drehs').insert(cleanDreh({ ...data, videos }))
              setShowAdd(false); fetchAll()
            }}
            onClose={() => setShowAdd(false)}
          />
        </Modal>
      )}

      {showAddKunde && (
        <Modal title="Neuer Kunde" onClose={() => setShowAddKunde(false)}>
          <AddKundeForm onSave={async data => { await supabase.from('proj_kunden').insert(data); setShowAddKunde(false); fetchAll() }} onClose={() => setShowAddKunde(false)} />
        </Modal>
      )}

      {showAddDarsteller && (
        <Modal title="Neuer Darsteller" onClose={() => setShowAddDarsteller(false)}>
          <AddDarstellerForm onSave={async data => { await supabase.from('crm_darsteller').insert(data); setShowAddDarsteller(false); fetchAll() }} onClose={() => setShowAddDarsteller(false)} />
        </Modal>
      )}

      {showAddIntern && (
        <Modal title="Neues Konzept (Intern)" onClose={() => setShowAddIntern(false)}>
          <AddInternForm profiles={profiles}
            onSave={async data => { await supabase.from('proj_intern').insert(data); setShowAddIntern(false); fetchAll() }}
            onClose={() => setShowAddIntern(false)} />
        </Modal>
      )}

      {selectedIntern && (
        <InternDetail key={selectedIntern.id} item={selectedIntern} profiles={profiles} videograph={isVideograph}
          onClose={() => setSelectedIntern(null)}
          onRefresh={fetchAll}
          onDelete={async () => { if (window.confirm('Konzept wirklich löschen?')) { await supabase.from('proj_intern').delete().eq('id', selectedIntern.id); setSelectedIntern(null); fetchAll() } }}
        />
      )}
    </div>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 scrim z-[70] flex items-end sm:items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className="glass-strong rounded-[28px] w-full max-w-sm max-h-[90vh] overflow-y-auto pop-in" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-2 flex items-center justify-between">
          <h3 className="text-[17px] font-semibold text-ink tracking-tight">{title}</h3>
          <button onClick={onClose} className="btn-icon w-7 h-7 text-base leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function AddDrehForm({ kunden, darsteller, profiles, onSave, onClose }) {
  const [form, setForm] = useState({ datum: '', kunde_id: '', kunde_name: '', zustaendig_id: '', video_count: 8, status: 'planung' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-3">
      <div><label className="label">Datum</label><input type="date" className="input" value={form.datum} onChange={e => set('datum', e.target.value)} /></div>
      <div>
        <label className="label">Kunde</label>
        <select className="input" value={form.kunde_id} onChange={e => {
          const k = kunden.find(k => k.id === e.target.value)
          setForm(p => ({ ...p, kunde_id: e.target.value, kunde_name: k?.name || '' }))
        }}>
          <option value="">Kunde wählen</option>
          {kunden.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Videograph</label>
        <select className="input" value={form.zustaendig_id} onChange={e => set('zustaendig_id', e.target.value)}>
          <option value="">Person wählen</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
        </select>
      </div>
      <div><label className="label">Geplante Videos</label><input type="number" className="input" value={form.video_count} onChange={e => set('video_count', parseInt(e.target.value) || 0)} min={1} /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => onSave(form)} className="btn-primary flex-1">Anlegen →</button>
      </div>
    </div>
  )
}

function AddKundeForm({ onSave, onClose }) {
  const [form, setForm] = useState({ name: '', kontakt: '', email: '' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-3">
      <div><label className="label">Name</label><input className="input" placeholder="Kundenname" value={form.name} onChange={e => set('name', e.target.value)} /></div>
      <div><label className="label">Kontakt (Telefon/E-Mail)</label><input className="input" placeholder="info@kunde.de" value={form.kontakt} onChange={e => set('kontakt', e.target.value)} /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => { if (form.name) onSave(form) }} className="btn-primary flex-1">Hinzufügen →</button>
      </div>
    </div>
  )
}

function AddDarstellerForm({ onSave, onClose }) {
  const [form, setForm] = useState({ name: '', telefon: '', email: '', status: 'neu' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-3">
      <div><label className="label">Name</label><input className="input" placeholder="Vor- und Nachname" value={form.name} onChange={e => set('name', e.target.value)} /></div>
      <div><label className="label">Telefon</label><input className="input" placeholder="+49..." value={form.telefon} onChange={e => set('telefon', e.target.value)} /></div>
      <div><label className="label">E-Mail</label><input className="input" type="email" placeholder="email@..." value={form.email} onChange={e => set('email', e.target.value)} /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => { if (form.name) onSave(form) }} className="btn-primary flex-1">Hinzufügen →</button>
      </div>
    </div>
  )
}

function AddInternForm({ profiles, onSave, onClose }) {
  const [form, setForm] = useState({ titel: '', drehtag: '', status: 'planung', zustaendig: '', video_planung: '', requisiten: '' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-3">
      <div><label className="label">Titel</label><input className="input" value={form.titel} onChange={e => set('titel', e.target.value)} placeholder="Konzept-Titel" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Drehtag</label><input type="date" className="input" value={form.drehtag} onChange={e => set('drehtag', e.target.value)} /></div>
        <div><label className="label">Status</label>
          <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
            {INTERN_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </div>
      <div><label className="label">Zuständig</label>
        <select className="input" value={form.zustaendig} onChange={e => set('zustaendig', e.target.value)}>
          <option value="">—</option>
          {profiles.map(p => <option key={p.id} value={p.full_name || p.email}>{p.full_name || p.email}</option>)}
        </select>
      </div>
      <div><label className="label">Video-Planung</label><textarea className="input" rows={3} value={form.video_planung} onChange={e => set('video_planung', e.target.value)} placeholder="Idee / Konzept..." /></div>
      <div><label className="label">Requisiten</label><textarea className="input" rows={2} value={form.requisiten} onChange={e => set('requisiten', e.target.value)} placeholder="Benötigtes Material..." /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
        <button onClick={() => { if (form.titel.trim()) onSave({ ...form, drehtag: form.drehtag || null, zustaendig: form.zustaendig || null }) }} className="btn-primary flex-1">Anlegen →</button>
      </div>
    </div>
  )
}

function InternDetail({ item, profiles, onClose, onRefresh, onDelete, videograph }) {
  const [tab, setTab] = useState('info')
  const ro = false   // Konzepte: Videograph & MA/Admin dürfen bearbeiten (Extern hat hier keinen Zugang)
  // Mehrbenutzer-sicher: feldgenau speichern (Videos über ihre feste id) + Live-Sync – siehe lib/useLiveDatensatz.js
  const live = useLiveDatensatz('proj_intern', item, { ro })
  const form = live.row
  const videos = form.videos || []
  const saving = live.speichert
  const backdropDown = useRef(false)
  const TEXTFELDER = ['titel', 'drehort', 'requisiten']
  const set = (k, v) => live.setFeld(k, v, { sofort: !TEXTFELDER.includes(k) })
  const persist = patch => { for (const [k, v] of Object.entries(patch)) live.setFeld(k, v, { sofort: true }) }
  function addVideo() { live.videoHinzufuegen() }
  function removeVideo(v, nr) { if (window.confirm(`Video ${nr} wirklich entfernen? Das kann nicht rückgängig gemacht werden.`)) live.videoEntfernen(v.id) }
  function toggleVideoDone(v) { live.videoErledigt(v.id, !v.erledigt) }
  function moveVideo(vonId, zuId) {
    const ids = videos.map(v => v.id)
    const a = ids.indexOf(vonId), b = ids.indexOf(zuId)
    if (a < 0 || b < 0) return
    const [it] = ids.splice(a, 1); ids.splice(b, 0, it)
    live.videosSortieren(ids)
  }

  return (
    <div className="fixed inset-0 scrim z-[60] flex md:p-3"
      onMouseDown={e => { backdropDown.current = e.target === e.currentTarget }}
      onClick={e => { if (e.target === e.currentTarget && backdropDown.current) onClose() }}>
      <div className="sheet-right glass-strong ml-auto w-full md:max-w-[480px] mt-[calc(env(safe-area-inset-top)+14px)] md:mt-0 h-auto md:h-full flex flex-col rounded-t-[28px] md:rounded-[28px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="md:hidden flex justify-center pt-2 pb-0.5 flex-shrink-0"><span className="w-9 h-[5px] rounded-full bg-black/15" /></div>
        <div className="px-5 pt-3 md:pt-5 pb-3 flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider">Intern{form.drehtag ? ' · ' + new Date(form.drehtag).toLocaleDateString('de-DE') : ''}</p>
            <p className="text-[22px] font-bold text-ink tracking-tight leading-tight mt-0.5 truncate">{form.titel || 'Konzept'}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <SpeicherStatus saving={saving} />
            {!videograph && <button onClick={() => onDelete?.()} title="Konzept löschen" className="btn-icon !text-[#ff3b30] hover:!bg-[#ff3b30]/10"><TrashIcon /></button>}
            <button onClick={onClose} title="Schließen" className="btn-icon text-base">×</button>
          </div>
        </div>
        <div className="px-5 pb-3 flex-shrink-0">
          <div className="tabbar">
            {['Info', 'Videos'].map(t => (
              <button key={t} onClick={() => setTab(t.toLowerCase())} className={tab === t.toLowerCase() ? 'is-active' : ''}>{t}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pt-1 pb-[calc(20px+env(safe-area-inset-bottom))] space-y-4 border-t hairline">
          <div className="h-2" />
          {live.hinweis && (
            <div className="bg-[#ff9f0a]/12 rounded-2xl px-3.5 py-2.5 text-xs text-[#9a5b00]">{live.hinweis}</div>
          )}
          {tab === 'info' && (
            <>
              <div><label className="label">Titel</label><input className="input text-xs" value={form.titel || ''} onChange={e => set('titel', e.target.value)}
                onFocus={() => live.setFokus('f:titel', true)} onBlur={() => { live.setFokus('f:titel', false); live.flush() }} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Drehtag</label><input type="date" className="input text-xs" value={form.drehtag || ''} onChange={e => set('drehtag', e.target.value)} /></div>
                <div><label className="label">Status</label>
                  <select className="input text-xs" value={form.status || 'planung'} onChange={e => set('status', e.target.value)}>
                    {INTERN_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="label">Zuständig</label>
                <select className="input text-xs" value={form.zustaendig || ''} onChange={e => set('zustaendig', e.target.value)}>
                  <option value="">—</option>
                  {profiles.map(p => <option key={p.id} value={p.full_name || p.email}>{p.full_name || p.email}</option>)}
                </select>
              </div>
              <div><label className="label">Drehort</label><RichText readOnly={ro} value={form.drehort || ''} onChange={val => set('drehort', val)} onCommit={val => persist({ drehort: val })} placeholder="Wo wird gedreht?" /></div>
              <div><label className="label">Requisiten</label><RichText readOnly={ro} value={form.requisiten || ''} onChange={val => set('requisiten', val)} onCommit={val => persist({ requisiten: val })} placeholder="Benötigtes Material..." /></div>
            </>
          )}
          {tab === 'videos' && (
            <>
              <VideoListe videos={videos} live={live} ro={ro} datensatzId={item.id} onToggleDone={toggleVideoDone} onRemove={removeVideo} onMove={moveVideo} />
              {!ro && <button onClick={addVideo} className="dashed-add">＋ Video hinzufügen</button>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DrehDetail({ dreh, kunden, darsteller, profiles, onClose, onStatusChange, onRefresh, onDelete, extern, videograph }) {
  const [tab, setTab] = useState('info')
  const ro = !!extern   // Nur-Lese nur für Darsteller (extern); Videograph darf bearbeiten, aber nicht löschen
  // Mehrbenutzer-sicher: jede Änderung wird feldgenau gespeichert (Videos über ihre feste id),
  // Änderungen anderer (auch Claude) kommen live an – siehe lib/useLiveDatensatz.js
  const live = useLiveDatensatz('proj_drehs', dreh, { ro })
  const form = live.row
  const videos = form.videos || []
  const saving = live.speichert
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const [nasWarn, setNasWarn] = useState(false)
  const [rawWarn, setRawWarn] = useState(false)
  const [recruitingOn, setRecruitingOn] = useState(!!(dreh.recruiting && String(dreh.recruiting).trim()))
  const backdropDown = useRef(false)      // nur schließen, wenn der Klick auch auf dem Hintergrund begann
  // Texte verzögert speichern, Auswahlfelder/Häkchen sofort
  const TEXTFELDER = ['erlaeuterungen_cutter', 'erlaeuterungen_videograph', 'requisiten', 'recruiting', 'dauer']
  const set = (k, v) => live.setFeld(k, v, { sofort: !TEXTFELDER.includes(k) })
  const persist = patch => { for (const [k, v] of Object.entries(patch)) live.setFeld(k, v, { sofort: true }) }

  useEffect(() => { fetchNotes() }, [dreh.id])
  // Kommentare live (z. B. wenn Claude oder jemand anderes kommentiert)
  useEffect(() => {
    const ch = supabase.channel(`notizen-${dreh.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proj_notizen', filter: `dreh_id=eq.${dreh.id}` }, () => fetchNotes())
      .subscribe()
    return () => supabase.removeChannel(ch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dreh.id])
  const [verlauf, setVerlauf] = useState([])
  useEffect(() => { if (tab === 'verlauf') loadVerlauf() /* eslint-disable-next-line */ }, [tab, dreh.id])
  async function loadVerlauf() {
    const { data } = await supabase.from('proj_verlauf').select('*').eq('tabelle', 'proj_drehs').eq('ref_id', dreh.id).order('changed_at', { ascending: false }).limit(60)
    setVerlauf(data || [])
  }
  const nameOf = uid => profiles.find(p => p.id === uid)?.full_name || 'jemand'
  function restoreVideos(snapVideos) {
    if (!window.confirm('Diesen früheren Video-Stand wiederherstellen? Der aktuelle Stand wird ersetzt (und im Verlauf gesichert).')) return
    live.videosErsetzen(snapVideos || [])
    setTab('videos')
  }

  async function fetchNotes() {
    const { data } = await supabase.from('proj_notizen').select('*').eq('dreh_id', dreh.id).order('created_at', { ascending: false })
    if (data) setNotes(data)
  }

  async function addNote() {
    if (!noteText.trim()) return
    await supabase.from('proj_notizen').insert({ dreh_id: dreh.id, text: noteText.trim() })
    setNoteText(''); fetchNotes()
  }

  function handleStatusChange(status) {
    if (BRAUCHT_RAW.includes(status) && !form.raw_gesichert) { setRawWarn(true); return }
    setRawWarn(false)
    if (status === 'abgeschlossen' && !(form.raw_gesichert && form.final_gesichert)) {
      // Ohne RAW+Final-Sicherung nicht abschließbar -> zurück auf Posting
      setNasWarn(true); live.setFelder({ status: 'posting' }); onStatusChange('posting'); return
    }
    setNasWarn(false)
    live.setFelder({ status })
    onStatusChange(status)
  }

  // Sicherung umschalten; wird ein Häkchen entfernt und der Dreh war "Abgeschlossen" -> zurück auf Posting
  function toggleSicherung(field, val) {
    const raw = field === 'raw_gesichert' ? val : !!form.raw_gesichert
    const fin = field === 'final_gesichert' ? val : !!form.final_gesichert
    const felder = { [field]: val, nas_gesichert: raw && fin }
    if (raw && fin) setNasWarn(false)
    else if (form.status === 'abgeschlossen') { felder.status = 'posting'; onStatusChange('posting'); setNasWarn(true) }
    live.setFelder(felder)
  }

  function addVideo() { live.videoHinzufuegen() }
  function removeVideo(v, nr) { if (window.confirm(`Video ${nr} wirklich entfernen? Das kann nicht rückgängig gemacht werden.`)) live.videoEntfernen(v.id) }
  // Abhaken: nur dieses eine Video (per id) – funktioniert für alle Rollen
  function toggleVideoDone(v) { live.videoErledigt(v.id, !v.erledigt) }
  // ▲▼: Video an die Stelle eines anderen Videos verschieben (per id)
  function moveVideo(vonId, zuId) {
    const ids = videos.map(v => v.id)
    const a = ids.indexOf(vonId), b = ids.indexOf(zuId)
    if (a < 0 || b < 0) return
    const [it] = ids.splice(a, 1); ids.splice(b, 0, it)
    live.videosSortieren(ids)
  }

  return (
    <div className="fixed inset-0 scrim z-[60] flex md:p-3"
      onMouseDown={e => { backdropDown.current = e.target === e.currentTarget }}
      onClick={e => { if (e.target === e.currentTarget && backdropDown.current) onClose() }}>
      <div className="sheet-right glass-strong ml-auto w-full md:max-w-[480px] mt-[calc(env(safe-area-inset-top)+14px)] md:mt-0 h-auto md:h-full flex flex-col rounded-t-[28px] md:rounded-[28px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="md:hidden flex justify-center pt-2 pb-0.5 flex-shrink-0"><span className="w-9 h-[5px] rounded-full bg-black/15" /></div>
        {/* Header */}
        <div className="px-5 pt-3 md:pt-5 pb-3 flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider truncate">{form.kunde_name}</p>
            <p className="text-[22px] font-bold text-ink tracking-tight leading-tight mt-0.5">{form.datum ? new Date(form.datum).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Dreh'}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <SpeicherStatus saving={saving} />
            {!extern && !videograph && <button onClick={() => { if (window.confirm(`Dreh „${dreh.kunde_name || ''}"${dreh.datum ? ' vom ' + new Date(dreh.datum).toLocaleDateString('de-DE') : ''} löschen?\n\nEr landet im Papierkorb (Tab „Verwalten") und kann wiederhergestellt werden.`)) onDelete?.() }}
              title="Dreh löschen"
              className="btn-icon !text-[#ff3b30] hover:!bg-[#ff3b30]/10"><TrashIcon /></button>}
            <button onClick={onClose} title="Schließen" className="btn-icon text-base">×</button>
          </div>
        </div>

        {/* Status row – für Darsteller (extern) ausgeblendet; Videograph ohne "Abgeschlossen" */}
        {!ro && (
        <div className="px-5 pb-3 flex gap-1.5 overflow-x-auto flex-shrink-0 [scrollbar-width:none]">
          {(videograph ? STATUSES.filter(s => s.id !== 'abgeschlossen') : STATUSES).map(s => {
            const an = form.status === s.id
            return (
              <button key={s.id} onClick={() => handleStatusChange(s.id)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-all duration-300 active:scale-95"
                style={an ? { background: s.color, color: '#fff', boxShadow: `0 6px 14px -6px ${s.color}` } : { background: s.bg, color: s.text }}>
                {s.label}
              </button>
            )
          })}
        </div>
        )}

        {rawWarn && (
          <div className="mx-5 mb-3 bg-[#ff9f0a]/15 rounded-2xl px-3.5 py-2.5 text-xs text-[#9a5b00] flex-shrink-0 fade-up">🔒 {RAW_HINWEIS}</div>
        )}
        {nasWarn && (
          <div className="mx-5 mb-3 bg-[#ff3b30]/10 rounded-2xl px-3.5 py-2.5 text-xs text-[#d70015] flex-shrink-0">
            🔒 Erst RAW und Final auf NAS sichern (beide Häkchen), dann „Abgeschlossen". Zurück auf Posting gesetzt.
          </div>
        )}

        {/* Tabs */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className="tabbar">
            {['Info','Videos','Kommentare',...(ro ? [] : ['Verlauf'])].map(t => (
              <button key={t} onClick={() => setTab(t.toLowerCase())} className={tab === t.toLowerCase() ? 'is-active' : ''}>{t}</button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pt-1 pb-[calc(20px+env(safe-area-inset-bottom))] space-y-4 border-t hairline">
          <div className="h-2" />
          {live.hinweis && (
            <div className="bg-[#ff9f0a]/12 rounded-2xl px-3.5 py-2.5 text-xs text-[#9a5b00]">{live.hinweis}</div>
          )}
          {tab === 'info' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Kunde</label>
                  <select className="input text-xs" value={form.kunde_id || ''} onChange={e => { const k = kunden.find(k => k.id === e.target.value); live.setFelder({ kunde_id: e.target.value, kunde_name: k?.name || '' }) }}>
                    {kunden.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Datum</label><input type="date" className="input text-xs" value={form.datum || ''} onChange={e => set('datum', e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Videograph (Dreh)</label>
                  <PersonAuswahl value={form.zustaendig_id} profiles={profiles} rollen={['videograph', 'admin']} disabled={ro}
                    onChange={v => set('zustaendig_id', v)} />
                </div>
                <div><label className="label">Cutter</label>
                  <PersonAuswahl value={form.cutter_id} profiles={profiles} rollen={['mitarbeiter', 'admin']} disabled={ro}
                    onChange={v => set('cutter_id', v)} />
                </div>
              </div>
              <div>
                <label className="label">Deadlines</label>
                <div className="rounded-2xl bg-white/60 border hairline divide-y divide-black/[0.06]">
                  <DeadlineZeile titel="RAW hochgeladen" unter="Videograph" wert={form.deadline_raw} fertig={!!form.raw_gesichert} disabled={ro}
                    onChange={v => set('deadline_raw', v)} />
                  <DeadlineZeile titel="Videos fertig & bei Metricool" unter="Cutter · an Kunden verschickt + vorgeladen" wert={form.deadline_cutting}
                    fertig={['posting', 'abgeschlossen'].includes(form.status)} disabled={ro}
                    onChange={v => set('deadline_cutting', v)} />
                </div>
                <p className="text-[11px] text-ink-3 mt-1.5 pl-0.5">Deadlines erscheinen automatisch als Aufgabe im Dashboard der zuständigen Person.</p>
              </div>
              <div>
                <label className="label">Sicherung</label>
                <div className="rounded-2xl bg-white/60 border hairline divide-y divide-black/[0.06]">
                  <SchalterZeile label="RAW auf NAS gesichert" an={!!form.raw_gesichert} onChange={v => toggleSicherung('raw_gesichert', v)} />
                  <SchalterZeile label="Final auf NAS gesichert" an={!!form.final_gesichert} onChange={v => toggleSicherung('final_gesichert', v)} />
                </div>
              </div>
              {form.status === 'abnahme_kunde' && (
                <div className="bg-indigo-500/[0.07] rounded-2xl p-3.5">
                  <p className="text-xs font-medium text-indigo-800 mb-1">Abnahme Kunde</p>
                  <p className="text-xs text-indigo-600 mb-2">Kunden-E-Mail für Abnahme auswählen:</p>
                  <select className="input text-xs mb-2">
                    <option>E-Mail aus Kundendaten</option>
                    {kunden.filter(k => k.kontakt?.includes('@')).map(k => <option key={k.id}>{k.kontakt}</option>)}
                  </select>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="checkbox" id="abnahme" checked={form.abnahme_bestaetigt || false} onChange={e => set('abnahme_bestaetigt', e.target.checked)} className="rounded" />
                    <label htmlFor="abnahme" className="text-xs text-indigo-700 cursor-pointer">Kunde hat Abnahme bestätigt</label>
                  </div>
                </div>
              )}
              <div><label className="label">Erläuterungen Videograph / Darsteller</label><RichText readOnly={ro} value={form.erlaeuterungen_videograph || ''} onChange={val => set('erlaeuterungen_videograph', val)} onCommit={val => persist({ erlaeuterungen_videograph: val })} placeholder="Hinweise für Videograph / Darsteller..." /></div>
              <div><label className="label">Erläuterungen Cutter</label><RichText readOnly={ro} value={form.erlaeuterungen_cutter || ''} onChange={val => set('erlaeuterungen_cutter', val)} onCommit={val => persist({ erlaeuterungen_cutter: val })} placeholder="Hinweise für den Cutter..." /></div>
              <div><label className="label">Requisiten</label><RichText readOnly={ro} value={form.requisiten || ''} onChange={val => set('requisiten', val)} onCommit={val => persist({ requisiten: val })} placeholder="Benötigte Requisiten..." /></div>
            </>
          )}

          {tab === 'videos' && (
            <>
              <VideoListe videos={videos} live={live} ro={ro} datensatzId={dreh.id} onToggleDone={toggleVideoDone} onRemove={removeVideo} onMove={moveVideo} />
              {!ro && <button onClick={addVideo} className="dashed-add">＋ Video hinzufügen</button>}

              {recruitingOn ? (
                <div className="bg-white/70 border border-white rounded-[20px] p-3.5">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[13px] font-semibold text-ink">Recruiting</span>
                    <button onClick={() => { setRecruitingOn(false); set('recruiting', '') }} className="text-xs text-ink-3 hover:text-[#ff3b30] transition-colors">Entfernen</button>
                  </div>
                  <RichText value={form.recruiting || ''} onChange={val => set('recruiting', val)} onCommit={val => persist({ recruiting: val })} placeholder="Recruiting / Casting-Bedarf..." />
                </div>
              ) : (
                <button onClick={() => setRecruitingOn(true)} className="dashed-add">＋ Recruiting-Bereich</button>
              )}
            </>
          )}

          {tab === 'kommentare' && (
            <>
              {notes.map(n => (
                <div key={n.id} className="flex gap-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0" style={{ background: 'linear-gradient(145deg,#ffb37a,#ff6b01)' }}>✎</div>
                  <div className="bg-white/75 border border-white rounded-[18px] rounded-tl-md px-3.5 py-2.5 flex-1 shadow-[0_4px_14px_-10px_rgba(30,30,60,0.3)]">
                    <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{n.text}</p>
                    <p className="text-[11px] text-ink-3 mt-1">{new Date(n.created_at).toLocaleDateString('de-DE')}</p>
                  </div>
                </div>
              ))}
              {notes.length === 0 && <p className="text-xs text-ink-3 text-center py-4">Noch keine Kommentare</p>}
              <div className="flex gap-2 mt-2 items-center">
                <input className="input text-xs flex-1 !rounded-full !px-4" value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Kommentar schreiben..." onKeyDown={e => e.key === 'Enter' && e.metaKey && addNote()} />
                <button onClick={addNote} title="Senden" className="btn-primary !w-10 !h-10 !p-0 flex-shrink-0">↑</button>
              </div>
            </>
          )}

          {tab === 'verlauf' && (
            <>
              <p className="text-xs text-ink-2 mb-1">Jede Änderung wird gesichert. Du kannst den Video-Stand eines früheren Zeitpunkts wiederherstellen.</p>
              {verlauf.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">Noch keine Änderungen aufgezeichnet.</p>
              ) : verlauf.map(h => {
                const anz = Array.isArray(h.videos) ? h.videos.length : 0
                return (
                  <div key={h.id} className="flex items-center gap-2 bg-white/65 border border-white rounded-2xl px-3.5 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700">{new Date(h.changed_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr</p>
                      <p className="text-[10px] text-gray-400">von {nameOf(h.changed_by)} · Stand: {anz} Video{anz === 1 ? '' : 's'}</p>
                    </div>
                    <button onClick={() => restoreVideos(h.videos)} className="text-xs bg-[#ff6b01]/10 text-[#c2410c] px-3 py-1.5 rounded-full font-medium hover:bg-[#ff6b01]/20 active:scale-95 transition whitespace-nowrap">Wiederherstellen</button>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Kleine UI-Bausteine (Apple-Stil) ─────────────────────────
function TrashIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7" />
    </svg>
  )
}

function SpeicherStatus({ saving }) {
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap transition-colors duration-300 ${saving ? 'bg-[#ff9f0a]/12 text-[#9a5b00]' : 'bg-[#34c759]/12 text-[#248a3d]'}`}>
      {saving ? 'Speichert…' : '✓ Gespeichert'}
    </span>
  )
}

// Runder Haken wie in Apple Erinnerungen
function Haken({ an, onClick }) {
  return (
    <button type="button" role="checkbox" aria-checked={an} onClick={e => { e.preventDefault(); onClick?.() }}
      className={`w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 active:scale-90 ${an ? 'bg-[#34c759] shadow-[0_3px_8px_-2px_rgba(52,199,89,0.6)]' : 'border-[1.5px] border-black/20 bg-white/60 hover:border-[#ff6b01]'}`}>
      {an && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
    </button>
  )
}

// iOS-Schalter-Zeile
function SchalterZeile({ label, an, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={an} onClick={() => onChange(!an)}
      className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left">
      <span className="text-[13px] text-ink">{label}</span>
      <span className={`relative w-[44px] h-[26px] rounded-full flex-shrink-0 transition-colors duration-300 ${an ? 'bg-[#34c759]' : 'bg-black/[0.12]'}`}>
        <span className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-transform duration-300 ${an ? 'translate-x-[18px]' : ''}`}
          style={{ transitionTimingFunction: 'cubic-bezier(0.32,0.72,0,1)' }} />
      </span>
    </button>
  )
}

// Videoliste: feste Nummern (Position im Dreh – Video 7 bleibt 7, auch abgehakt), erledigte unten,
// jedes Video einzeln ein-/ausklappbar (Zustand pro Dreh im Browser gemerkt)
function VideoListe({ videos, live, ro, datensatzId, onToggleDone, onRemove, onMove }) {
  // Standard: alle Videos zugeklappt. Gemerkt wird, welche offen sind – pro Dreh und Gerät,
  // bleibt also beim Hin- und Herwechseln, Schließen und Neuladen erhalten.
  const key = `os-offen-${datensatzId}`
  const [auf, setAuf] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() } })
  const aufRef = useRef(auf)
  aufRef.current = auf
  const merken = n => { aufRef.current = n; setAuf(n); try { localStorage.setItem(key, JSON.stringify([...n])) } catch { /* egal */ } }
  const umschalten = id => { const n = new Set(aufRef.current); n.has(id) ? n.delete(id) : n.add(id); merken(n) }
  // Neu hinzugefügte Videos direkt aufklappen, damit man gleich lostippen kann
  const bekannt = useRef(null)
  useEffect(() => {
    const ids = videos.map(v => v.id).filter(Boolean)
    if (bekannt.current === null) { bekannt.current = new Set(ids); return }
    const neu = ids.filter(id => !bekannt.current.has(id))
    ids.forEach(id => bekannt.current.add(id))
    if (neu.length) { const n = new Set(aufRef.current); neu.forEach(id => n.add(id)); merken(n) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.map(v => v.id).join(',')])
  const alleZu = videos.length > 0 && videos.every(v => !auf.has(v.id))
  // Anzeige: offene zuerst, erledigte unten – jeweils in fester Reihenfolge
  const ord = videos.map((_, k) => k).sort((a, b) => (videos[a].erledigt ? 1 : 0) - (videos[b].erledigt ? 1 : 0) || a - b)
  const offen = videos.filter(v => !v.erledigt).length
  return (
    <>
      {videos.length > 0 && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-ink-2">{offen} offen · {videos.length - offen} erledigt</span>
          <button onClick={() => merken(alleZu ? new Set(videos.map(v => v.id)) : new Set())}
            className="text-xs font-medium text-[#ff6b01] hover:text-[#e05f00] px-2 py-1 rounded-full hover:bg-[#ff6b01]/8 transition">
            {alleZu ? 'Alle ausklappen' : 'Alle einklappen'}
          </button>
        </div>
      )}
      {ord.map((i, p) => {
        const v = videos[i]
        const nr = i + 1
        const eingeklappt = !auf.has(v.id)
        // ▲▼ nur innerhalb der gleichen Gruppe (offen/erledigt)
        const vor = ord[p - 1] != null && !!videos[ord[p - 1]].erledigt === !!v.erledigt ? videos[ord[p - 1]] : null
        const nach = ord[p + 1] != null && !!videos[ord[p + 1]].erledigt === !!v.erledigt ? videos[ord[p + 1]] : null
        return (
          <div key={v.id || i} className={`rounded-[20px] border transition-all duration-300 ${eingeklappt ? 'px-3.5 py-2.5' : 'p-3.5'} ${v.erledigt ? 'bg-[#34c759]/[0.06] border-[#34c759]/15' : 'bg-white/70 border-white shadow-[0_6px_20px_-12px_rgba(30,30,60,0.25)]'}`}>
            <div className={`flex items-center justify-between gap-2 ${eingeklappt ? '' : 'mb-2.5'}`}>
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <Haken an={!!v.erledigt} onClick={() => onToggleDone(v)} />
                <button type="button" onClick={() => umschalten(v.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left" title={eingeklappt ? 'Ausklappen' : 'Einklappen'}>
                  <span className={`text-[13px] font-semibold tracking-tight whitespace-nowrap ${v.erledigt ? 'text-[#248a3d]' : 'text-ink'}`}>Video {nr}</span>
                  {v.erledigt && <span className="text-[10px] font-semibold text-[#248a3d] bg-[#34c759]/12 px-1.5 py-0.5 rounded-full">✓</span>}
                  {eingeklappt && <span className="text-[13px] text-ink-2 truncate">{v.titel || <span className="text-ink-3">Ohne Titel</span>}</span>}
                </button>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {!ro && !eingeklappt && <>
                  <button onClick={() => onMove(v.id, vor?.id)} disabled={!vor} title="Nach oben" className="w-7 h-7 rounded-full text-ink-2 hover:bg-black/5 active:scale-90 transition disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center text-[10px]">▲</button>
                  <button onClick={() => onMove(v.id, nach?.id)} disabled={!nach} title="Nach unten" className="w-7 h-7 rounded-full text-ink-2 hover:bg-black/5 active:scale-90 transition disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center text-[10px]">▼</button>
                  <button onClick={() => onRemove(v, nr)} title="Video entfernen" className="w-7 h-7 rounded-full text-ink-3 hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 active:scale-90 transition flex items-center justify-center"><TrashIcon size={14} /></button>
                </>}
                <button onClick={() => umschalten(v.id)} title={eingeklappt ? 'Ausklappen' : 'Einklappen'}
                  className="w-7 h-7 rounded-full text-ink-3 hover:bg-black/5 active:scale-90 transition flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
                    className={`transition-transform duration-300 ${eingeklappt ? '-rotate-90' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
                </button>
              </div>
            </div>
            {!eingeklappt && (
              <div className="fade-up">
                <AutoTextarea readOnly={ro} className="input text-xs mb-2" value={v.titel || ''}
                  onFocus={() => live.setFokus(`v:${v.id}:titel`, true)} onBlur={() => live.setFokus(`v:${v.id}:titel`, false)}
                  onChange={e => live.setVideoFeld(v.id, 'titel', e.target.value)} placeholder="Video-Titel..." />
                <div className="mb-2"><RichText readOnly={ro} value={v.planung || ''}
                  onChange={val => live.setVideoFeld(v.id, 'planung', val)}
                  onCommit={val => live.setVideoFeld(v.id, 'planung', val, { sofort: true })}
                  placeholder="Video-Planung / Konzept..." /></div>
                <FileAttach readOnly={ro} files={v.dateien || []} prefix={`${datensatzId}/${v.id}`}
                  onAdd={d => live.dateiAnhaengen(v.id, d)} onRemove={d => live.dateiEntfernen(v.id, d.path)} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// Auswahl einer Person nach Rolle (aktuelle Zuordnung bleibt sichtbar, auch wenn die Rolle nicht passt)
function PersonAuswahl({ value, profiles, rollen, onChange, disabled }) {
  const liste = profiles.filter(p => (rollen.includes(p.role) && p.aktiv !== false) || p.id === value)
  return (
    <select className="input text-xs" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value || null)}>
      <option value="">—</option>
      {liste.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
    </select>
  )
}

// Deadline mit Datum + Uhrzeit
function DeadlineZeile({ titel, unter, wert, fertig, onChange, disabled }) {
  const info = deadlineInfo(wert, fertig)
  return (
    <div className="px-3.5 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-ink">{titel}</p>
        <p className="text-[11px] text-ink-3 truncate">{unter}</p>
      </div>
      {info && <span className={`hidden sm:inline text-[10.5px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${TON[info.ton]}`}>{fertig ? '✓ erledigt' : info.ton === 'ueber' ? 'überfällig' : info.ton === 'bald' ? 'bald fällig' : 'offen'}</span>}
      <input type="datetime-local" disabled={disabled} className="input text-xs !w-[11.5rem] !py-1.5 flex-shrink-0"
        value={zuLokal(wert)} onChange={e => onChange(ausLokal(e.target.value))} />
    </div>
  )
}

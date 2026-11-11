// Live-Datensatz für Drehs (proj_drehs) und Konzepte (proj_intern):
// - Jede Änderung wird FELDGENAU über eine Datenbank-Funktion gespeichert (nie mehr das ganze videos-Array),
//   Videos werden über ihre feste id angesprochen → paralleles Arbeiten (auch Claude/MCP) überschreibt nichts.
// - Änderungen anderer kommen per Realtime sofort an. Felder, die man gerade bearbeitet (Fokus oder noch
//   nicht gespeicherte Eingabe), werden dabei nicht überschrieben.
// - Beim Zurückkehren in den Tab / nach Reconnect wird frisch geladen.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const VERZOEGERUNG = 700   // Texteingaben werden nach 0,7 s ohne Tippen gespeichert

export function useLiveDatensatz(tabelle, start, { ro = false } = {}) {
  const id = start.id
  const [row, setRowState] = useState(start)
  const rowRef = useRef(start)
  const setRow = r => { rowRef.current = typeof r === 'function' ? r(rowRef.current) : r; setRowState(rowRef.current) }
  const [laeuft, setLaeuft] = useState(0)        // Anzahl laufender Speichervorgänge
  const [hinweis, setHinweis] = useState('')
  const serverRef = useRef(start)                // letzter bekannter Serverstand
  const versionRef = useRef(start.version ?? 0)
  const dirty = useRef(new Map())                // key -> { wert, seq }  ('f:feld' | 'v:<videoId>:<feld>')
  const fokus = useRef(new Set())                // keys, die gerade fokussiert sind
  const timer = useRef(new Map())                // key -> setTimeout-Handle
  const ausstehend = useRef(new Map())           // key -> Funktion, die sofort speichert (für flush)
  const seq = useRef(0)
  const hinweisTimer = useRef(null)

  // Serverstand + eigene, noch offene Eingaben zusammenführen
  function zusammenfuehren(server) {
    const aktuell = rowRef.current || {}
    const out = { ...server }
    const videos = Array.isArray(server.videos) ? server.videos.map(v => ({ ...v })) : []
    const lokal = key => {
      if (dirty.current.has(key)) return { da: true, wert: dirty.current.get(key).wert }
      if (fokus.current.has(key)) {
        if (key.startsWith('f:')) return { da: true, wert: aktuell[key.slice(2)] }
        const [, vid, feld] = key.split(':')
        const v = (aktuell.videos || []).find(x => x.id === vid)
        return v ? { da: true, wert: v[feld] } : { da: false }
      }
      return { da: false }
    }
    for (const key of new Set([...dirty.current.keys(), ...fokus.current])) {
      const l = lokal(key)
      if (!l.da) continue
      if (key.startsWith('f:')) out[key.slice(2)] = l.wert
      else {
        const [, vid, feld] = key.split(':')
        const v = videos.find(x => x.id === vid)
        if (v) v[feld] = l.wert
      }
    }
    out.videos = videos
    return out
  }

  function serverStand(r, { erzwingen = false } = {}) {
    if (!r || typeof r !== 'object') return
    if (!erzwingen && (r.version ?? 0) < versionRef.current) return   // veraltetes Echo → ignorieren
    versionRef.current = r.version ?? 0
    serverRef.current = r
    setRow(zusammenfuehren(r))
  }

  const zeigeHinweis = text => {
    setHinweis(text)
    clearTimeout(hinweisTimer.current)
    hinweisTimer.current = setTimeout(() => setHinweis(''), 6000)
  }

  const neuLaden = useCallback(async () => {
    const { data } = await supabase.from(tabelle).select('*').eq('id', id).maybeSingle()
    if (data) serverStand(data, { erzwingen: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabelle, id])

  async function rpc(name, args) {
    setLaeuft(n => n + 1)
    try {
      const { data, error } = await supabase.rpc(name, { p_tabelle: tabelle, p_id: id, ...args })
      if (error) throw error
      serverStand(data)
      return data
    } catch (e) {
      if (e?.code === 'PV409') zeigeHinweis('Wurde gerade von jemand anderem geändert – neu geladen.')
      else if (e?.code === 'PV410') zeigeHinweis('Dieses Video wurde inzwischen von jemand anderem entfernt – neu geladen.')
      else zeigeHinweis('Speichern fehlgeschlagen: ' + (e?.message || e))
      await neuLaden()
      return null
    } finally {
      setLaeuft(n => n - 1)
    }
  }

  // Speichern eines Feldes planen (verzögert oder sofort); merkt sich, welche Eingabe gespeichert wurde
  function planen(key, speichern, sofort) {
    clearTimeout(timer.current.get(key))
    timer.current.delete(key)
    const lauf = async () => {
      timer.current.delete(key)
      ausstehend.current.delete(key)
      const d = dirty.current.get(key)
      if (!d) return
      await speichern(d.wert)
      // Nur als „gespeichert“ markieren, wenn inzwischen nicht weitergetippt wurde.
      // (Bei einem Fehler zeigt das Feld danach wieder den Serverstand – der Hinweis erklärt warum.)
      if (dirty.current.get(key)?.seq === d.seq) {
        dirty.current.delete(key)
        if (serverRef.current) setRow(zusammenfuehren(serverRef.current))
      }
    }
    ausstehend.current.set(key, lauf)
    if (sofort) lauf()
    else timer.current.set(key, setTimeout(lauf, VERZOEGERUNG))
  }

  function aktuellerWert(key) {
    const r = rowRef.current || {}
    if (key.startsWith('f:')) return r[key.slice(2)]
    const [, vid, feld] = key.split(':')
    return (r.videos || []).find(v => v.id === vid)?.[feld]
  }

  // ---------- öffentliche Funktionen ----------
  const setFeld = (feld, wert, { sofort = false } = {}) => {
    if (ro) return
    const key = 'f:' + feld
    if (!dirty.current.has(key) && aktuellerWert(key) === wert) return   // nichts geändert
    dirty.current.set(key, { wert, seq: ++seq.current })
    setRow(r => ({ ...r, [feld]: wert }))
    planen(key, w => rpc('dreh_felder_setzen', { p_felder: { [feld]: w } }), sofort)
  }

  // Mehrere Felder in einem Rutsch (z. B. Status + Sicherung) – sofort gespeichert
  const setFelder = async felder => {
    if (ro) return
    const seqs = {}
    for (const [k, v] of Object.entries(felder)) {
      const key = 'f:' + k
      clearTimeout(timer.current.get(key)); timer.current.delete(key); ausstehend.current.delete(key)
      seqs[k] = ++seq.current
      dirty.current.set(key, { wert: v, seq: seqs[k] })
    }
    setRow(r => ({ ...r, ...felder }))
    await rpc('dreh_felder_setzen', { p_felder: felder })
    for (const k of Object.keys(felder)) if (dirty.current.get('f:' + k)?.seq === seqs[k]) dirty.current.delete('f:' + k)
    if (serverRef.current) setRow(zusammenfuehren(serverRef.current))
  }

  const setVideoFeld = (videoId, feld, wert, { sofort = false } = {}) => {
    if (ro || !videoId) return
    const key = `v:${videoId}:${feld}`
    if (!dirty.current.has(key) && aktuellerWert(key) === wert) return
    dirty.current.set(key, { wert, seq: ++seq.current })
    setRow(r => ({ ...r, videos: (r.videos || []).map(v => v.id === videoId ? { ...v, [feld]: wert } : v) }))
    planen(key, w => rpc('video_feld_setzen', { p_video_id: videoId, p_feld: feld, p_wert: w }), sofort)
  }

  // Fokus melden: solange ein Feld fokussiert ist, überschreiben fremde Änderungen es nicht
  const setFokus = (key, an) => {
    if (an) fokus.current.add(key)
    else { fokus.current.delete(key); if (!dirty.current.has(key) && serverRef.current) setRow(zusammenfuehren(serverRef.current)) }
  }

  // Erledigt-Haken: auch für Darsteller (Nur-Lese) erlaubt
  const videoErledigt = (videoId, wert) => {
    setRow(r => ({ ...r, videos: (r.videos || []).map(v => v.id === videoId ? { ...v, erledigt: wert } : v) }))
    return rpc('video_erledigt_setzen', { p_video_id: videoId, p_wert: wert })
  }

  const videoHinzufuegen = (position = null) => ro ? null : rpc('video_hinzufuegen', { p_video: {}, p_position: position })

  const videoEntfernen = videoId => {
    if (ro) return null
    for (const key of [...dirty.current.keys()]) {
      if (key.startsWith(`v:${videoId}:`)) {
        clearTimeout(timer.current.get(key)); timer.current.delete(key); ausstehend.current.delete(key); dirty.current.delete(key)
      }
    }
    setRow(r => ({ ...r, videos: (r.videos || []).filter(v => v.id !== videoId) }))
    return rpc('video_entfernen', { p_video_id: videoId })
  }

  const videosSortieren = ids => {
    if (ro) return null
    setRow(r => {
      const nachId = new Map((r.videos || []).map(v => [v.id, v]))
      const sortiert = ids.map(i => nachId.get(i)).filter(Boolean)
      const rest = (r.videos || []).filter(v => !ids.includes(v.id))
      return { ...r, videos: [...sortiert, ...rest] }
    })
    return rpc('videos_sortieren', { p_video_ids: ids })
  }

  const dateiAnhaengen = (videoId, datei) => ro ? null : rpc('datei_anhaengen', { p_video_id: videoId, p_datei: datei })
  const dateiEntfernen = (videoId, path) => {
    if (ro) return null
    setRow(r => ({ ...r, videos: (r.videos || []).map(v => v.id === videoId ? { ...v, dateien: (v.dateien || []).filter(f => f.path !== path) } : v) }))
    return rpc('datei_entfernen', { p_video_id: videoId, p_path: path })
  }

  // Ganze Video-Liste ersetzen (Verlauf → wiederherstellen) – nur mit passender Version
  const videosErsetzen = videos => ro ? null : rpc('videos_ersetzen', { p_videos: videos, p_erwartete_version: versionRef.current })

  // Alles Ausstehende sofort speichern (Panel schließen, App in den Hintergrund)
  const flush = useCallback(() => {
    for (const lauf of [...ausstehend.current.values()]) lauf()
  }, [])

  // ---------- Realtime + frisch laden ----------
  useEffect(() => {
    let t = null
    let erstesMal = true
    const holen = () => { clearTimeout(t); t = setTimeout(neuLaden, 150) }
    const ch = supabase.channel(`live-${tabelle}-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: tabelle, filter: `id=eq.${id}` }, ({ new: neu }) => {
        // Große unveränderte Spalten fehlen evtl. im Event → dann komplett nachladen
        if (neu && Array.isArray(neu.videos) && neu.version != null) serverStand(neu)
        else holen()
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { if (!erstesMal) neuLaden(); erstesMal = false }
      })
    const beiRueckkehr = () => { if (document.visibilityState === 'visible') neuLaden() }
    const beiVerstecken = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', beiRueckkehr)
    document.addEventListener('visibilitychange', beiVerstecken)
    window.addEventListener('focus', beiRueckkehr)
    window.addEventListener('online', neuLaden)
    window.addEventListener('pagehide', flush)
    neuLaden()   // beim Öffnen sofort den aktuellen Stand holen
    return () => {
      clearTimeout(t)
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', beiRueckkehr)
      document.removeEventListener('visibilitychange', beiVerstecken)
      window.removeEventListener('focus', beiRueckkehr)
      window.removeEventListener('online', neuLaden)
      window.removeEventListener('pagehide', flush)
      flush()      // Panel schließen → Ausstehendes sofort speichern
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabelle, id])

  return {
    row, speichert: laeuft > 0, hinweis, neuLaden,
    setFeld, setFelder, setVideoFeld, setFokus,
    videoErledigt, videoHinzufuegen, videoEntfernen, videosSortieren,
    dateiAnhaengen, dateiEntfernen, videosErsetzen, flush,
  }
}

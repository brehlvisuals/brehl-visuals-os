// Metricool-Anbindung für die Seite „Kundenvideos“ (nur lesend).
// Der Metricool-API-Schlüssel liegt ausschließlich als Vercel-Umgebungsvariable vor (METRICOOL_USER_TOKEN),
// nie im Browser. Aufrufen darf nur, wer im OS als Admin oder Mitarbeiter angemeldet ist.
import { SB_URL, SB_KEY } from './_os.js'

const MC = 'https://app.metricool.com/api'
const TZ = 'Europe/Berlin'

async function angemeldetePerson(req) {
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` } })
  if (!u.ok) return null
  const user = await u.json()
  const p = await fetch(`${SB_URL}/rest/v1/profiles?select=role&id=eq.${user.id}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` } })
  const rows = p.ok ? await p.json() : []
  return { id: user.id, role: rows?.[0]?.role }
}

async function mc(pfad, params) {
  const q = new URLSearchParams({ ...params, userId: process.env.METRICOOL_USER_ID || '4565755' })
  const r = await fetch(`${MC}${pfad}?${q}`, { headers: { 'X-Mc-Auth': process.env.METRICOOL_USER_TOKEN, Accept: 'application/json' } })
  const text = await r.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!r.ok) throw new Error(`Metricool ${r.status}: ${typeof data === 'string' ? data.slice(0, 200) : (data?.message || data?.error || 'Fehler')}`)
  return data
}

// Beitrag auf das Nötige reduzieren
function schlank(p) {
  const prov = Array.isArray(p.providers) ? p.providers : []
  const st = prov.map(x => String(x.status || '').toUpperCase())
  const status = st.length && st.every(s => s === 'PUBLISHED') ? 'online'
    : st.some(s => s === 'PUBLISHED') ? 'teilweise'
    : st.some(s => ['ERROR', 'FAILED', 'REJECTED'].includes(s)) ? 'fehler'
    : 'geplant'
  const freigabe = p.postApprovalData?.approvalStatus || null   // pending | approved | rejected | null (ohne Freigabe-Prozess)
  return {
    id: p.id, uuid: p.uuid,
    datum: p.publicationDate?.dateTime || null,        // Ortszeit Berlin, ohne Offset
    text: String(p.text || '').split('\n')[0].slice(0, 140),
    titel: p.instagramData?.type ? (p.facebookData?.title || p.tiktokData?.title || p.youtubeData?.title || null) : (p.youtubeData?.title || null),
    status, freigabe,
    entwurf: !!p.draft,
    netzwerke: prov.map(x => ({ netz: x.network, status: x.status, url: x.publicUrl || null })),
    notizen: Array.isArray(p.notes) ? p.notes.filter(n => !n.deleted).length : 0,
    ungelesen: !!p.hasNotReadNotes,
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    const wer = await angemeldetePerson(req)
    if (!wer) return res.status(401).json({ fehler: 'Nicht angemeldet' })
    if (!['admin', 'mitarbeiter'].includes(wer.role)) return res.status(403).json({ fehler: 'Keine Berechtigung' })
    if (!process.env.METRICOOL_USER_TOKEN) return res.status(503).json({ fehler: 'METRICOOL_TOKEN_FEHLT' })

    const aktion = req.query.aktion || 'posts'

    if (aktion === 'marken') {
      const data = await mc('/admin/simpleProfiles', {})
      const liste = (Array.isArray(data) ? data : data?.data || []).map(b => ({ id: b.id, name: b.label, bild: b.picture || b.image || null }))
      return res.status(200).json({ marken: liste })
    }

    if (aktion === 'posts') {
      const marken = String(req.query.marken || '').split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)).slice(0, 40)
      const von = String(req.query.von || ''), bis = String(req.query.bis || '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) return res.status(400).json({ fehler: 'von/bis fehlen (YYYY-MM-DD)' })
      if (!marken.length) return res.status(200).json({ posts: {} })
      const ergebnis = {}, fehler = {}
      await Promise.all(marken.map(async id => {
        try {
          const data = await mc('/v2/scheduler/posts', { blogId: id, start: `${von}T00:00:00`, end: `${bis}T23:59:59`, timezone: TZ, extendedRange: 'false' })
          const liste = Array.isArray(data) ? data : (data?.data || [])
          ergebnis[id] = liste.map(schlank).filter(p => !p.entwurf)
        } catch (e) { fehler[id] = e.message }
      }))
      return res.status(200).json({ posts: ergebnis, fehler, abgerufen: new Date().toISOString() })
    }

    return res.status(400).json({ fehler: 'Unbekannte Aktion' })
  } catch (e) {
    return res.status(500).json({ fehler: e.message || String(e) })
  }
}

// Lexware Office (lexoffice) – nur lesend, nur für Admin.
// Der API-Schlüssel liegt ausschließlich als Vercel-Umgebungsvariable vor (LEXOFFICE_API_KEY), nie im Browser.
// Limit der API: 2 Anfragen/Sekunde → Anfragen nacheinander mit Pause, bei 429 kurz warten und wiederholen.
import { SB_URL, SB_KEY } from './_os.js'

const LX = 'https://api.lexware.io/v1'
const pause = ms => new Promise(r => setTimeout(r, ms))

async function istAdmin(req) {
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return false
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` } })
  if (!u.ok) return false
  const user = await u.json()
  const p = await fetch(`${SB_URL}/rest/v1/profiles?select=role&id=eq.${user.id}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` } })
  const rows = p.ok ? await p.json() : []
  return rows?.[0]?.role === 'admin'
}

async function lx(pfad, params = {}) {
  const url = `${LX}${pfad}?${new URLSearchParams(params)}`
  for (let versuch = 0; versuch < 4; versuch++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.LEXOFFICE_API_KEY}`, Accept: 'application/json' } })
    if (r.status === 429) { await pause(1200 * (versuch + 1)); continue }
    const text = await r.text()
    let data
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (!r.ok) throw new Error(`Lexware ${r.status}: ${typeof data === 'string' ? data.slice(0, 200) : (data?.message || data?.error || 'Fehler')}`)
    await pause(550)
    return data
  }
  throw new Error('Lexware: zu viele Anfragen, bitte gleich nochmal versuchen')
}

// Alle Belege einer Liste (seitenweise, max. 250 pro Seite)
async function alleBelege(voucherType, voucherStatus, von, bis) {
  const alle = []
  for (let page = 0; page < 40; page++) {
    const d = await lx('/voucherlist', { voucherType, voucherStatus, voucherDateFrom: von, voucherDateTo: bis, page, size: 250, sort: 'voucherDate,ASC' })
    alle.push(...(d?.content || []))
    if (d?.last !== false) break
  }
  return alle
}

const EINNAHMEN = 'salesinvoice,salescreditnote,invoice,creditnote'
const AUSGABEN = 'purchaseinvoice,purchasecreditnote'
const GUELTIG = 'open,paid,paidoff,transferred,sepadebit'   // ohne Entwürfe/Storno
const gutschrift = t => t === 'salescreditnote' || t === 'creditnote' || t === 'purchasecreditnote'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    if (!(await istAdmin(req))) return res.status(403).json({ fehler: 'Nur für Admin' })
    if (!process.env.LEXOFFICE_API_KEY) return res.status(503).json({ fehler: 'LEXOFFICE_KEY_FEHLT' })

    const jahr = /^\d{4}$/.test(String(req.query.jahr || '')) ? Number(req.query.jahr) : new Date().getFullYear()
    const von = `${jahr}-01-01`, bis = `${jahr}-12-31`

    const ein = await alleBelege(EINNAHMEN, GUELTIG, von, bis)
    const aus = await alleBelege(AUSGABEN, GUELTIG, von, bis)
    const ueberfaellig = await alleBelege('invoice,salesinvoice', 'overdue', `${jahr - 1}-01-01`, bis)

    const schlank = (b, art) => ({
      id: b.id, art, typ: b.voucherType, status: b.voucherStatus, nummer: b.voucherNumber || null,
      datum: (b.voucherDate || '').slice(0, 10), faellig: (b.dueDate || '').slice(0, 10) || null,
      kontakt: b.contactName || 'Sammelkunde', kontaktId: b.contactId || null,
      betrag: (gutschrift(b.voucherType) ? -1 : 1) * Number(b.totalAmount || 0),
      offen: b.openAmount == null ? null : Number(b.openAmount),
    })
    return res.status(200).json({
      jahr,
      belege: [...ein.map(b => schlank(b, 'einnahme')), ...aus.map(b => schlank(b, 'ausgabe'))],
      ueberfaellig: ueberfaellig.map(b => schlank(b, 'einnahme')),
      abgerufen: new Date().toISOString(),
    })
  } catch (e) {
    return res.status(500).json({ fehler: e.message || String(e) })
  }
}

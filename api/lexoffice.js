// Lexware Office (lexoffice) – nur lesend, nur für Admin.
// Der API-Schlüssel liegt ausschließlich als Vercel-Umgebungsvariable vor (LEXOFFICE_API_KEY), nie im Browser.
// Netto-Beträge gibt es nur in den Beleg-Details (1 Anfrage pro Beleg, Limit 2/Sek.) → Ergebnisse werden in
// os_finanz_belege gespeichert und nur neue/geänderte Belege nachgeladen („sync“, ggf. in mehreren Durchläufen).
import { SB_URL, SB_KEY } from './_os.js'

const LX = 'https://api.lexware.io/v1'
const pause = ms => new Promise(r => setTimeout(r, ms))
const BUDGET_MS = 48000

async function admin(req) {
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` } })
  if (!u.ok) return null
  const user = await u.json()
  const p = await fetch(`${SB_URL}/rest/v1/profiles?select=role&id=eq.${user.id}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` } })
  const rows = p.ok ? await p.json() : []
  return rows?.[0]?.role === 'admin' ? jwt : null
}

async function lx(pfad, params) {
  const url = `${LX}${pfad}${params ? '?' + new URLSearchParams(params) : ''}`
  for (let versuch = 0; versuch < 4; versuch++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.LEXOFFICE_API_KEY}`, Accept: 'application/json' } })
    if (r.status === 429) { await pause(1200 * (versuch + 1)); continue }
    const text = await r.text()
    let data
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    await pause(520)
    if (!r.ok) { const e = new Error(`Lexware ${r.status}: ${typeof data === 'string' ? data.slice(0, 160) : (data?.message || 'Fehler')}`); e.status = r.status; throw e }
    return data
  }
  throw new Error('Lexware: zu viele Anfragen, bitte gleich nochmal versuchen')
}

async function liste(voucherType, voucherStatus, von, bis) {
  const alle = []
  for (let page = 0; page < 40; page++) {
    const d = await lx('/voucherlist', { voucherType, voucherStatus, voucherDateFrom: von, voucherDateTo: bis, page, size: 250, sort: 'voucherDate,ASC' })
    alle.push(...(d?.content || []))
    if (d?.last !== false) break
  }
  return alle
}

const EINNAHMEN = ['salesinvoice', 'salescreditnote', 'invoice', 'creditnote']
const AUSGABEN = ['purchaseinvoice', 'purchasecreditnote']
const gutschrift = t => ['salescreditnote', 'creditnote', 'purchasecreditnote'].includes(t)

// Netto + Steuer aus den Details
async function details(b) {
  if (b.voucherType === 'invoice') {
    const d = await lx(`/invoices/${b.id}`); const t = d?.totalPrice || {}
    return { netto: Number(t.totalNetAmount), steuer: Number(t.totalTaxAmount) }
  }
  if (b.voucherType === 'creditnote') {
    const d = await lx(`/credit-notes/${b.id}`); const t = d?.totalPrice || {}
    return { netto: Number(t.totalNetAmount), steuer: Number(t.totalTaxAmount) }
  }
  const d = await lx(`/vouchers/${b.id}`)
  const brutto = Number(d?.totalGrossAmount), steuer = Number(d?.totalTaxAmount || 0)
  return { netto: brutto - steuer, steuer }
}

// Datum des (letzten) Geldeingangs/-ausgangs – nur bei bezahlten Belegen
const BEZAHLT = ['paid', 'paidoff']
async function zahlung(b) {
  const p = await lx(`/payments/${b.id}`)
  const daten = (p?.paymentItems || []).filter(i => i.paymentItemType !== 'cashDiscount').map(i => (i.postingDate || '').slice(0, 10)).filter(Boolean).sort()
  return daten[daten.length - 1] || (p?.paidDate || '').slice(0, 10) || null
}

async function sb(jwt, pfad, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${pfad}`, { ...opts, headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
  const text = await r.text()
  if (!r.ok) throw new Error(`DB ${r.status}: ${text.slice(0, 160)}`)
  return text ? JSON.parse(text) : null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  const start = Date.now()
  try {
    const jwt = await admin(req)
    if (!jwt) return res.status(403).json({ fehler: 'Nur für Admin' })
    if (!process.env.LEXOFFICE_API_KEY) return res.status(503).json({ fehler: 'LEXOFFICE_KEY_FEHLT' })
    const aktion = req.query.aktion || 'sync'

    if (aktion === 'ueberfaellig') {
      const heute = new Date(), j = heute.getFullYear()
      const l = await liste('invoice,salesinvoice', 'overdue', `${j - 1}-01-01`, `${j}-12-31`)
      return res.status(200).json({ ueberfaellig: l.map(b => ({ id: b.id, nummer: b.voucherNumber, kontakt: b.contactName, faellig: (b.dueDate || '').slice(0, 10), offen: Number(b.openAmount ?? b.totalAmount) })) })
    }

    if (aktion === 'sync') {
      const jahr = /^\d{4}$/.test(String(req.query.jahr || '')) ? Number(req.query.jahr) : new Date().getFullYear()
      const von = `${jahr}-01-01`, bis = `${jahr}-12-31`
      const lxBelege = [
        ...(await liste(EINNAHMEN.join(','), 'any', von, bis)).map(b => ({ ...b, art: 'einnahme' })),
        ...(await liste(AUSGABEN.join(','), 'any', von, bis)).map(b => ({ ...b, art: 'ausgabe' })),
      ]
      const vorhanden = await sb(jwt, `os_finanz_belege?select=id,lx_updated,netto,steuer,bezahlt_am&datum=gte.${von}&datum=lte.${bis}`)
      const stand = new Map((vorhanden || []).map(r => [r.id, r]))
      const zuTun = lxBelege.filter(b => {
        const s = stand.get(b.id)
        const ohneDetails = ['draft', 'voided'].includes(b.voucherStatus)
        return !s || (s.netto == null && !ohneDetails) || (BEZAHLT.includes(b.voucherStatus) && !s.bezahlt_am) || !s.lx_updated || new Date(s.lx_updated).getTime() < new Date(b.updatedDate).getTime()
      })
      const zeilen = []
      let fertig = 0
      for (const b of zuTun) {
        if (Date.now() - start > BUDGET_MS) break
        const vz = gutschrift(b.voucherType) ? -1 : 1
        const s = stand.get(b.id)
        const geaendert = !s || !s.lx_updated || new Date(s.lx_updated).getTime() < new Date(b.updatedDate).getTime()
        let netto = s?.netto ?? null, steuer = s?.steuer ?? null, bezahlt = s?.bezahlt_am ?? null, fehler = false
        // Entwürfe/Storno brauchen keine Details (zählen nicht)
        if (!['draft', 'voided'].includes(b.voucherStatus) && (geaendert || netto == null)) {
          try { const d = await details(b); netto = vz * d.netto; steuer = vz * d.steuer } catch { fehler = true }
        }
        if (BEZAHLT.includes(b.voucherStatus) && (geaendert || !bezahlt)) {
          try { bezahlt = (await zahlung(b)) || (b.updatedDate || '').slice(0, 10) || null } catch { fehler = true }
        } else if (!BEZAHLT.includes(b.voucherStatus)) bezahlt = null
        zeilen.push({
          id: b.id, art: b.art, typ: b.voucherType, status: b.voucherStatus, nummer: b.voucherNumber || null,
          datum: (b.voucherDate || '').slice(0, 10) || null, faellig: (b.dueDate || '').slice(0, 10) || null,
          kontakt: b.contactName || 'Sammelkunde', kontakt_id: b.contactId || null,
          brutto: vz * Number(b.totalAmount || 0), netto, steuer, offen: b.openAmount == null ? null : Number(b.openAmount), bezahlt_am: bezahlt,
          lx_updated: fehler ? null : b.updatedDate, synced_at: new Date().toISOString(),
        })
        fertig++
        if (zeilen.length >= 25) { await sb(jwt, 'os_finanz_belege', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(zeilen.splice(0)) }) }
      }
      if (zeilen.length) await sb(jwt, 'os_finanz_belege', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(zeilen) })
      // Status/Offen-Beträge der übrigen Belege aktuell halten (ohne Details, kostet nichts extra)
      const rest = lxBelege.filter(b => stand.has(b.id) && !zuTun.includes(b)).map(b => ({ id: b.id, art: b.art, status: b.voucherStatus, offen: b.openAmount == null ? null : Number(b.openAmount) }))
      for (let i = 0; i < rest.length; i += 200) {
        await sb(jwt, 'os_finanz_belege', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rest.slice(i, i + 200)) })
      }
      return res.status(200).json({ jahr, gesamt: lxBelege.length, neu: fertig, offen: zuTun.length - fertig })
    }

    return res.status(400).json({ fehler: 'Unbekannte Aktion' })
  } catch (e) {
    return res.status(500).json({ fehler: e.message || String(e) })
  }
}

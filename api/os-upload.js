// Datei-Upload per Einmal-Link (aus upload_link_erstellen): PUT/POST mit Rohdaten, ?t=<Ticket-Pfad>
import { rpc, uploadToStorage, contentTypeOf, MAX_BYTES } from './_os.js'

async function readRaw(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BYTES) throw new Error('Datei ist größer als 25 MB')
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['PUT', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Nur PUT oder POST' })
  const path = String(req.query.t || '')
  if (!path) return res.status(400).json({ error: 'Ticket fehlt' })
  try {
    const bytes = await readRaw(req)
    if (!bytes.length) return res.status(400).json({ error: 'Datei ist leer' })
    const url = await uploadToStorage(path, bytes, contentTypeOf(path))
    const result = await rpc('os_ticket_abschliessen', { p_path: path, p_url: url })
    return res.status(200).json(result)
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }
}

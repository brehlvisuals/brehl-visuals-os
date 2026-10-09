// Gemeinsame Helfer für den Claude-Connector (MCP) und den Datei-Upload per Link.
// Alle Datenzugriffe laufen über die DB-Funktion os_api (Schlüssel-geprüft, SECURITY DEFINER).
export const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://xbbiqubuvwxevxdxfyby.supabase.co'
export const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
export const BUCKET = 'dreh-dateien'
export const MAX_BYTES = 25 * 1024 * 1024

const headers = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` })

export async function rpc(fn, body) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!r.ok) throw new Error(data?.message || data?.error || text || `Fehler ${r.status}`)
  return data
}

export const osApi = (token, action, args = {}) => rpc('os_api', { p_token: token, p_action: action, p_args: args })

// Datei in den Storage legen (Pfad muss ein gültiges Upload-Ticket sein)
export async function uploadToStorage(path, bytes, contentType) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'false' },
    body: bytes,
  })
  if (!r.ok) throw new Error(`Upload fehlgeschlagen: ${await r.text()}`)
  return `${SB_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

export function contentTypeOf(name = '') {
  const ext = name.toLowerCase().split('.').pop()
  return ({
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', txt: 'text/plain', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg',
  })[ext] || 'application/octet-stream'
}

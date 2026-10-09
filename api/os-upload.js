// Datei-Upload per Einmal-Link (aus upload_link_erstellen), ?t=<Ticket-Pfad>
//  GET      → kleine Upload-Seite zum Antippen (Datei auswählen) – klappt ohne Claude-Sandbox
//  PUT/POST → Rohdaten im Body (z.B. curl -T datei.pdf "<link>"), optional &name=<Anzeigename>
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

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function page(info) {
  const ziel = info
    ? `<p class="ziel"><b>${esc(info.kunde)}</b> · ${esc(info.datum ? new Date(info.datum).toLocaleDateString('de-DE') : '')}<br>Video ${esc(info.video_nr)}${info.titel ? ` – ${esc(info.titel)}` : ''}</p>`
    : ''
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Datei hochladen · Brehl Visuals OS</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#f9fafb;color:#111827;margin:0;padding:24px 16px;display:flex;justify-content:center}
  .card{background:#fff;border:1px solid #f3f4f6;border-radius:16px;padding:24px;max-width:380px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .logo{width:36px;height:36px;border-radius:8px;background:#ff6b01;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
  h1{font-size:18px;margin:0 0 8px}.ziel{font-size:14px;color:#4b5563;line-height:1.5;margin:0 0 20px}
  label{display:block;background:#ff6b01;color:#fff;text-align:center;padding:14px;border-radius:10px;font-weight:600;cursor:pointer}
  input{display:none}#msg{margin-top:16px;font-size:14px;text-align:center;color:#4b5563}.ok{color:#15803d!important;font-weight:600}.err{color:#b91c1c!important}
</style></head><body><div class="card"><div class="logo">B</div>
${info ? `<h1>Datei hochladen</h1>${ziel}<label id="btn">Datei auswählen<input id="f" type="file"></label><p id="msg"></p>`
       : `<h1>Link nicht mehr gültig</h1><p class="ziel">Der Upload-Link ist abgelaufen oder wurde schon benutzt. Lass dir von Claude einen neuen erstellen.</p>`}
</div>
<script>
const f=document.getElementById('f'),msg=document.getElementById('msg'),btn=document.getElementById('btn');
if(f)f.onchange=async()=>{const file=f.files[0];if(!file)return;btn.style.display='none';msg.className='';msg.textContent='Wird hochgeladen …';
  try{const u=location.pathname+location.search+'&name='+encodeURIComponent(file.name);
    const r=await fetch(u,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Fehler');
    msg.className='ok';msg.textContent='✓ '+d.datei+' hängt jetzt an Video '+d.video_nr+'. Du kannst das Fenster schließen.';
  }catch(e){msg.className='err';msg.textContent='Fehler: '+e.message;btn.style.display='block'}};
</script></body></html>`
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const path = String(req.query.t || '')

  if (req.method === 'GET') {
    let info = null
    if (path) { try { info = await rpc('os_ticket_info', { p_path: path }) } catch { info = null } }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(info ? 200 : 410).send(page(info))
  }
  if (!['PUT', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Nur GET, PUT oder POST' })
  if (!path) return res.status(400).json({ error: 'Ticket fehlt' })
  try {
    const bytes = await readRaw(req)
    if (!bytes.length) return res.status(400).json({ error: 'Datei ist leer' })
    const name = req.query.name ? String(req.query.name) : null
    const headerType = String(req.headers['content-type'] || '')
    const type = headerType && headerType !== 'application/octet-stream' ? headerType : contentTypeOf(name || path)
    const url = await uploadToStorage(path, bytes, type)
    const result = await rpc('os_ticket_abschliessen', { p_path: path, p_url: url, p_name: name })
    return res.status(200).json(result)
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }
}

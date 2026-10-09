// Datei-Upload per Einmal-Link (aus upload_link_erstellen), ?t=<Ticket-Pfad>
//  GET      → kleine Upload-Seite zum Antippen (Datei auswählen) – klappt ohne Claude-Sandbox
//  GET ?g=  → Sammel-Seite für mehrere Dateien eines Drehs (aus upload_sammellink_erstellen)
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

// Sammel-Seite: alle Dateien eines Drehs auf einmal auswählen, Zuordnung per Dateiname
function sammelPage(info) {
  const head = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dateien hochladen · Brehl Visuals OS</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#f9fafb;color:#111827;margin:0;padding:24px 16px;display:flex;justify-content:center}
  .card{background:#fff;border:1px solid #f3f4f6;border-radius:16px;padding:20px;max-width:520px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .logo{width:36px;height:36px;border-radius:8px;background:#ff6b01;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
  h1{font-size:18px;margin:0 0 4px}.sub{font-size:14px;color:#4b5563;margin:0 0 16px}
  .big{display:block;background:#ff6b01;color:#fff;text-align:center;padding:14px;border-radius:10px;font-weight:600;cursor:pointer;margin-bottom:6px}
  .hint{font-size:12px;color:#9ca3af;text-align:center;margin:0 0 16px}
  .row{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #f3f4f6}
  .row .t{flex:1;min-width:0}.row .v{font-size:13px;font-weight:600}.row .f{font-size:12px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .st{font-size:12px;white-space:nowrap}.ok{color:#15803d;font-weight:600}.err{color:#b91c1c}.busy{color:#c2410c}
  .pick{font-size:12px;background:#fff7ed;color:#c2410c;border-radius:8px;padding:6px 10px;cursor:pointer;white-space:nowrap}
  input{display:none}#rest{font-size:13px;color:#b91c1c;margin-top:12px}
</style></head><body><div class="card"><div class="logo">B</div>`
  if (!info) return head + `<h1>Link nicht mehr gültig</h1><p class="sub">Dieser Upload-Link existiert nicht oder ist abgelaufen. Lass dir von Claude einen neuen erstellen.</p></div></body></html>`
  const datum = info.datum ? new Date(info.datum).toLocaleDateString('de-DE') : ''
  return head + `<h1>Dateien hochladen</h1><p class="sub"><b>${esc(info.kunde)}</b> · ${esc(datum)}</p>
<label class="big">Alle Dateien auswählen<input id="all" type="file" multiple></label>
<p class="hint">Mehrere auf einmal markieren. Sie werden per Dateiname dem richtigen Video zugeordnet.</p>
<div id="list"></div><p id="rest"></p></div>
<script>
const D=${JSON.stringify(info.dateien).replace(/</g, '\\u003c')};
const norm=s=>String(s||'').toLowerCase().replace(/\\.[a-z0-9]{2,5}$/,'').replace(/[^a-z0-9]/g,'');
const list=document.getElementById('list'),rest=document.getElementById('rest');
function render(){list.innerHTML='';D.forEach((d,i)=>{const r=document.createElement('div');r.className='row';
  const st=d.status||(d.offen?'':'✓ erledigt');const cls=d.cls||(d.offen?'':'ok');
  r.innerHTML='<div class="t"><div class="v">Video '+d.video_nr+(d.titel?' – '+esc(d.titel):'')+'</div><div class="f">'+esc(d.original||d.dateiname)+'</div></div>'
   +(st?'<span class="st '+cls+'">'+esc(st)+'</span>':'')
   +(d.offen&&!d.busy?'<label class="pick">Wählen<input type="file" data-i="'+i+'"></label>':'');
  list.appendChild(r)});
  list.querySelectorAll('input[data-i]').forEach(inp=>inp.onchange=()=>{const f=inp.files[0];if(f)up(+inp.dataset.i,f)})}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}
async function up(i,file){const d=D[i];d.busy=true;d.status='Lädt …';d.cls='busy';render();
  try{const r=await fetch(location.pathname+'?t='+encodeURIComponent(d.t)+'&name='+encodeURIComponent(file.name),{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
    const j=await r.json();if(!r.ok)throw new Error(j.error||'Fehler');d.offen=false;d.status='✓ hochgeladen';d.cls='ok'}
  catch(e){d.status='Fehler: '+e.message;d.cls='err'}d.busy=false;render()}
document.getElementById('all').onchange=async e=>{const files=[...e.target.files];const ohne=[];const jobs=[];
  for(const f of files){const n=norm(f.name);
    const i=D.findIndex((d,k)=>d.offen&&!d.busy&&!jobs.some(j=>j[0]===k)&&n&&(norm(d.original)===n||norm(d.dateiname)===n));
    if(i<0)ohne.push(f.name);else jobs.push([i,f])}
  // Genau eine offene Datei + genau eine unzugeordnete → einfach zuordnen
  const offen=D.map((d,k)=>k).filter(k=>D[k].offen&&!jobs.some(j=>j[0]===k));
  if(ohne.length===1&&offen.length===1){jobs.push([offen[0],files.find(f=>f.name===ohne[0])]);ohne.length=0}
  rest.textContent=ohne.length?'Nicht zugeordnet (bitte unten beim passenden Video einzeln wählen): '+ohne.join(', '):'';
  for(const [i,f] of jobs)await up(i,f);e.target.value=''};
render();
</script></body></html>`
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const path = String(req.query.t || '')

  if (req.method === 'GET' && req.query.g) {
    let info = null
    try { info = await rpc('os_sammel_info', { p_gruppe: String(req.query.g) }) } catch { info = null }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(info ? 200 : 410).send(sammelPage(info))
  }
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

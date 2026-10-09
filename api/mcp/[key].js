// Claude-Connector (MCP, Streamable HTTP, zustandslos).
// URL: https://brehl-visuals-os.vercel.app/api/mcp/<SCHLÜSSEL>  – der Schlüssel wird in der DB (os_api_tokens) geprüft.
import { osApi, uploadToStorage, contentTypeOf, MAX_BYTES, SB_KEY } from '../_os.js'

const BASE = 'https://brehl-visuals-os.vercel.app'

const INSTRUCTIONS = `Brehl Visuals OS – Drehplanung der Videoagentur Brehl Visuals.
Ablauf: Erst mit drehs_auflisten (z.B. nach kunde und Datum) den richtigen Dreh finden, dann dreh_lesen für die Details.
Videos sind ab 1 nummeriert (video_nr) wie in der App. Texte dürfen einfache HTML-Formatierung enthalten (<b>, <i>, <u>, <ul><li>), normaler Text mit Zeilenumbrüchen geht auch.
Bestehende Inhalte nie ungefragt ersetzen: Standard ist anhängen. Es gibt bewusst keine Lösch-Funktionen.
Immer diese Werkzeuge nutzen – nicht direkt per SQL oder Supabase in die Datenbank schreiben.
Dateien (PDF/Bilder), die der Nutzer im Chat schickt: ZUERST selbst hochladen – pro Datei upload_link_erstellen aufrufen und die Datei aus deiner Code-Umgebung mit curl -T "<datei>" "<upload_url>" hochladen (brehl-visuals-os.vercel.app ist freigegeben). Nur wenn das nicht klappt (Netzwerk gesperrt): EIN upload_sammellink_erstellen-Aufruf pro Dreh mit allen Dateien (inkl. original_dateiname = Name der Datei, wie der Nutzer sie hochgeladen hat, z.B. IMG_3818.jpeg) und dem Nutzer den EINEN Link geben. Er wählt dort alle Dateien auf einmal aus, sie werden per Dateiname dem richtigen Video zugeordnet. Das funktioniert immer, auch ohne Netzwerkzugriff deiner Code-Umgebung. Nur bei öffentlichen https-Links datei_anhaengen nutzen.`

const vNr = { type: 'integer', minimum: 1, description: 'Video-Nummer wie in der App (1 = erstes Video)' }
const drehId = { type: 'string', description: 'dreh_id aus drehs_auflisten' }

const TOOLS = [
  {
    name: 'kunden_auflisten', description: 'Alle Kunden im OS.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'drehs_auflisten',
    description: 'Drehs finden (ohne abgeschlossene). Liefert dreh_id, Datum, Kunde, Status, Darsteller und Videotitel.',
    inputSchema: {
      type: 'object', properties: {
        kunde: { type: 'string', description: 'Teil des Kundennamens, z.B. "Thüllen"' },
        ab_datum: { type: 'string', description: 'YYYY-MM-DD' },
        bis_datum: { type: 'string', description: 'YYYY-MM-DD' },
        status: { type: 'string', enum: ['planung', 'abnahme_kunde', 'dreh', 'cutting', 'posting', 'abgeschlossen'] },
        abgeschlossene_zeigen: { type: 'boolean' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'dreh_lesen', description: 'Alle Details eines Drehs: Infos, Videos mit Planung und Dateinamen, Kommentare.',
    inputSchema: { type: 'object', properties: { dreh_id: drehId }, required: ['dreh_id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'dreh_anlegen', description: 'Neuen Dreh anlegen (Status Planung, ohne Videos).',
    inputSchema: {
      type: 'object', properties: {
        kunde: { type: 'string', description: 'Kundenname (Teil reicht)' },
        datum: { type: 'string', description: 'YYYY-MM-DD' },
      }, required: ['kunde', 'datum'],
    },
  },
  {
    name: 'infos_setzen',
    description: 'Info-Felder eines Drehs füllen. Standard: an bestehenden Text anhängen.',
    inputSchema: {
      type: 'object', properties: {
        dreh_id: drehId,
        erlaeuterungen_cutter: { type: 'string', description: 'Erläuterungen für den Cutter' },
        erlaeuterungen_videograph: { type: 'string', description: 'Erläuterungen für Videograph/Darsteller' },
        requisiten: { type: 'string' },
        recruiting: { type: 'string' },
        dauer: { type: 'string', description: 'Drehdauer, z.B. "3 Std."' },
        modus: { type: 'string', enum: ['anhaengen', 'ersetzen'], default: 'anhaengen' },
      }, required: ['dreh_id'],
    },
  },
  {
    name: 'video_hinzufuegen', description: 'Neues Video zum Dreh hinzufügen (am Ende oder an Position video_nr).',
    inputSchema: {
      type: 'object', properties: {
        dreh_id: drehId, titel: { type: 'string' },
        planung: { type: 'string', description: 'Planung/Skript (Hook, Inhalt, CTA …)' },
        video_nr: { ...vNr, description: 'Optional: an dieser Position einfügen' },
      }, required: ['dreh_id', 'titel'],
    },
  },
  {
    name: 'video_bearbeiten', description: 'Titel und/oder Planung eines Videos ändern. Planung standardmäßig ersetzen, mit modus "anhaengen" ergänzen.',
    inputSchema: {
      type: 'object', properties: {
        dreh_id: drehId, video_nr: vNr, titel: { type: 'string' }, planung: { type: 'string' },
        modus: { type: 'string', enum: ['ersetzen', 'anhaengen'], default: 'ersetzen' },
      }, required: ['dreh_id', 'video_nr'],
    },
  },
  {
    name: 'kommentar_hinzufuegen', description: 'Kommentar in den Kommentare-Tab des Drehs schreiben.',
    inputSchema: { type: 'object', properties: { dreh_id: drehId, text: { type: 'string' } }, required: ['dreh_id', 'text'] },
  },
  {
    name: 'datei_anhaengen',
    description: 'Nur für sehr kleine Dateien (base64) oder öffentliche https-Links (url). Für Dateien, die der Nutzer im Chat geschickt hat, stattdessen upload_sammellink_erstellen verwenden.',
    inputSchema: {
      type: 'object', properties: {
        dreh_id: drehId, video_nr: vNr,
        dateiname: { type: 'string', description: 'z.B. "Skript.pdf"' },
        base64: { type: 'string', description: 'Dateiinhalt base64-kodiert' },
        url: { type: 'string', description: 'https-Link zur Datei' },
      }, required: ['dreh_id', 'video_nr', 'dateiname'],
    },
  },
  {
    name: 'upload_sammellink_erstellen',
    description: 'Standardweg für Dateien aus dem Chat: EIN Link für mehrere Dateien eines Drehs (24 Std. gültig). Der Nutzer öffnet ihn, wählt alle Dateien auf einmal aus, die Seite ordnet sie per Dateiname den Videos zu. Den Link dem Nutzer als anklickbaren Link geben.',
    inputSchema: {
      type: 'object', properties: {
        dreh_id: drehId,
        dateien: {
          type: 'array', minItems: 1, items: {
            type: 'object', properties: {
              video_nr: vNr,
              dateiname: { type: 'string', description: 'Sprechender Name für die Anzeige im OS, z.B. "Kommentar_Vorta.jpg"' },
              original_dateiname: { type: 'string', description: 'Exakter Dateiname, wie der Nutzer die Datei im Chat hochgeladen hat (z.B. "IMG_3818.jpeg") – wichtig für die automatische Zuordnung' },
            }, required: ['video_nr', 'dateiname'],
          },
        },
      }, required: ['dreh_id', 'dateien'],
    },
  },
  {
    name: 'upload_link_erstellen',
    description: 'Einzelne Datei: erstellt einen Einmal-Link (24 Std. gültig) für ein bestimmtes Video. Den Link dem Nutzer geben – er öffnet ihn, tippt „Datei auswählen“ und die Datei hängt am Video. Mehrere Dateien = mehrere Links. (Alternativ per HTTP PUT mit Rohdaten hochladbar.)',
    inputSchema: {
      type: 'object', properties: { dreh_id: drehId, video_nr: vNr, dateiname: { type: 'string' } },
      required: ['dreh_id', 'video_nr', 'dateiname'],
    },
  },
]

async function callTool(token, name, args = {}) {
  switch (name) {
    case 'kunden_auflisten':
    case 'drehs_auflisten':
    case 'dreh_lesen':
    case 'dreh_anlegen':
    case 'infos_setzen':
    case 'video_hinzufuegen':
    case 'video_bearbeiten':
    case 'kommentar_hinzufuegen':
      return osApi(token, name, args)

    case 'datei_anhaengen': {
      const { dreh_id, video_nr, dateiname, base64, url } = args
      let bytes
      if (base64) {
        bytes = Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64')
      } else if (url) {
        if (!/^https:\/\//i.test(url)) throw new Error('Nur https-Links sind erlaubt')
        const r = await fetch(url, { redirect: 'follow' })
        if (!r.ok) throw new Error(`Datei konnte nicht geladen werden (${r.status})`)
        bytes = Buffer.from(await r.arrayBuffer())
      } else {
        throw new Error('base64 oder url angeben')
      }
      if (!bytes.length) throw new Error('Datei ist leer')
      if (bytes.length > MAX_BYTES) throw new Error('Datei ist größer als 25 MB')
      const { path } = await osApi(token, 'upload_ticket', { dreh_id, video_nr, dateiname })
      const publicUrl = await uploadToStorage(path, bytes, contentTypeOf(dateiname))
      return osApi(token, 'datei_registrieren', { dreh_id, path, url: publicUrl })
    }

    case 'upload_sammellink_erstellen': {
      const r = await osApi(token, 'upload_sammel', args)
      return {
        upload_url: `${BASE}/api/os-upload?g=${r.gruppe}`,
        anzahl_dateien: r.anzahl,
        hinweis: 'Diesen EINEN Link dem Nutzer geben. Er wählt dort alle Dateien auf einmal aus. Gültig 24 Std.',
      }
    }

    case 'upload_link_erstellen': {
      const { path } = await osApi(token, 'upload_ticket', args)
      return {
        upload_url: `${BASE}/api/os-upload?t=${encodeURIComponent(path)}`,
        hinweis: 'Diesen Link dem Nutzer zum Antippen geben. Gültig 24 Std., nur einmal nutzbar.',
        beispiel: `curl -T "${args.dateiname}" "${BASE}/api/os-upload?t=${encodeURIComponent(path)}"`,
      }
    }

    default:
      throw new Error(`Unbekanntes Werkzeug ${name}`)
  }
}

function reply(id, result) { return { jsonrpc: '2.0', id, result } }
function fail(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } } }

async function handle(token, msg) {
  const { id, method, params } = msg || {}
  if (id === undefined || id === null) return null   // Benachrichtigungen (z.B. notifications/initialized)
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'brehl-visuals-os', title: 'Brehl Visuals OS', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: TOOLS })
    case 'tools/call': {
      try {
        const data = await callTool(token, params?.name, params?.arguments || {})
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: `Fehler: ${e.message}` }], isError: true })
      }
    }
    default:
      return fail(id, -32601, `Methode ${method} wird nicht unterstützt`)
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const token = req.query.key
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Nur POST (MCP Streamable HTTP)' })
  }
  if (!SB_KEY) return res.status(500).json(fail(null, -32603, 'Server nicht konfiguriert'))
  // Schlüssel einmal vorab prüfen, damit falsche URLs gar nicht erst Werkzeuge sehen
  try { await osApi(token, 'kunden_auflisten') } catch { return res.status(401).json(fail(null, -32001, 'Ungültiger Zugangsschlüssel')) }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || 'null') : req.body
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handle(token, m)))).filter(Boolean)
    return out.length ? res.status(200).json(out) : res.status(202).end()
  }
  const out = await handle(token, body)
  return out ? res.status(200).json(out) : res.status(202).end()
}

// Reine Rechen-Logik (ohne Supabase) – genutzt von der App UND vom Claude-Connector (api/mcp)
export const monatlich = p => p.rhythmus === 'jaehrlich' ? Number(p.betrag) / 12 : Number(p.betrag)

// Steuer nach Bändern auf den Jahresgewinn (Satz inkl. GewSt, wie in Felix' Excel) – nur noch zum Vergleich
export function steuerJahr(gewinnJahr, baender) {
  let rest = Math.max(0, gewinnJahr), steuer = 0, von = 0
  const zeilen = []
  for (const b of baender) {
    const bis = b.bis == null ? Infinity : Number(b.bis)
    const betrag = Math.max(0, Math.min(rest, bis - von))
    const s = betrag * Number(b.satz) / 100
    zeilen.push({ von, bis: b.bis, satz: Number(b.satz), betrag, steuer: s })
    steuer += s; rest -= betrag; von = bis
  }
  return { steuer, zeilen }
}

// ── Echter Tarif 2026 (Einzelunternehmer, Grundtabelle/ledig) ───────────────
// § 32a EStG 2026: Grundfreibetrag 12.348 €, Spitzensteuersatz 42 % ab 69.879 €, Reichensteuer 45 % ab 277.826 €
export function einkommensteuer2026(zvE) {
  const x = Math.floor(Math.max(0, zvE))
  let st
  if (x <= 12348) st = 0
  else if (x <= 17799) { const y = (x - 12348) / 10000; st = (914.51 * y + 1400) * y }
  else if (x <= 69878) { const z = (x - 17799) / 10000; st = (173.10 * z + 2397) * z + 1034.87 }
  else if (x <= 277825) st = 0.42 * x - 11135.63
  else st = 0.45 * x - 19470.38
  return Math.floor(st)
}
// Solidaritätszuschlag 2026: 5,5 %, erst wenn die ESt über 20.350 € liegt (mit Milderungszone)
export const soli2026 = est => est <= 20350 ? 0 : Math.min(est * 0.055, (est - 20350) * 0.119)

// Gewerbesteuer: Freibetrag 24.500 €, Messzahl 3,5 %, × Hebesatz der Gemeinde (Köln 475 %); 4-fache Messbetrag wird auf die ESt angerechnet (§ 35 EStG)
function steuerKern(gewinnJahr, opt) {
  const hebesatz = Number(opt.hebesatz ?? 475), kirche = Number(opt.kirche ?? 0), abzuege = Number(opt.abzuege ?? 0)
  const gewinn = Math.max(0, gewinnJahr)
  const messbetrag = Math.floor(Math.max(0, Math.floor(gewinn / 100) * 100 - 24500) * 0.035)
  const gewst = messbetrag * hebesatz / 100
  const zvE = Math.max(0, gewinn - abzuege)
  const estTarif = einkommensteuer2026(zvE)
  const anrechnung = Math.min(4 * messbetrag, gewst, estTarif)
  const est = estTarif - anrechnung
  const soli = soli2026(est)
  const kist = est * kirche / 100
  const gesamt = est + soli + kist + gewst
  return { zvE, messbetrag, estTarif, anrechnung, est, soli, kist, gewst, gesamt, quote: gewinn ? gesamt / gewinn : 0 }
}
export function steuerEcht(gewinnJahr, opt = {}) {
  const k = steuerKern(gewinnJahr, opt)
  return { ...k, grenzsatz: (steuerKern(gewinnJahr + 1000, opt).gesamt - k.gesamt) / 1000 }
}

export function steuerOptionen(einst) {
  return { modus: 'tarif', hebesatz: 475, kirche: 0, abzuege: 0, ...(einst?.steuer || {}) }
}
// Jahressteuer nach gewähltem Modus (Tarif = realistisch, Bänder = alte Excel-Logik)
export function jahresSteuer(gewinnJahr, einst) {
  const o = steuerOptionen(einst)
  const echt = steuerEcht(gewinnJahr, o)
  const baender = steuerJahr(gewinnJahr, einst?.steuerbaender || [])
  return { modus: o.modus, steuer: o.modus === 'baender' ? baender.steuer : echt.gesamt, echt, baender }
}

export function firmenwagenVorteil(e) {
  const f = e?.firmenwagen || {}
  return f.aktiv ? Number(f.listenpreis || 0) * Number(f.prozent || 0) / 100 : 0
}

// Monatsrechnung aus Umsatz/Kosten (Plan ODER Ist) – gleiche Logik für beide Seiten
export function monatsRechnung({ umsatz, business, lohn, privat, invest }, einst) {
  const fixkosten = business + lohn
  const gewinn = umsatz - fixkosten
  const vorteil = firmenwagenVorteil(einst)
  const st = jahresSteuer((gewinn + vorteil) * 12, einst)
  const steuerMonat = st.steuer / 12
  const ruecklage = steuerMonat * (1 + Number(einst?.sicherheit_prozent ?? 10) / 100)
  const nettogewinn = gewinn - ruecklage
  return {
    umsatz, business, lohn, fixkosten, gewinn, marge: umsatz ? gewinn / umsatz : 0, vorteil,
    gewinnJahrSteuer: (gewinn + vorteil) * 12, steuerJahr: st.steuer, steuer: st, steuerZeilen: st.baender.zeilen, steuerMonat, ruecklage,
    nettogewinn, privat, ueberschuss: nettogewinn - privat, invest, ueberschussNachInvest: nettogewinn - privat - invest,
  }
}

// Plan-Rechnung pro Monat (aus den Posten, wie die Excel)
export function planRechnung(posten, einst) {
  const summe = b => posten.filter(p => p.bereich === b && p.aktiv).reduce((s, p) => s + monatlich(p), 0)
  return monatsRechnung({ umsatz: summe('einnahme'), business: summe('business'), lohn: summe('lohn'), privat: summe('privat'), invest: summe('invest') }, einst)
}

// Lexware-Ausgaben einordnen: Zahlungen ans Finanzamt sind keine Betriebskosten (USt-/Steuer-Vorauszahlungen),
// Krankenkassen/Knappschaft = Sozialversicherung (Lohn-Nebenkosten)
export function ausgabenArt(kontakt) {
  const k = String(kontakt || '').toLowerCase()
  if (/finanzamt|steueramt|stadtkasse|bundeskasse|bundeszentralamt/.test(k)) return 'finanzamt'
  if (/krankenkasse|gesundheitskasse|\baok\b|techniker|barmer|\bdak\b|\bikk\b|\bbkk\b|\bhkk\b|knappschaft|minijob|berufsgenossenschaft|\bbg\b|sozialversicherung/.test(k)) return 'sozial'
  return 'betrieb'
}

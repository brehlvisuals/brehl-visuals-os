// Reine Rechen-Logik (ohne Supabase) – genutzt von der App UND vom Claude-Connector (api/mcp)
export const monatlich = p => p.rhythmus === 'jaehrlich' ? Number(p.betrag) / 12 : Number(p.betrag)

// Steuer nach Bändern auf den Jahresgewinn (Satz inkl. GewSt, wie in der Excel)
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

export function firmenwagenVorteil(e) {
  const f = e?.firmenwagen || {}
  return f.aktiv ? Number(f.listenpreis || 0) * Number(f.prozent || 0) / 100 : 0
}

// Plan-Rechnung pro Monat (Übersicht wie in der Excel)
export function planRechnung(posten, einst) {
  const summe = b => posten.filter(p => p.bereich === b && p.aktiv).reduce((s, p) => s + monatlich(p), 0)
  const umsatz = summe('einnahme'), business = summe('business'), lohn = summe('lohn'), privat = summe('privat'), invest = summe('invest')
  const fixkosten = business + lohn
  const gewinn = umsatz - fixkosten
  const vorteil = firmenwagenVorteil(einst)
  const st = steuerJahr((gewinn + vorteil) * 12, einst?.steuerbaender || [])
  const steuerMonat = st.steuer / 12
  const ruecklage = steuerMonat * (1 + Number(einst?.sicherheit_prozent ?? 10) / 100)
  const nettogewinn = gewinn - ruecklage
  return {
    umsatz, business, lohn, fixkosten, gewinn, marge: umsatz ? gewinn / umsatz : 0, vorteil,
    gewinnJahrSteuer: (gewinn + vorteil) * 12, steuerJahr: st.steuer, steuerZeilen: st.zeilen, steuerMonat, ruecklage,
    nettogewinn, privat, ueberschuss: nettogewinn - privat, invest, ueberschussNachInvest: nettogewinn - privat - invest,
  }
}

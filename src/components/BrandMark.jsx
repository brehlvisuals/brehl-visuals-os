// Brehl-Visuals-Logo als Vektor: Kreis, diagonal geteilt, Verlauf Blau → Orange → Lila (Farben aus logo.svg der Webseite)
import { useId } from 'react'

const BLAU = '#38b6ff', ORANGE = '#ff6b01', LILA = '#7c3aed'

export function BrandMark({ size = 32, className = '', gap = 2.2 }) {
  const uid = useId().replace(/:/g, '')
  const cx = 50, cy = 50, r = 47
  const a = 35 * Math.PI / 180
  const dx = Math.cos(a), dy = -Math.sin(a)        // Richtung der Trennlinie (unten links → oben rechts)
  const nx = -Math.sin(a), ny = -Math.cos(a)       // Normale (zeigt nach oben links)
  const p = (k, m) => `${cx + dx * k + nx * m},${cy + dy * k + ny * m}`
  const oben = `${p(-100, gap / 2)} ${p(100, gap / 2)} ${p(100, 100)} ${p(-100, 100)}`
  const unten = `${p(-100, -gap / 2)} ${p(100, -gap / 2)} ${p(100, -100)} ${p(-100, -100)}`
  const x1 = cx - dx * r, y1 = cy - dy * r, x2 = cx + dx * r, y2 = cy + dy * r
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`go${uid}`} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
          <stop offset="0" stopColor={BLAU} /><stop offset="0.5" stopColor={ORANGE} /><stop offset="1" stopColor={LILA} />
        </linearGradient>
        <linearGradient id={`gu${uid}`} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
          <stop offset="0" stopColor={LILA} /><stop offset="0.5" stopColor={ORANGE} /><stop offset="1" stopColor={BLAU} />
        </linearGradient>
        <clipPath id={`co${uid}`}><polygon points={oben} /></clipPath>
        <clipPath id={`cu${uid}`}><polygon points={unten} /></clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#go${uid})`} clipPath={`url(#co${uid})`} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#gu${uid})`} clipPath={`url(#cu${uid})`} />
    </svg>
  )
}

// Wortmarke wie im Logo: „brehl“ fett, „visuals“ leicht, darunter rechtsbündig
export function BrandWordmark({ markSize = 34, className = '', textClass = 'text-ink' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <BrandMark size={markSize} />
      <div className={`leading-none ${textClass}`} style={{ fontFamily: "'Poppins', -apple-system, system-ui, sans-serif" }}>
        <div className="font-bold tracking-[-0.03em]" style={{ fontSize: markSize * 0.62 }}>brehl</div>
        <div className="font-light text-right tracking-[0.01em] -mt-0.5" style={{ fontSize: markSize * 0.36 }}>visuals</div>
      </div>
    </div>
  )
}

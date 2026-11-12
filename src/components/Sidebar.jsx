import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'
import { BrandMark, BrandWordmark } from './BrandMark'

// Tasks, Prozess Kunde und Kunden-Journal sind bewusst ausgeblendet (werden nicht genutzt, Daten bleiben erhalten)
const NAV = [
  { section: 'Übersicht', items: [
    { to: '/dashboard', icon: 'home', label: 'Dashboard' },
  ]},
  { section: 'Arbeit', items: [
    { to: '/projekte', icon: 'film', label: 'Projekte', mod: 'projekte' },
    { to: '/kundenvideos', icon: 'play', label: 'Kundenvideos' },
    { to: '/crm', icon: 'people', label: 'CRM', anyMod: ['crm', 'crm_darsteller'] },
    { to: '/meine-stunden', icon: 'clock', label: 'Meine Stunden', externOnly: true },
  ]},
  { section: 'Zeit', items: [
    { to: '/zeiterfassung', icon: 'clock', label: 'Zeiterfassung' },
    { to: '/urlaub', icon: 'sun', label: 'Urlaub' },
    { to: '/auswertung', icon: 'chart', label: 'Auswertung' },
    { to: '/kalender', icon: 'calendar', label: 'Kalender' },
  ]},
  { section: 'Admin', items: [
    { to: '/team', icon: 'team', label: 'Team', adminOnly: true },
    { to: '/papierkorb', icon: 'trash', label: 'Papierkorb', adminOnly: true },
    { to: '/einstellungen', icon: 'settings', label: 'Einstellungen' },
  ]},
]

const MOBILE_NAV = [
  { to: '/dashboard', m: 'home', label: 'Home' },
  { to: '/zeiterfassung', m: 'clock', label: 'Zeit' },
  { to: '/urlaub', m: 'sun', label: 'Urlaub' },
  { to: '/kalender', m: 'calendar', label: 'Kalender' },
]

// Einheitliche Strich-Icons (SF-Symbols-Anmutung)
export function MIcon({ name, size = 22, stroke = 1.8 }) {
  const svgProps = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const p = {
    home: <><path d="M3 10.7 12 4l9 6.7" /><path d="M5.5 9.5V20h13V9.5" /></>,
    clock: <><circle cx="12" cy="12" r="8.2" /><path d="M12 7.8V12l2.6 1.6" /></>,
    sun: <><circle cx="12" cy="12" r="3.8" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" /></>,
    calendar: <><rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M3.5 9.2h17M8 3v3.2M16 3v3.2" /></>,
    grid: <><rect x="3.8" y="3.8" width="6.7" height="6.7" rx="1.8" /><rect x="13.5" y="3.8" width="6.7" height="6.7" rx="1.8" /><rect x="3.8" y="13.5" width="6.7" height="6.7" rx="1.8" /><rect x="13.5" y="13.5" width="6.7" height="6.7" rx="1.8" /></>,
    film: <><rect x="3" y="5" width="13" height="14" rx="3" /><path d="m16 10 5-3v10l-5-3" /></>,
    people: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.6a3 3 0 0 1 0 5.8M17.5 14.2A5 5 0 0 1 20.5 19" /></>,
    team: <><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    dots: <><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
    play: <><rect x="3" y="4" width="18" height="16" rx="4" /><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7" /></>,
    logout: <><path d="M14.5 4.5H18a1.8 1.8 0 0 1 1.8 1.8v11.4A1.8 1.8 0 0 1 18 19.5h-3.5" /><path d="M10 8l-4 4 4 4M6.2 12H16" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  }
  return <svg {...svgProps}>{p[name]}</svg>
}

function TabItem({ to, icon, label, active, badge }) {
  return (
    <NavLink to={to}
      className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full rounded-full transition-colors duration-200 ${active ? 'text-[#ff6b01]' : 'text-[#6e6e73]'}`}>
      {active && <span className="absolute inset-x-1 inset-y-1 rounded-full bg-white/80 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)]" />}
      <span className="relative"><MIcon name={icon} size={21} /></span>
      {badge > 0 && <span className="absolute top-1 right-[22%] bg-[#ff3b30] text-white text-[9px] font-semibold rounded-full min-w-[15px] h-[15px] px-1 flex items-center justify-center">{badge}</span>}
      <span className="relative text-[10px] font-medium leading-none">{label}</span>
    </NavLink>
  )
}

export default function Sidebar() {
  const { profile, isAdmin, isExtern, isVideograph, isRestricted, isMinijob, canAccess, canDashboard, signOut } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [badges, setBadges] = useState({ urlaub: 0, zeit: 0, minijob: 0 })
  const location = useLocation()
  const name = profile?.full_name || profile?.email?.split('@')[0] || 'User'
  const rolle = isAdmin ? 'Admin' : isVideograph ? 'Videograph' : isExtern ? 'Extern' : 'Mitarbeiter'

  useEffect(() => { setMobileMenuOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!isAdmin || !profile?.id) { setBadges({ urlaub: 0, zeit: 0, minijob: 0 }); return }
    let alive = true
    Promise.all([
      supabase.from('urlaubsantraege').select('id', { count: 'exact', head: true }).eq('status', 'offen').neq('user_id', profile.id),
      supabase.from('zeit_aenderungsantraege').select('id', { count: 'exact', head: true }).eq('status', 'offen'),
      supabase.from('minijob_stunden').select('id', { count: 'exact', head: true }).eq('status', 'offen'),
    ]).then(([u, z, m]) => { if (alive) setBadges({ urlaub: u.count || 0, zeit: z.count || 0, minijob: m.count || 0 }) })
    return () => { alive = false }
  }, [isAdmin, profile?.id, location.pathname])

  const badgeFor = to => to === '/urlaub' ? badges.urlaub : to === '/zeiterfassung' ? badges.zeit : to === '/auswertung' ? badges.minijob : 0
  const isActive = to => location.pathname === to || location.pathname.startsWith(to + '/')

  const sichtbar = item => {
    if (item.to === '/dashboard') return canDashboard
    if (item.externOnly && !isMinijob) return false
    // Videograph erfasst Stunden über „Meine Stunden“ (Minijob) – Zeiterfassung/Urlaub/Auswertung gelten für Angestellte
    if (isVideograph && ['/zeiterfassung', '/urlaub', '/auswertung'].includes(item.to)) return false
    if (item.to === '/meine-stunden' && profile?.zeiterfassung === false) return false   // reiner Planungszugang ohne Stunden
    if (isRestricted && !item.externOnly && !['/projekte', '/einstellungen'].includes(item.to)) return false
    if (item.adminOnly && !isAdmin) return false
    if (item.mod && !canAccess(item.mod)) return false
    if (item.anyMod && !item.anyMod.some(m => canAccess(m))) return false
    return true
  }

  return (
    <>
      {/* Desktop: schwebende Glas-Sidebar */}
      <aside className="desktop-sidebar w-60 flex-shrink-0 h-screen sticky top-0 p-3 pr-0">
        <div className="glass h-full rounded-[28px] flex flex-col overflow-hidden">
          {/* Logo */}
          <div className="px-5 pt-6 pb-4">
            <BrandWordmark markSize={34} textClass="text-[#333]" />
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 pb-3 overflow-y-auto">
            {NAV.map((group, gi) => {
              const items = group.items.filter(sichtbar)
              if (!items.length) return null
              return (
                <div key={gi} className="mb-1">
                  {group.section && <div className="text-[11px] font-semibold text-ink-3 px-3 pt-3 pb-1.5">{group.section}</div>}
                  {items.map(item => {
                    const active = isActive(item.to)
                    return (
                      <NavLink key={item.to} to={item.to}
                        className={`group relative flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] transition-colors duration-200 ${active ? 'text-ink font-semibold' : 'text-ink-2 hover:text-ink hover:bg-white/45'}`}>
                        {active && <span className="absolute inset-0 rounded-xl bg-white/85 shadow-[0_4px_14px_-6px_rgba(30,30,60,0.25)]" />}
                        <span className={`relative ${active ? 'text-[#ff6b01]' : ''}`}><MIcon name={item.icon} size={19} stroke={active ? 2 : 1.8} /></span>
                        <span className="relative flex-1">{item.label}</span>
                        {badgeFor(item.to) > 0 && <span className="relative bg-[#ff3b30] text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center">{badgeFor(item.to)}</span>}
                      </NavLink>
                    )
                  })}
                </div>
              )
            })}
          </nav>

          {/* Nutzer */}
          <div className="m-3 mt-0 p-2.5 rounded-2xl bg-white/50 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#38b6ff,#ff6b01 55%,#7c3aed)' }}>
              {name[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink truncate">{name}</div>
              <div className="text-[11px] text-ink-3">{rolle}</div>
            </div>
            <button onClick={signOut} title="Ausloggen" className="btn-icon w-8 h-8"><MIcon name="logout" size={16} /></button>
          </div>
        </div>
      </aside>

      {/* Mobile: schwebende Glas-Tab-Leiste */}
      <nav className="mobile-nav fixed left-3 right-3 safe-bottom-gap z-50 h-[64px] rounded-full glass px-1.5">
        <div className="flex items-stretch w-full h-full py-1">
          {isRestricted ? (
            <>
              {canDashboard && <TabItem to="/dashboard" icon="home" label="Home" active={isActive('/dashboard')} />}
              <TabItem to="/projekte" icon="film" label="Drehs" active={isActive('/projekte')} />
              {profile?.zeiterfassung !== false && <TabItem to="/meine-stunden" icon="clock" label="Stunden" active={isActive('/meine-stunden')} />}
              <TabItem to="/einstellungen" icon="settings" label="Profil" active={isActive('/einstellungen')} />
              <button onClick={signOut} className="flex flex-col items-center justify-center gap-0.5 flex-1 text-[#6e6e73]">
                <MIcon name="logout" size={21} />
                <span className="text-[10px] font-medium leading-none">Logout</span>
              </button>
            </>
          ) : (
            <>
              {(isVideograph
                ? [{ to: '/dashboard', m: 'home', label: 'Home' }, { to: '/projekte', m: 'film', label: 'Drehs' }, ...(profile?.zeiterfassung !== false ? [{ to: '/meine-stunden', m: 'clock', label: 'Stunden' }] : []), { to: '/kalender', m: 'calendar', label: 'Kalender' }]
                : MOBILE_NAV).map(i => (i.to === '/dashboard' && !canDashboard) ? { to: '/projekte', m: 'film', label: 'Projekte' } : i).map(item => <TabItem key={item.to} to={item.to} icon={item.m} label={item.label} active={isActive(item.to)} badge={badgeFor(item.to)} />)}
              <button onClick={() => setMobileMenuOpen(o => !o)}
                className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 rounded-full transition-colors ${mobileMenuOpen ? 'text-[#ff6b01]' : 'text-[#6e6e73]'}`}>
                {mobileMenuOpen && <span className="absolute inset-x-1 inset-y-1 rounded-full bg-white/80 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)]" />}
                <span className="relative"><MIcon name="dots" size={21} /></span>
                <span className="relative text-[10px] font-medium leading-none">Mehr</span>
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Mobile: „Mehr“-Sheet */}
      {mobileMenuOpen && (
        <div className="mobile-nav fixed inset-0 z-40 scrim" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute left-3 right-3 bottom-[calc(84px+env(safe-area-inset-bottom))] glass-strong rounded-[28px] p-3 pop-in"
            onClick={e => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-2">
              {[
                ...(!isVideograph ? [{ to: '/auswertung', icon: 'chart', label: 'Auswertung' }] : []),
                ...(canAccess('projekte') ? [{ to: '/projekte', icon: 'film', label: 'Projekte' }] : []),
                { to: '/kundenvideos', icon: 'play', label: 'Kundenvideos' },
                ...((canAccess('crm') || canAccess('crm_darsteller')) ? [{ to: '/crm', icon: 'people', label: 'CRM' }] : []),
                ...(isAdmin ? [{ to: '/team', icon: 'team', label: 'Team' }, { to: '/papierkorb', icon: 'trash', label: 'Papierkorb' }] : []),
                { to: '/einstellungen', icon: 'settings', label: 'Einstellungen' },
              ].map(item => (
                <NavLink key={item.to} to={item.to} onClick={() => setMobileMenuOpen(false)}
                  className={`flex flex-col items-center gap-1.5 py-3.5 rounded-2xl active:scale-95 transition-transform ${isActive(item.to) ? 'bg-white text-[#ff6b01]' : 'bg-white/55 text-ink'}`}>
                  <MIcon name={item.icon} size={22} />
                  <span className="text-[11px] font-medium">{item.label}</span>
                </NavLink>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t hairline flex items-center justify-between px-1">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#38b6ff,#ff6b01 55%,#7c3aed)' }}>
                  {name[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-[13px] font-medium text-ink">{name}</div>
                  <div className="text-[11px] text-ink-3">{rolle}</div>
                </div>
              </div>
              <button onClick={signOut} className="text-[13px] text-[#ff3b30] font-medium px-3 py-1.5">Ausloggen</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

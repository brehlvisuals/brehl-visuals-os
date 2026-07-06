import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'

const NAV = [
  { section: 'Übersicht', items: [
    { to: '/dashboard', icon: '⊞', label: 'Dashboard' },
  ]},
  { section: 'Arbeit', items: [
    { to: '/projekte', icon: '▦', label: 'Projekte', mod: 'projekte' },
    { to: '/crm', icon: '◉', label: 'CRM', mod: 'crm' },
    { to: '/tasks', icon: '◷', label: 'Tasks', mod: 'crm', sub: true },
    { to: '/prozess-kunde', icon: '◳', label: 'Prozess Kunde', mod: 'crm', sub: true },
    { to: '/journal', icon: '✎', label: 'Kunden-Journal', mod: 'projekte', sub: true },
    { to: '/meine-stunden', icon: '⏱', label: 'Meine Stunden', externOnly: true },
  ]},
  { section: 'Zeit', items: [
    { to: '/zeiterfassung', icon: '⏱', label: 'Zeiterfassung' },
    { to: '/urlaub', icon: '⛱', label: 'Urlaub' },
    { to: '/auswertung', icon: '▤', label: 'Auswertung' },
  ]},
  { divider: true },
  { section: '', items: [
    { to: '/kalender', icon: '◻', label: 'Kalender' },
  ]},
  { section: 'Admin', items: [
    { to: '/team', icon: '◎', label: 'Team', adminOnly: true },
    { to: '/einstellungen', icon: '⚙', label: 'Einstellungen' },
  ]},
]

const MOBILE_NAV = [
  { to: '/dashboard', m: 'home', label: 'Home' },
  { to: '/zeiterfassung', m: 'clock', label: 'Zeit' },
  { to: '/urlaub', m: 'sun', label: 'Urlaub' },
  { to: '/kalender', m: 'calendar', label: 'Kalender' },
]

// Einheitliche Strich-Icons für die Mobile-Leiste (statt gemischter Emoji/Glyphen)
const svgProps = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
function MIcon({ name }) {
  const p = {
    home: <><path d="M3 10.7 12 4l9 6.7" /><path d="M5.5 9.5V20h13V9.5" /></>,
    clock: <><circle cx="12" cy="12" r="8.2" /><path d="M12 7.8V12l2.6 1.6" /></>,
    sun: <><circle cx="12" cy="12" r="3.8" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" /></>,
    calendar: <><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9.2h17M8 3v3.2M16 3v3.2" /></>,
    grid: <><rect x="3.8" y="3.8" width="6.7" height="6.7" rx="1.5" /><rect x="13.5" y="3.8" width="6.7" height="6.7" rx="1.5" /><rect x="3.8" y="13.5" width="6.7" height="6.7" rx="1.5" /><rect x="13.5" y="13.5" width="6.7" height="6.7" rx="1.5" /></>,
    dots: <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
    logout: <><path d="M14.5 4.5H18a1.8 1.8 0 0 1 1.8 1.8v11.4A1.8 1.8 0 0 1 18 19.5h-3.5" /><path d="M10 8l-4 4 4 4M6.2 12H16" /></>,
  }
  return <svg {...svgProps}>{p[name]}</svg>
}

export default function Sidebar() {
  const { profile, isAdmin, isExtern, canAccess, signOut } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [badges, setBadges] = useState({ urlaub: 0, zeit: 0 })
  const location = useLocation()
  const name = profile?.full_name || profile?.email?.split('@')[0] || 'User'
  const rolle = isAdmin ? 'Admin' : isExtern ? 'Extern' : 'Mitarbeiter'

  useEffect(() => {
    if (!isAdmin || !profile?.id) { setBadges({ urlaub: 0, zeit: 0 }); return }
    let alive = true
    Promise.all([
      supabase.from('urlaubsantraege').select('id', { count: 'exact', head: true }).eq('status', 'offen').neq('user_id', profile.id),
      supabase.from('zeit_aenderungsantraege').select('id', { count: 'exact', head: true }).eq('status', 'offen'),
    ]).then(([u, z]) => { if (alive) setBadges({ urlaub: u.count || 0, zeit: z.count || 0 }) })
    return () => { alive = false }
  }, [isAdmin, profile?.id, location.pathname])

  const badgeFor = to => to === '/urlaub' ? badges.urlaub : to === '/zeiterfassung' ? badges.zeit : 0

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="desktop-sidebar w-56 bg-white border-r border-gray-100 flex flex-col h-screen sticky top-0 flex-shrink-0">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-[#ff6b01] rounded-lg flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">B</div>
          <div>
            <div className="font-semibold text-sm text-gray-900">Brehl Visuals</div>
            <div className="text-xs text-gray-400">OS v2.0</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5">
          {NAV.map((group, gi) => (
            <div key={gi}>
              {group.divider && <div className="h-px bg-gray-100 my-2 mx-1" />}
              {group.section && <div className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest px-2 pt-3 pb-1">{group.section}</div>}
              {group.items?.map(item => {
                if (item.externOnly && !isExtern) return null
                if (isExtern && !item.externOnly && item.to !== '/projekte') return null
                if (item.adminOnly && !isAdmin) return null
                if (item.mod && !canAccess(item.mod)) return null
                return (
                  <NavLink key={item.to} to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all ${item.sub ? 'pl-7 text-xs' : ''} ${
                        isActive ? 'bg-[#ff6b01]/8 text-[#ff6b01] font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                      }`
                    }>
                    <span className="text-base w-4 text-center">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {badgeFor(item.to) > 0 && <span className="bg-red-500 text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{badgeFor(item.to)}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded-full bg-[#ff6b01]/10 flex items-center justify-center text-xs font-semibold text-[#ff6b01] flex-shrink-0">
              {name[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-800 truncate">{name}</div>
              <div className="text-[10px] text-gray-400">{isAdmin ? 'Admin' : 'Mitarbeiter'}</div>
            </div>
          </div>
          <button onClick={signOut} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Ausloggen</button>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="mobile-nav fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 px-2 py-2 safe-area-bottom">
        <div className="flex items-center justify-around w-full">
          {isExtern ? (
            <>
              <NavLink to="/projekte"
                className={`flex flex-col items-center gap-1 px-4 py-1 rounded-lg transition-all ${location.pathname.startsWith('/projekte') ? 'text-[#ff6b01]' : 'text-gray-400'}`}>
                <MIcon name="grid" />
                <span className="text-[10px] font-medium">Drehs</span>
              </NavLink>
              <NavLink to="/meine-stunden"
                className={`flex flex-col items-center gap-1 px-4 py-1 rounded-lg transition-all ${location.pathname.startsWith('/meine-stunden') ? 'text-[#ff6b01]' : 'text-gray-400'}`}>
                <MIcon name="clock" />
                <span className="text-[10px] font-medium">Stunden</span>
              </NavLink>
              <button onClick={signOut} className="flex flex-col items-center gap-1 px-4 py-1 rounded-lg text-gray-400">
                <MIcon name="logout" />
                <span className="text-[10px] font-medium">Logout</span>
              </button>
            </>
          ) : (
            <>
              {MOBILE_NAV.map(item => {
                const active = location.pathname === item.to || location.pathname.startsWith(item.to + '/')
                return (
                  <NavLink key={item.to} to={item.to}
                    className={`relative flex flex-col items-center gap-1 px-3 py-1 rounded-lg transition-all ${active ? 'text-[#ff6b01]' : 'text-gray-400'}`}>
                    <MIcon name={item.m} />
                    {badgeFor(item.to) > 0 && <span className="absolute top-0 right-1.5 bg-red-500 text-white text-[8px] font-semibold rounded-full min-w-[14px] h-3.5 px-1 flex items-center justify-center">{badgeFor(item.to)}</span>}
                    <span className="text-[10px] font-medium">{item.label}</span>
                  </NavLink>
                )
              })}
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`flex flex-col items-center gap-1 px-3 py-1 rounded-lg transition-all ${mobileMenuOpen ? 'text-[#ff6b01]' : 'text-gray-400'}`}>
                <MIcon name="dots" />
                <span className="text-[10px] font-medium">Mehr</span>
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Mobile More Menu */}
      {mobileMenuOpen && (
        <div className="mobile-nav fixed inset-0 bg-black/20 z-40" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute bottom-16 left-0 right-0 bg-white border-t border-gray-200 rounded-t-2xl p-4"
            onClick={e => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-3">
              {[
                { to: '/auswertung', icon: '▤', label: 'Auswertung' },
                ...(canAccess('projekte') ? [{ to: '/projekte', icon: '▦', label: 'Projekte' }] : []),
                ...(canAccess('crm') ? [{ to: '/crm', icon: '◉', label: 'CRM' }] : []),
                ...(canAccess('crm') ? [{ to: '/tasks', icon: '◷', label: 'Tasks' }] : []),
                ...(canAccess('projekte') ? [{ to: '/journal', icon: '✎', label: 'Journal' }] : []),
                ...(isAdmin ? [{ to: '/team', icon: '◎', label: 'Team' }] : []),
                { to: '/einstellungen', icon: '⚙', label: 'Einstellungen' },
              ].map(item => (
                <NavLink key={item.to} to={item.to} onClick={() => setMobileMenuOpen(false)}
                  className="flex flex-col items-center gap-1 p-3 bg-gray-50 rounded-xl text-gray-600">
                  <span className="text-xl">{item.icon}</span>
                  <span className="text-xs font-medium">{item.label}</span>
                </NavLink>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-[#ff6b01]/10 flex items-center justify-center text-xs font-semibold text-[#ff6b01]">
                  {name[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-800">{name}</div>
                  <div className="text-[10px] text-gray-400">{rolle}</div>
                </div>
              </div>
              <button onClick={signOut} className="text-xs text-red-400 font-medium">Ausloggen</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

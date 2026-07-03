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
  { to: '/dashboard', icon: '⊞', label: 'Home' },
  { to: '/zeiterfassung', icon: '⏱', label: 'Zeit' },
  { to: '/urlaub', icon: '⛱', label: 'Urlaub' },
  { to: '/kalender', icon: '◻', label: 'Kalender' },
]

export default function Sidebar() {
  const { profile, isAdmin, canAccess, signOut } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [badges, setBadges] = useState({ urlaub: 0, zeit: 0 })
  const location = useLocation()
  const name = profile?.full_name || profile?.email?.split('@')[0] || 'User'

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
        <div className="flex items-center justify-around">
          {MOBILE_NAV.map(item => {
            const active = location.pathname === item.to || location.pathname.startsWith(item.to + '/')
            return (
              <NavLink key={item.to} to={item.to}
                className={`relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all ${active ? 'text-[#ff6b01]' : 'text-gray-400'}`}>
                <span className="text-lg leading-none">{item.icon}</span>
                {badgeFor(item.to) > 0 && <span className="absolute top-0 right-1.5 bg-red-500 text-white text-[8px] font-semibold rounded-full min-w-[14px] h-3.5 px-1 flex items-center justify-center">{badgeFor(item.to)}</span>}
                <span className="text-[10px] font-medium">{item.label}</span>
              </NavLink>
            )
          })}
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all ${mobileMenuOpen ? 'text-[#ff6b01]' : 'text-gray-400'}`}>
            <span className="text-lg leading-none">⋯</span>
            <span className="text-[10px] font-medium">Mehr</span>
          </button>
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
                  <div className="text-[10px] text-gray-400">{isAdmin ? 'Admin' : 'Mitarbeiter'}</div>
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

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

export default function Dashboard() {
  const { profile, isAdmin, canAccess } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [tasks, setTasks] = useState([])
  const [drehs, setDrehs] = useState([])
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend'
  const name = profile?.full_name || profile?.email?.split('@')[0] || 'Team'

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const queries = [
      supabase.from('crm_tasks').select('*, crm_leads(name)').eq('erledigt', false).order('faellig_am').limit(6),
      supabase.from('portal_news').select('*').order('created_at', { ascending: false }).limit(3),
    ]
    if (isAdmin) {
      queries.push(supabase.from('crm_leads').select('status'))
      queries.push(supabase.from('proj_drehs').select('id, datum, kunde_name, status').order('datum', { ascending: true }).limit(5))
    }
    const results = await Promise.all(queries)
    if (results[0].data) setTasks(results[0].data)
    if (results[1].data) setNews(results[1].data)
    if (results[2]?.data) setLeads(results[2].data)
    if (results[3]?.data) setDrehs(results[3].data)
    setLoading(false)
  }

  async function completeTask(id) {
    await supabase.from('crm_tasks').update({ erledigt: true }).eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const newLeads = leads.filter(l => l.status === 'neu').length
  const successLeads = leads.filter(l => l.status === 'erfolgreich').length
  const overdueTasks = tasks.filter(t => t.faellig_am && new Date(t.faellig_am) < new Date())
  const upcomingDrehs = drehs.filter(d => d.status !== 'abgeschlossen')

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      {/* Greeting */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-semibold text-gray-900">{greeting}, {name} 👋</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* KPIs - Admin only */}
      {isAdmin && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Leads gesamt', value: leads.length, sub: 'Alle Leads', color: '' },
            { label: 'Neue Leads', value: newLeads, sub: 'Warten auf Kontakt', color: 'text-[#ff6b01]' },
            { label: 'Erfolgreich', value: successLeads, sub: `${leads.length ? Math.round(successLeads/leads.length*100) : 0}% Conversion`, color: 'text-green-600' },
            { label: 'Offene Tasks', value: tasks.length, sub: overdueTasks.length > 0 ? `${overdueTasks.length} überfällig` : 'Alles im Plan', color: overdueTasks.length > 0 ? 'text-red-500' : '' },
          ].map(kpi => (
            <div key={kpi.label} className="card p-4">
              <p className="text-xs text-gray-400 mb-1">{kpi.label}</p>
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{kpi.sub}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tasks */}
        <div className="md:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Meine Tasks</h2>
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{tasks.length} offen</span>
          </div>
          {tasks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-2xl mb-2">🎉</p>
              <p className="text-sm text-gray-400">Keine offenen Tasks!</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {tasks.map(t => {
                const overdue = t.faellig_am && new Date(t.faellig_am) < new Date()
                return (
                  <div key={t.id} className={`flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0 ${overdue ? 'bg-red-50 -mx-4 px-4 rounded' : ''}`}>
                    <button onClick={() => completeTask(t.id)}
                      className="w-4 h-4 rounded-full border-2 border-gray-300 hover:border-[#ff6b01] flex-shrink-0 mt-0.5 transition-colors" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{t.titel}</p>
                      <p className={`text-xs mt-0.5 ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                        {t.crm_leads?.name && `${t.crm_leads.name} · `}
                        {overdue ? '⚠ Überfällig' : t.faellig_am ? new Date(t.faellig_am).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }) : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Quick access */}
          <div className="card p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Schnellzugriff</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { to: '/projekte', icon: '▦', label: 'Projekte', show: true },
                { to: '/crm', icon: '◉', label: 'CRM', show: canAccess('crm') },
                { to: '/tasks', icon: '◷', label: 'Tasks', show: canAccess('crm') },
                { to: '/kalender', icon: '◻', label: 'Kalender', show: true },
              ].filter(i => i.show).map(item => (
                <button key={item.to} onClick={() => navigate(item.to)}
                  className="bg-gray-50 hover:bg-gray-100 rounded-lg p-3 text-center transition-all group">
                  <span className="text-lg block mb-1">{item.icon}</span>
                  <span className="text-xs font-medium text-gray-600 group-hover:text-gray-900">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Upcoming Drehs - Admin */}
          {isAdmin && upcomingDrehs.length > 0 && (
            <div className="card p-4">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Nächste Drehs</h2>
              <div className="space-y-2">
                {upcomingDrehs.slice(0, 3).map(d => (
                  <div key={d.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-800">{d.kunde_name}</p>
                      <p className="text-xs text-gray-400">{d.datum ? new Date(d.datum).toLocaleDateString('de-DE') : '—'}</p>
                    </div>
                    <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full capitalize">{d.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* News */}
          {news.length > 0 && (
            <div className="card p-4">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Team-News</h2>
              <div className="space-y-3">
                {news.map(n => (
                  <div key={n.id}>
                    <p className="text-xs font-semibold text-gray-800">{n.titel}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{n.inhalt}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

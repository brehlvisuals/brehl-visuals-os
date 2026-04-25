import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './components/AuthProvider'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Projekte from './pages/Projekte'
import CRM from './pages/CRM'
import { Tasks, Funnels, Kalender, Team, Einstellungen } from './pages/OtherPages'

function Layout({ children }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto main-content">
        {children}
      </main>
    </div>
  )
}

function Protected({ children, mod, adminOnly }) {
  const { user, loading, canAccess, isAdmin } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-2 border-[#ff6b01] border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return (
    <div className="p-6 text-center mt-20 text-gray-400 text-sm">Kein Zugriff auf diesen Bereich.</div>
  )
  if (mod && !canAccess(mod)) return (
    <div className="p-6 text-center mt-20 text-gray-400 text-sm">Kein Zugriff auf diesen Bereich.</div>
  )
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Protected><Layout><Dashboard /></Layout></Protected>} />
          <Route path="/projekte" element={<Protected mod="projekte"><Layout><Projekte /></Layout></Protected>} />
          <Route path="/crm" element={<Protected mod="crm"><Layout><CRM /></Layout></Protected>} />
          <Route path="/tasks" element={<Protected mod="crm"><Layout><Tasks /></Layout></Protected>} />
          <Route path="/funnels" element={<Protected mod="crm"><Layout><Funnels /></Layout></Protected>} />
          <Route path="/kalender" element={<Protected><Layout><Kalender /></Layout></Protected>} />
          <Route path="/team" element={<Protected adminOnly><Layout><Team /></Layout></Protected>} />
          <Route path="/einstellungen" element={<Protected><Layout><Einstellungen /></Layout></Protected>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './components/AuthProvider'
import Sidebar from './components/Sidebar'
import { BrandMark } from './components/BrandMark'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Projekte from './pages/Projekte'
import CRM from './pages/CRM'
import { Kalender, Team, Einstellungen } from './pages/OtherPages'
import { Zeiterfassung, Urlaub, Auswertung } from './pages/Zeiterfassung'
import MeineStunden from './pages/MeineStunden'
import Papierkorb from './pages/Papierkorb'
import Kundenvideos from './pages/Kundenvideos'

function Layout({ children }) {
  return (
    <>
      <div className="app-bg" aria-hidden="true"><i /></div>
      <div className="app-shell flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto main-content">
          {children}
        </main>
      </div>
    </>
  )
}

function Protected({ children, mod, anyMod, adminOnly, externOk, needsZeit, dashboard }) {
  const { user, profile, loading, canAccess, isAdmin, isRestricted, canDashboard } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f2f2f7]">
      <div className="animate-pulse"><BrandMark size={44} /></div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  // Eingeschränkte Rollen (Videograf/Darsteller) dürfen nur ausdrücklich freigegebene Seiten (Projekte, Meine Stunden, Einstellungen)
  // Dashboard nur mit Zugang (Team → Dashboard); ohne Zugang geht's zu den Projekten
  if (dashboard && !canDashboard) return <Navigate to="/projekte" replace />
  if (isRestricted && !externOk && !(dashboard && canDashboard)) return <Navigate to="/projekte" replace />
  // Reiner Planungszugang (zeiterfassung = false) hat keine Stunden-Seite
  if (needsZeit && profile?.zeiterfassung === false) return <Navigate to="/projekte" replace />
  if (adminOnly && !isAdmin) return (
    <div className="p-6 text-center mt-20 text-gray-400 text-sm">Kein Zugriff auf diesen Bereich.</div>
  )
  if (mod && !canAccess(mod)) return (
    <div className="p-6 text-center mt-20 text-gray-400 text-sm">Kein Zugriff auf diesen Bereich.</div>
  )
  if (anyMod && !anyMod.some(m => canAccess(m))) return (
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
          <Route path="/dashboard" element={<Protected dashboard><Layout><Dashboard /></Layout></Protected>} />
          <Route path="/kundenvideos" element={<Protected><Layout><Kundenvideos /></Layout></Protected>} />
          <Route path="/papierkorb" element={<Protected adminOnly><Layout><Papierkorb /></Layout></Protected>} />
          <Route path="/projekte" element={<Protected mod="projekte" externOk><Layout><Projekte /></Layout></Protected>} />
          <Route path="/meine-stunden" element={<Protected externOk needsZeit><Layout><MeineStunden /></Layout></Protected>} />
          <Route path="/crm" element={<Protected anyMod={['crm', 'crm_darsteller']}><Layout><CRM /></Layout></Protected>} />
          {/* Tasks, Prozess Kunde und Kunden-Journal sind ausgeblendet (Daten bleiben in der Datenbank) */}
          <Route path="/prozess-kunde" element={<Navigate to="/dashboard" replace />} />
          <Route path="/journal" element={<Navigate to="/dashboard" replace />} />
          <Route path="/tasks" element={<Navigate to="/dashboard" replace />} />
          <Route path="/zeiterfassung" element={<Protected><Layout><Zeiterfassung /></Layout></Protected>} />
          <Route path="/urlaub" element={<Protected><Layout><Urlaub /></Layout></Protected>} />
          <Route path="/auswertung" element={<Protected><Layout><Auswertung /></Layout></Protected>} />
          <Route path="/kalender" element={<Protected externOk><Layout><Kalender /></Layout></Protected>} />
          <Route path="/team" element={<Protected adminOnly><Layout><Team /></Layout></Protected>} />
          <Route path="/einstellungen" element={<Protected externOk><Layout><Einstellungen /></Layout></Protected>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

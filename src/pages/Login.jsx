import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../components/AuthProvider'
import { supabase } from '../lib/supabase'

export default function Login() {
  const { signIn, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPw, setNewPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('login')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (user) navigate('/dashboard')
    const hash = window.location.hash
    if (hash.includes('type=recovery') || hash.includes('access_token')) setMode('set-password')
  }, [user])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await signIn(email, password)
    if (error) { setError('E-Mail oder Passwort falsch.'); setLoading(false) }
  }

  async function handleReset(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    })
    if (error) setError('Fehler: ' + error.message)
    else setSent(true)
    setLoading(false)
  }

  async function handleSetPw(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) { setError('Fehler: ' + error.message); setLoading(false) }
    else navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-[#ff6b01] rounded-2xl mb-4 shadow-lg shadow-orange-200">
            <span className="text-white font-bold text-xl">B</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Brehl Visuals OS</h1>
          <p className="text-sm text-gray-400 mt-1">Internes Betriebssystem</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          {mode === 'login' && (
            <>
              <p className="text-sm font-medium text-gray-700 mb-4">Anmelden</p>
              <form onSubmit={handleLogin} className="space-y-3">
                <div><label className="label">E-Mail</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="input" placeholder="name@brehlvisuals.de" /></div>
                <div><label className="label">Passwort</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="input" placeholder="••••••••" /></div>
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
                <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Wird angemeldet...' : 'Anmelden →'}</button>
              </form>
              <button onClick={() => setMode('reset')} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 mt-4 transition-colors">Passwort vergessen?</button>
            </>
          )}

          {mode === 'reset' && !sent && (
            <>
              <p className="text-sm font-medium text-gray-700 mb-1">Passwort zurücksetzen</p>
              <p className="text-xs text-gray-400 mb-4">Wir senden dir einen Link per E-Mail.</p>
              <form onSubmit={handleReset} className="space-y-3">
                <div><label className="label">E-Mail</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="input" placeholder="name@brehlvisuals.de" /></div>
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
                <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Wird gesendet...' : 'Link senden →'}</button>
              </form>
              <button onClick={() => setMode('login')} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 mt-4 transition-colors">← Zurück</button>
            </>
          )}

          {mode === 'reset' && sent && (
            <div className="text-center py-4">
              <div className="text-3xl mb-3">✉️</div>
              <p className="text-sm font-medium text-gray-800 mb-1">E-Mail gesendet!</p>
              <p className="text-xs text-gray-400">Prüf dein Postfach und klick auf den Link.</p>
              <button onClick={() => { setMode('login'); setSent(false) }} className="text-xs text-gray-400 hover:text-gray-600 mt-4 block mx-auto">← Zurück zum Login</button>
            </div>
          )}

          {mode === 'set-password' && (
            <>
              <p className="text-sm font-medium text-gray-700 mb-1">Neues Passwort setzen</p>
              <p className="text-xs text-gray-400 mb-4">Mindestens 8 Zeichen.</p>
              <form onSubmit={handleSetPw} className="space-y-3">
                <div><label className="label">Neues Passwort</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={8} className="input" placeholder="Min. 8 Zeichen" /></div>
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
                <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Wird gespeichert...' : 'Passwort speichern →'}</button>
              </form>
            </>
          )}
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">Zugang nur für Brehl Visuals Team</p>
      </div>
    </div>
  )
}

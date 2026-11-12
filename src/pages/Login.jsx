import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../components/AuthProvider'
import { supabase } from '../lib/supabase'
import { BrandMark } from '../components/BrandMark'

export default function Login() {
  const { signIn, user, isRestricted } = useAuth()
  const navigate = useNavigate()
  // Recovery-Link erkennen (einmalig beim Mount, bevor Supabase den Hash aus der URL entfernt)
  const [recovery] = useState(() => {
    if (typeof window === 'undefined') return false
    const h = window.location.hash || '', q = window.location.search || ''
    return h.includes('type=recovery') || h.includes('access_token') || new URLSearchParams(q).has('code')
  })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPw, setNewPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState(recovery ? 'set-password' : 'login')
  const [sent, setSent] = useState(false)
  const [magicSent, setMagicSent] = useState(false)

  useEffect(() => {
    // Im Reset-Modus NICHT automatisch in die App springen – Pia soll erst ein neues Passwort setzen
    if (recovery) return
    if (user) navigate(isRestricted ? '/projekte' : '/dashboard')
  }, [user, recovery])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await signIn(email, password)
    if (error) { setError('E-Mail oder Passwort falsch.'); setLoading(false) }
  }

  async function handleMagic(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    })
    if (error) setError('Fehler: ' + error.message)
    else setMagicSent(true)
    setLoading(false)
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
    else navigate(isRestricted ? '/projekte' : '/dashboard')
  }

  return (
    <div className="h-screen overflow-y-auto relative">
      <div className="app-bg" aria-hidden="true"><i /></div>
      <div className="app-shell min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm fade-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-[76px] h-[76px] rounded-[22px] mb-5 bg-white/80 border border-white shadow-[0_18px_40px_-16px_rgba(124,58,237,0.45),0_8px_20px_-10px_rgba(255,107,1,0.4)]">
            <BrandMark size={48} />
          </div>
          <h1 className="leading-none" style={{ fontFamily: "'Poppins', -apple-system, system-ui, sans-serif" }}>
            <span className="block text-[34px] font-bold tracking-[-0.03em] text-[#333]">brehl</span>
            <span className="block text-[17px] font-light text-[#333] -mt-0.5">visuals <span className="brand-text font-bold">OS</span></span>
          </h1>
          <p className="text-[15px] text-ink-2 mt-3">Internes Betriebssystem</p>
        </div>

        <div className="glass rounded-[28px] p-6">
          {mode === 'login' && (
            <>
              <p className="text-[17px] font-semibold text-ink mb-4 tracking-tight">Anmelden</p>
              <form onSubmit={handleLogin} className="space-y-3">
                <div><label className="label">E-Mail</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="input" placeholder="name@brehlvisuals.de" /></div>
                <div><label className="label">Passwort</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="input" placeholder="••••••••" /></div>
                {error && <div className="text-xs text-[#d70015] bg-[#ff3b30]/10 rounded-xl px-3 py-2">{error}</div>}
                <button type="submit" disabled={loading} className="btn-primary w-full !py-3">{loading ? 'Wird angemeldet...' : 'Anmelden →'}</button>
              </form>
              <button onClick={() => setMode('reset')} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 mt-4 transition-colors">Passwort vergessen?</button>
            </>
          )}

          {mode === 'reset' && !sent && (
            <>
              <p className="text-[17px] font-semibold text-ink mb-1 tracking-tight">Passwort zurücksetzen</p>
              <p className="text-xs text-gray-400 mb-4">Wir senden dir einen Link per E-Mail.</p>
              <form onSubmit={handleReset} className="space-y-3">
                <div><label className="label">E-Mail</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="input" placeholder="name@brehlvisuals.de" /></div>
                {error && <div className="text-xs text-[#d70015] bg-[#ff3b30]/10 rounded-xl px-3 py-2">{error}</div>}
                <button type="submit" disabled={loading} className="btn-primary w-full !py-3">{loading ? 'Wird gesendet...' : 'Link senden →'}</button>
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
              <p className="text-[17px] font-semibold text-ink mb-1 tracking-tight">Neues Passwort setzen</p>
              <p className="text-xs text-gray-400 mb-4">Mindestens 8 Zeichen.</p>
              <form onSubmit={handleSetPw} className="space-y-3">
                <div><label className="label">Neues Passwort</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={8} className="input" placeholder="Min. 8 Zeichen" /></div>
                {error && <div className="text-xs text-[#d70015] bg-[#ff3b30]/10 rounded-xl px-3 py-2">{error}</div>}
                <button type="submit" disabled={loading} className="btn-primary w-full !py-3">{loading ? 'Wird gespeichert...' : 'Passwort speichern →'}</button>
              </form>
            </>
          )}
        </div>
        <p className="text-center text-xs text-ink-3 mt-5">Zugang nur für das Brehl Visuals Team</p>
      </div>
      </div>
    </div>
  )
}

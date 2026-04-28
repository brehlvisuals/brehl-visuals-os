import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const Ctx = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id, session.user.email)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id, session.user.email)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(uid, email) {
    // Versuche Profil zu laden
    let { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    
    // Falls kein Profil existiert, erstelle eines
    if (!data) {
      const { data: newProfile } = await supabase
        .from('profiles')
        .upsert({ id: uid, email, role: 'mitarbeiter', permissions: [] })
        .select()
        .single()
      data = newProfile
    }
    
    // Falls immer noch kein Profil, nutze Fallback
    if (!data) {
      data = { id: uid, email, role: 'mitarbeiter', permissions: [] }
    }
    
    setProfile(data)
    setLoading(false)
  }

  const isAdmin = profile?.role === 'admin'
  const canAccess = (mod) => {
    if (isAdmin) return true
    return profile?.permissions?.includes(mod) ?? false
  }

  return (
    <Ctx.Provider value={{
      user, profile, isAdmin, canAccess, loading,
      signIn: (e, p) => supabase.auth.signInWithPassword({ email: e, password: p }),
      signOut: () => supabase.auth.signOut(),
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)

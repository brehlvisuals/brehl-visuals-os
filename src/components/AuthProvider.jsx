import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const Ctx = createContext({})

// Admin E-Mails - diese User sind immer Admin
const ADMIN_EMAILS = ['felix.brehl@brehlvisuals.de']

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
    // Sofort Admin setzen wenn E-Mail bekannt
    const isKnownAdmin = ADMIN_EMAILS.includes(email)
    
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single()

      if (data) {
        // Wenn Admin-Email aber Rolle noch nicht gesetzt, lokal überschreiben
        if (isKnownAdmin && data.role !== 'admin') {
          setProfile({ ...data, role: 'admin', full_name: data.full_name || 'Felix Brehl' })
        } else {
          setProfile(data)
        }
      } else {
        // Kein Profil gefunden - Fallback
        setProfile({
          id: uid,
          email,
          role: isKnownAdmin ? 'admin' : 'mitarbeiter',
          full_name: isKnownAdmin ? 'Felix Brehl' : email.split('@')[0],
          permissions: []
        })
      }
    } catch {
      // Fehler - Fallback mit Admin-Check
      setProfile({
        id: uid,
        email,
        role: isKnownAdmin ? 'admin' : 'mitarbeiter',
        full_name: isKnownAdmin ? 'Felix Brehl' : email.split('@')[0],
        permissions: []
      })
    }
    setLoading(false)
  }

  const isAdmin = profile?.role === 'admin'
  const isExtern = profile?.role === 'extern'
  const isVideograph = profile?.role === 'videograph'
  // Eingeschränkte Rollen (Extern/Videograph): ausschließlich der Projekte-Bereich
  const isRestricted = isExtern || isVideograph
  const canAccess = (mod) => {
    if (isRestricted) return mod === 'projekte'
    if (isAdmin) return true
    return profile?.permissions?.includes(mod) ?? false
  }

  return (
    <Ctx.Provider value={{
      user, profile, isAdmin, isExtern, isVideograph, isRestricted, canAccess, loading,
      signIn: (e, p) => supabase.auth.signInWithPassword({ email: e, password: p }),
      signOut: () => supabase.auth.signOut(),
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)

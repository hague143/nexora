import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, clearToken, getToken, setToken, type Company, type User } from './api'

type AuthState = {
  user: User | null
  company: Company | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (payload: { email: string; password: string; full_name: string; company_name: string }) => Promise<void>
  google: (email: string, full_name: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }
    api<{ user: User; company: Company }>('/api/me')
      .then((d) => {
        setUser(d.user)
        setCompany(d.company)
      })
      .catch(() => {
        clearToken()
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      company,
      loading,
      async login(email, password) {
        const d = await api<{ token: string; user: User }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        setToken(d.token)
        const me = await api<{ user: User; company: Company }>('/api/me')
        setUser(me.user)
        setCompany(me.company)
      },
      async signup(payload) {
        const d = await api<{ token: string; user: User }>('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setToken(d.token)
        const me = await api<{ user: User; company: Company }>('/api/me')
        setUser(me.user)
        setCompany(me.company)
      },
      async google(email, full_name) {
        const d = await api<{ token: string; user: User }>('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ email, full_name }),
        })
        setToken(d.token)
        const me = await api<{ user: User; company: Company }>('/api/me')
        setUser(me.user)
        setCompany(me.company)
      },
      logout() {
        clearToken()
        setUser(null)
        setCompany(null)
      },
    }),
    [user, company, loading]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

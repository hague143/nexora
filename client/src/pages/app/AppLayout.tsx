import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, Bell, CheckSquare, Command, LayoutDashboard, Lock, LogOut,
  Package, Search, Settings, ShieldCheck, ShoppingCart, Truck, Users, Wallet,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api, type NotificationItem } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useEffect, useMemo, useState, type FormEvent } from 'react'

const links = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/commands', label: 'Command Center', icon: Command },
  { to: '/app/feed', label: 'Company Feed', icon: Activity },
  { to: '/app/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/app/insights', label: 'Insights', icon: BarChart3 },
  { to: '/app/finance', label: 'Finance', icon: Wallet },
  { to: '/app/hr', label: 'HR', icon: Users },
  { to: '/app/procurement', label: 'Procurement', icon: ShoppingCart },
  { to: '/app/supply', label: 'Supply Chain', icon: Truck },
  { to: '/app/quality', label: 'Quality', icon: ShieldCheck },
  { to: '/app/activity', label: 'Activity Log', icon: Package },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]

export function AppLayout() {
  const { user, company, logout, loading } = useAuth()
  const navigate = useNavigate()
  const [notesOpen, setNotesOpen] = useState(false)
  const [notes, setNotes] = useState<NotificationItem[]>([])
  const [query, setQuery] = useState('')
  const [pendingCount, setPendingCount] = useState(0)

  const navLinks = useMemo(() => {
    const base = [...links]
    if (user?.role === 'admin') {
      base.splice(1, 0, { to: '/app/admin', label: 'Admin', icon: Lock })
    }
    return base
  }, [user?.role])

  useEffect(() => {
    if (!user) return
    api<NotificationItem[]>('/api/notifications').then(setNotes).catch(() => {})
    const id = window.setInterval(() => {
      api<NotificationItem[]>('/api/notifications').then(setNotes).catch(() => {})
    }, 15000)
    return () => window.clearInterval(id)
  }, [user])

  useEffect(() => {
    if (!user) return
    const loadPending = () =>
      api<{ id: string }[]>('/api/approvals/pending')
        .then((r) => setPendingCount(r.length))
        .catch(() => {})
    loadPending()
    const id = window.setInterval(loadPending, 30000)
    return () => window.clearInterval(id)
  }, [user])

  const unread = useMemo(() => notes.filter((n) => !n.read && !n.is_read).length, [notes])

  async function markRead(id: string) {
    await api(`/api/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {})
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, read: true, is_read: 1 } : n)))
  }

  function onSearch(e: FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    navigate(`/app/commands?q=${encodeURIComponent(query.trim())}`)
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-slate-500">Loading workspace…</div>
  }
  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex overflow-x-auto border-t border-slate-200 bg-white px-1 py-2 md:hidden">
        {navLinks.slice(0, 6).map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              cn('flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 px-1 text-[10px] font-medium', isActive ? 'text-indigo-700' : 'text-slate-500')
            }
          >
            <span className="relative">
              <l.icon className="h-4 w-4" />
              {l.to === '/app/approvals' && pendingCount > 0 && (
                <span className="absolute -right-2 -top-1 rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-tight text-white">
                  {pendingCount}
                </span>
              )}
            </span>
            {l.label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 px-4 font-bold text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-amber-400">N</span>
          Nexora
        </div>
        <nav className="flex-1 space-y-1 overflow-auto p-3">
          {navLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
                )
              }
            >
              <l.icon className="h-4 w-4" />
              {l.label}
              {l.to === '/app/approvals' && pendingCount > 0 && (
                <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                  {pendingCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <p className="px-4 pb-4 text-xs text-slate-400">{company?.name}</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
          <form onSubmit={onSearch} className="hidden max-w-md flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 md:flex">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or type a command…"
              className="h-9 w-full bg-transparent text-sm outline-none"
            />
          </form>
          <p className="truncate text-sm text-slate-500 md:hidden">{company?.name}</p>
          <div className="flex items-center gap-2">
            <button className="relative rounded-xl p-2 hover:bg-slate-50" onClick={() => setNotesOpen((v) => !v)}>
              <Bell className="h-4 w-4 text-slate-600" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-2 py-1">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                {user.avatar_initials}
              </span>
              <div className="hidden leading-tight sm:block">
                <p className="text-sm font-semibold">{user.full_name}</p>
                <p className="text-[11px] capitalize text-slate-500">{user.role} · {user.department}</p>
              </div>
            </div>
            <button
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"
              onClick={() => {
                logout()
                navigate('/')
              }}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          {notesOpen && (
            <div className="absolute right-4 top-14 z-20 max-h-96 w-80 overflow-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              {notes.length === 0 && <p className="text-sm text-slate-500">No notifications</p>}
              {notes.map((n) => (
                <button
                  key={n.id}
                  className="w-full border-b border-slate-100 py-2 text-left last:border-0"
                  onClick={() => markRead(n.id)}
                >
                  <p className={cn('text-sm font-medium', !n.read && !n.is_read && 'text-indigo-800')}>{n.title}</p>
                  <p className="text-xs text-slate-500">{n.body || n.message}</p>
                </button>
              ))}
            </div>
          )}
        </header>
        <main className="flex-1 overflow-auto p-4 pb-20 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

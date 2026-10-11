import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, ShieldAlert, UserPlus, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Member = {
  id: string; email: string; full_name: string; role: string
  department: string; status: string; created_at: string
}
type Invite = {
  id: string; email: string; role: string; department: string
  token: string; status: string; created_at: string; expires_at: string
}
type JoinRequest = {
  id: string; email: string; full_name: string; company_name: string
  status: string; created_at: string
}

const ROLES = ['admin', 'manager', 'employee']
const DEPARTMENTS = ['finance', 'hr', 'procurement', 'supply_chain', 'quality']
const TABS = [
  { id: 'members', label: 'Team members' },
  { id: 'invites', label: 'Invites' },
  { id: 'requests', label: 'Access requests' },
] as const

const selectCls =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none'

export function AdminPanel() {
  const { user } = useAuth()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('members')
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  // invite form
  const [emails, setEmails] = useState('')
  const [inviteRole, setInviteRole] = useState('employee')
  const [inviteDept, setInviteDept] = useState('finance')
  const [inviting, setInviting] = useState(false)

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const [m, i, r] = await Promise.all([
        api<{ members: Member[] }>('/api/admin/members'),
        api<{ invites: Invite[] }>('/api/admin/invites'),
        api<{ requests: JoinRequest[] }>('/api/admin/requests'),
      ])
      setMembers(m.members)
      setInvites(i.invites.filter((x) => x.status === 'pending'))
      setRequests(r.requests)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  if (user && user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
        <h1 className="mt-4 text-xl font-bold">Admin access required</h1>
        <p className="mt-2 text-sm text-slate-500">
          Only your company admin can manage the team. <Link to="/app" className="text-indigo-700 font-semibold">Back to dashboard</Link>
        </p>
      </div>
    )
  }

  async function sendInvites(e: FormEvent) {
    e.preventDefault()
    setInviting(true)
    setError(''); setNotice('')
    try {
      const d = await api<{ invites: { email: string; skipped?: string; token?: string }[] }>('/api/admin/invites', {
        method: 'POST',
        body: JSON.stringify({
          emails: emails.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
          role: inviteRole,
          department: inviteDept,
        }),
      })
      const okCount = d.invites.filter((x) => !x.skipped).length
      const skipped = d.invites.filter((x) => x.skipped)
      setNotice(
        okCount
          ? `Invited ${okCount} ${okCount === 1 ? 'person' : 'people'}. Share the invite link with them.`
          : 'No new invites created.'
      )
      if (skipped.length) setNotice((n) => `${n} Skipped: ${skipped.map((s) => `${s.email} (${s.skipped})`).join(', ')}`)
      setEmails('')
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invites')
    } finally {
      setInviting(false)
    }
  }

  async function updateMember(id: string, patch: Partial<Member>) {
    setError('')
    try {
      const d = await api<{ member: Member }>(`/api/admin/members/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      setMembers((ms) => ms.map((m) => (m.id === id ? d.member : m)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function removeMember(id: string, name: string) {
    if (!confirm(`Remove ${name} from the workspace? They will lose access immediately.`)) return
    setError('')
    try {
      const d = await api<{ member: Member }>(`/api/admin/members/${id}`, { method: 'DELETE' })
      setMembers((ms) => ms.map((m) => (m.id === id ? d.member : m)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    }
  }

  async function revokeInvite(id: string) {
    await api(`/api/admin/invites/${id}`, { method: 'DELETE' })
    setInvites((xs) => xs.filter((x) => x.id !== id))
  }

  async function decideRequest(id: string, approve: boolean, role?: string, department?: string) {
    setError('')
    try {
      await api(`/api/admin/requests/${id}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
        body: JSON.stringify(approve ? { role, department } : {}),
      })
      setRequests((xs) => xs.filter((x) => x.id !== id))
      if (approve) {
        setNotice('Request approved — an invite was created. The person can now sign up with their email.')
        refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    }
  }

  function copyLink(token: string) {
    const link = `${window.location.origin}/signup?invite=${token}`
    navigator.clipboard.writeText(link).then(() => {
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin panel</h1>
        <p className="text-sm text-slate-500">Invite your team by email — only invited people can join your workspace.</p>
      </div>

      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium ${tab === t.id ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
            {t.id === 'requests' && requests.length > 0 && (
              <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{requests.length}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : tab === 'members' ? (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Department</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-medium">{m.full_name}{m.id === user?.id && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                  <td className="px-4 py-2 text-slate-500">{m.email}</td>
                  <td className="px-4 py-2">
                    <select
                      className={selectCls} value={m.role}
                      disabled={m.id === user?.id}
                      onChange={(e) => updateMember(m.id, { role: e.target.value })}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      className={selectCls} value={m.department}
                      onChange={(e) => updateMember(m.id, { department: e.target.value })}
                    >
                      {DEPARTMENTS.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2"><Badge status={m.status} /></td>
                  <td className="px-4 py-2 text-right">
                    {m.id !== user?.id && m.status === 'active' && (
                      <button onClick={() => removeMember(m.id, m.full_name)} className="text-xs font-medium text-rose-600 hover:underline">
                        Remove
                      </button>
                    )}
                    {m.status === 'deactivated' && (
                      <button onClick={() => updateMember(m.id, { status: 'active' })} className="text-xs font-medium text-emerald-600 hover:underline">
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : tab === 'invites' ? (
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4" /> Invite by email</h2>
            <form onSubmit={sendInvites} className="space-y-3">
              <div>
                <Label htmlFor="emails">Gmail addresses (one per line, or comma-separated)</Label>
                <textarea
                  id="emails" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)}
                  placeholder="ali@gmail.com&#10;sara@gmail.com"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <div>
                  <Label>Role</Label>
                  <select className={`${selectCls} mt-1`} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Department</Label>
                  <select className={`${selectCls} mt-1`} value={inviteDept} onChange={(e) => setInviteDept(e.target.value)}>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
              <Button disabled={inviting || !emails.trim()}>{inviting ? 'Inviting…' : 'Send invites'}</Button>
              <p className="text-xs text-slate-400">Invited people sign up at /signup with their email — no company name needed. Invites expire in 7 days.</p>
            </form>
          </Card>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Invite link</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {invites.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No pending invites.</td></tr>
                )}
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">{inv.email}</td>
                    <td className="px-4 py-2 text-slate-500">{inv.role} · {inv.department.replace('_', ' ')}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => copyLink(inv.token)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                      >
                        {copied === inv.token ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied === inv.token ? 'Copied!' : 'Copy link'}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => revokeInvite(inv.id)} className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline">
                        <X className="h-3 w-3" /> Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Requested</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No pending access requests.</td></tr>
              )}
              {requests.map((r) => (
                <RequestRow key={r.id} req={r} onDecide={decideRequest} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function RequestRow({ req, onDecide }: {
  req: JoinRequest
  onDecide: (id: string, approve: boolean, role?: string, department?: string) => void
}) {
  const [role, setRole] = useState('employee')
  const [department, setDepartment] = useState('finance')
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-4 py-2 font-medium">{req.full_name}</td>
      <td className="px-4 py-2 text-slate-500">{req.email}</td>
      <td className="px-4 py-2 text-slate-400">{new Date(req.created_at).toLocaleDateString()}</td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-2">
          <select className={selectCls} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className={selectCls} value={department} onChange={(e) => setDepartment(e.target.value)}>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
          </select>
          <Button size="sm" onClick={() => onDecide(req.id, true, role, department)}>Approve</Button>
          <button onClick={() => onDecide(req.id, false)} className="text-xs font-medium text-rose-600 hover:underline">
            Reject
          </button>
        </div>
      </td>
    </tr>
  )
}

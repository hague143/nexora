import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Company, type Role, type User } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'

export function SettingsPage() {
  const { user, company, logout } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'company' | 'team' | 'integrations' | 'account'>('company')
  const [profile, setProfile] = useState<Company | null>(company)
  const [team, setTeam] = useState<User[]>([])
  const [integrations, setIntegrations] = useState<{
    n8n?: { connected: boolean; label: string }
    huggingface?: { connected: boolean; label: string }
  } | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api<Company>('/api/settings/company').then(setProfile).catch(() => {})
    api<User[]>('/api/settings/team').then(setTeam).catch(() => {})
    api<{ n8n: { connected: boolean; label: string }; huggingface: { connected: boolean; label: string } }>('/api/settings/integrations')
      .then(setIntegrations)
      .catch(() => {})
  }, [])

  async function saveCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setMsg('')
    try {
      const updated = await api<Company>('/api/settings/company', {
        method: 'PATCH',
        body: JSON.stringify({ name: f.get('name'), industry: f.get('industry') }),
      })
      setProfile(updated)
      setMsg('Company profile saved.')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function changeRole(id: string, role: Role) {
    const updated = await api<User>(`/api/settings/team/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
    setTeam((t) => t.map((u) => (u.id === id ? updated : u)))
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="flex gap-2">
        {(['company', 'team', 'integrations', 'account'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'company' && profile && (
        <Card className="max-w-lg p-5">
          <form className="space-y-3" onSubmit={saveCompany}>
            <div>
              <Label>Company name</Label>
              <Input name="name" defaultValue={profile.name} className="mt-1" />
            </div>
            <div>
              <Label>Industry</Label>
              <Input name="industry" defaultValue={profile.industry || ''} className="mt-1" />
            </div>
            <Button type="submit" disabled={user?.role !== 'admin'}>Save</Button>
            {msg && <p className="text-sm text-slate-600">{msg}</p>}
          </form>
        </Card>
      )}

      {tab === 'team' && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{m.full_name}</td>
                  <td className="px-4 py-3">{m.email}</td>
                  <td className="px-4 py-3">
                    <select
                      className="h-9 rounded-lg border border-slate-200 px-2"
                      value={m.role}
                      disabled={user?.role !== 'admin'}
                      onChange={(e) => changeRole(m.id, e.target.value as Role)}
                    >
                      <option value="admin">admin</option>
                      <option value="manager">manager</option>
                      <option value="employee">employee</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'integrations' && (
        <div className="space-y-3">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Custom workflow handlers</p>
                <p className="text-sm text-slate-500">Department handlers replace n8n visual workflows.</p>
              </div>
              <Badge status="success" />
            </div>
            <p className="mt-3 text-sm text-slate-700">{integrations?.n8n?.label || 'Custom handlers (no n8n)'}</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Hugging Face Inference</p>
                <p className="text-sm text-slate-500">Set HF_API_TOKEN to enable live structured parsing.</p>
              </div>
              <Badge status={integrations?.huggingface?.connected ? 'success' : 'pending'} />
            </div>
            <p className="mt-3 text-sm text-slate-700">{integrations?.huggingface?.label}</p>
          </Card>
        </div>
      )}
      {tab === 'account' && (
        <div className="max-w-lg space-y-4">
          <Card className="p-5">
            <p className="font-semibold">My account</p>
            <dl className="mt-3 space-y-1 text-sm text-slate-600">
              <div className="flex justify-between"><dt>Name</dt><dd className="font-medium text-slate-900">{user?.full_name}</dd></div>
              <div className="flex justify-between"><dt>Email</dt><dd className="font-medium text-slate-900">{user?.email}</dd></div>
              <div className="flex justify-between"><dt>Role</dt><dd className="font-medium capitalize text-slate-900">{user?.role}</dd></div>
              <div className="flex justify-between"><dt>Company</dt><dd className="font-medium text-slate-900">{company?.name}</dd></div>
            </dl>
          </Card>
          <DangerZone
            onDeleted={() => {
              logout()
              navigate('/login', { state: { notice: 'Your account has been deleted.' } })
            }}
          />
        </div>
      )}
    </div>
  )
}

function DangerZone({ onDeleted }: { onDeleted: () => void }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    if (!armed) {
      setArmed(true)
      window.setTimeout(() => setArmed(false), 10000)
      return
    }
    setBusy(true)
    setError('')
    try {
      await api('/api/settings/account', { method: 'DELETE' })
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deletion failed')
      setArmed(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-rose-200 p-5">
      <p className="font-semibold text-rose-700">Danger zone</p>
      <p className="mt-1 text-sm text-slate-600">
        Permanently delete your account and personal data (notifications, command history).
        Company business records stay with the company. This cannot be undone.
      </p>
      {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
      <Button
        variant="outline"
        className={`mt-3 ${armed ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700' : 'border-rose-300 text-rose-700 hover:bg-rose-50'}`}
        onClick={handleDelete}
        disabled={busy}
      >
        {busy ? 'Deleting…' : armed ? 'Click again to confirm deletion' : 'Delete my account'}
      </Button>
    </Card>
  )
}

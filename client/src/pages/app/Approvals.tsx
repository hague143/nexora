import { useEffect, useState } from 'react'
import { api, type WorkflowAction } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/utils'

type Item = WorkflowAction & { actor_name?: string; fields?: Record<string, unknown> }

export function Approvals() {
  const { user } = useAuth()
  const canDecide = user?.role === 'admin' || user?.role === 'manager'
  const [pending, setPending] = useState<Item[]>([])
  const [decided, setDecided] = useState<Item[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')

  const load = () => {
    api<Item[]>('/api/approvals/pending').then(setPending).catch(() => {})
    api<Item[]>('/api/approvals/decided').then(setDecided).catch(() => {})
  }
  useEffect(() => {
    load()
    const id = window.setInterval(load, 10000)
    return () => window.clearInterval(id)
  }, [])

  async function approve(id: string) {
    setBusyId(id)
    setPending((prev) => prev.filter((r) => r.id !== id))
    try {
      await api(`/api/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({}) })
      load()
    } catch {
      load()
    } finally {
      setBusyId('')
    }
  }
  async function reject(id: string) {
    setBusyId(id)
    setPending((prev) => prev.filter((r) => r.id !== id))
    try {
      await api(`/api/approvals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reasons[id] || 'Rejected from Approvals queue' }),
      })
      load()
    } catch {
      load()
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm text-slate-500">
          {canDecide ? 'Items waiting on you, and what you recently decided.' : 'Your requests and their outcomes.'}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Waiting{pending.length > 0 && ` (${pending.length})`}
        </h2>
        {pending.map((r) => (
          <Card key={r.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{r.summary || `${r.action} ${r.entity}`}</p>
                <p className="text-xs capitalize text-slate-500">
                  {r.actor_name} · {r.department.replace('_', ' ')} · {formatDate(r.created_at)}
                </p>
              </div>
              <Badge status={r.status} />
            </div>
            {canDecide ? (
              <>
                <Input
                  placeholder="Rejection reason (optional)"
                  value={reasons[r.id] || ''}
                  onChange={(e) => setReasons((s) => ({ ...s, [r.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <Button onClick={() => approve(r.id)} disabled={busyId === r.id}>Approve</Button>
                  <Button variant="outline" onClick={() => reject(r.id)} disabled={busyId === r.id}>Reject</Button>
                </div>
              </>
            ) : (
              <p className="text-xs text-amber-700">Waiting for a manager to review.</p>
            )}
          </Card>
        ))}
        {pending.length === 0 && <p className="text-sm text-slate-500">Nothing waiting right now.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recently decided</h2>
        {decided.map((r) => {
          const decidedBy = typeof r.fields?.decided_by === 'string' ? r.fields.decided_by : null
          const wasApproved = r.status === 'completed'
          return (
            <Card key={r.id} className="flex items-start justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium">{r.summary || `${r.action} ${r.entity}`}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {r.actor_name} · {wasApproved ? 'approved' : 'rejected'} by {decidedBy || 'a manager'} · {formatDate(r.resolved_at || r.created_at)}
                  {typeof r.fields?.rejection_reason === 'string' && r.fields.rejection_reason && (
                    <> · “{r.fields.rejection_reason}”</>
                  )}
                </p>
              </div>
              <Badge status={wasApproved ? 'approved' : 'rejected'} />
            </Card>
          )
        })}
        {decided.length === 0 && <p className="text-sm text-slate-500">No decisions yet.</p>}
      </section>
    </div>
  )
}

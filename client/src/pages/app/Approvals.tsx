import { useEffect, useState } from 'react'
import { api, type WorkflowAction } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/utils'

type Item = WorkflowAction & { actor_name?: string }

export function Approvals() {
  const [rows, setRows] = useState<Item[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')

  const load = () => api<Item[]>('/api/approvals/pending').then(setRows).catch(() => {})
  useEffect(() => { load() }, [])

  async function approve(id: string) {
    setBusyId(id)
    setRows((prev) => prev.filter((r) => r.id !== id))
    try {
      await api(`/api/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({}) })
    } catch {
      load()
    } finally {
      setBusyId('')
    }
  }
  async function reject(id: string) {
    setBusyId(id)
    setRows((prev) => prev.filter((r) => r.id !== id))
    try {
      await api(`/api/approvals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reasons[id] || 'Rejected from Approvals queue' }),
      })
    } catch {
      load()
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm text-slate-500">Items waiting on a manager or admin.</p>
      </div>
      {rows.map((r) => (
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
          <Input
            placeholder="Rejection reason (optional)"
            value={reasons[r.id] || ''}
            onChange={(e) => setReasons((s) => ({ ...s, [r.id]: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button onClick={() => approve(r.id)} disabled={busyId === r.id}>Approve</Button>
            <Button variant="outline" onClick={() => reject(r.id)} disabled={busyId === r.id}>Reject</Button>
          </div>
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-slate-500">Nothing is waiting on you.</p>}
    </div>
  )
}

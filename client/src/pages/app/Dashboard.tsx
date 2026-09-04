import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type WorkflowAction } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { useAuth } from '@/lib/auth'

export function Dashboard() {
  const { user, company } = useAuth()
  const [data, setData] = useState<{
    stats: { pending_invoices: number; pending_leave: number; open_pos: number; actions_this_week: number }
    recent_actions: WorkflowAction[]
  } | null>(null)

  useEffect(() => {
    api<NonNullable<typeof data>>('/api/dashboard').then(setData).catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Good to see you, {user?.full_name.split(' ')[0]}</h1>
        <p className="text-sm text-slate-500">{company?.name} · type a command or review open work</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pending invoices" value={data?.stats.pending_invoices ?? '—'} />
        <Stat label="Leave to review" value={data?.stats.pending_leave ?? '—'} />
        <Stat label="Open POs" value={data?.stats.open_pos ?? '—'} />
        <Stat label="Logged actions" value={data?.stats.actions_this_week ?? '—'} />
      </div>
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Recent workflow actions</h2>
          <Link to="/app/commands" className="text-sm font-semibold text-indigo-700">Open Command Center</Link>
        </div>
        <div className="space-y-3">
          {(data?.recent_actions || []).map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
              <div>
                <p className="text-sm font-medium">{a.summary || `${a.action} ${a.entity}`}</p>
                <p className="text-xs capitalize text-slate-500">{a.department} · {formatDate(a.created_at)}</p>
              </div>
              <Badge status={a.status} />
            </div>
          ))}
          {data && data.recent_actions.length === 0 && <p className="text-sm text-slate-500">No actions yet. Try Command Center.</p>}
        </div>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </Card>
  )
}

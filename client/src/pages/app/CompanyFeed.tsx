import { useEffect, useState } from 'react'
import { api, type WorkflowAction } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'

type FeedItem = WorkflowAction & { actor_name?: string }

export function CompanyFeed() {
  const [rows, setRows] = useState<FeedItem[]>([])
  useEffect(() => {
    api<FeedItem[]>('/api/activity/company').then(setRows).catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Company Feed</h1>
        <p className="text-sm text-slate-500">Cross-department visibility — not scoped to your team.</p>
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.id} className="flex items-start justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium">{r.summary || `${r.action} ${r.entity}`}</p>
              <p className="mt-1 text-xs text-slate-500">
                {r.actor_name || 'Operator'} · {formatDate(r.created_at)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold capitalize text-indigo-700">
                {r.department.replace('_', ' ')}
              </span>
              <Badge status={r.status} />
            </div>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-500">No company activity yet.</p>}
      </div>
    </div>
  )
}

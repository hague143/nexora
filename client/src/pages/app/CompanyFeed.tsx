import { useEffect, useRef, useState } from 'react'
import { api, type WorkflowAction } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

type FeedItem = WorkflowAction & { actor_name?: string }

export function CompanyFeed() {
  const [rows, setRows] = useState<FeedItem[]>([])
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const seenRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      api<FeedItem[]>('/api/activity/company').then((items) => {
        if (!alive) return
        if (seenRef.current === null) {
          // First load: everything is "seen".
          seenRef.current = new Set(items.map((i) => i.id))
          setRows(items)
          return
        }
        const fresh = items.filter((i) => !seenRef.current!.has(i.id))
        if (fresh.length) {
          seenRef.current = new Set(items.map((i) => i.id))
          setRows(items)
          setFreshIds(new Set(fresh.map((i) => i.id)))
          window.setTimeout(() => {
            if (!alive) return
            setFreshIds((prev) => {
              const next = new Set(prev)
              fresh.forEach((i) => next.delete(i.id))
              return next
            })
          }, 6000)
        } else {
          setRows(items)
        }
      }).catch(() => {})
    }
    load()
    const id = window.setInterval(load, 10000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Company Feed</h1>
          <p className="text-sm text-slate-500">Every query and action across the company, as it happens.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-100">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <Card
            key={r.id}
            className={cn(
              'flex items-start justify-between gap-4 p-4 transition-colors',
              freshIds.has(r.id) && 'border-indigo-300 bg-indigo-50/50'
            )}
          >
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

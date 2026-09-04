import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'

type Summary = {
  pending_approvals: number
  completed_today: number
  completed_week: number
  avg_approval_hours: number
  open_quality_issues: number
  low_stock_alerts: number
  by_department: { department: string; count: number }[]
  daily: { date: string; count: number }[]
  model_reliability: { sample: number; first_try_pct: number; retry_pct: number; failed_pct: number }
}

export function Insights() {
  const [data, setData] = useState<Summary | null>(null)
  useEffect(() => {
    api<Summary>('/api/analytics/summary').then(setData).catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="text-sm text-slate-500">Live operations metrics across the company.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Actions this week" value={data?.completed_week ?? '—'} />
        <Stat label="Pending approvals" value={data?.pending_approvals ?? '—'} />
        <Stat label="Avg turnaround (hrs)" value={data?.avg_approval_hours ?? '—'} />
        <Stat label="Completed today" value={data?.completed_today ?? '—'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Actions per department</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.by_department || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#4f46e5" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Completed actions · last 14 days</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.daily || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#d97706" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Open quality issues" value={data?.open_quality_issues ?? '—'} />
        <Stat label="Low-stock alerts" value={data?.low_stock_alerts ?? '—'} />
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Model reliability</p>
          <p className="mt-2 text-sm text-slate-700">
            First try {data?.model_reliability.first_try_pct ?? 0}% · retry {data?.model_reliability.retry_pct ?? 0}% · failed {data?.model_reliability.failed_pct ?? 0}%
          </p>
          <p className="mt-1 text-xs text-slate-400">{data?.model_reliability.sample ?? 0} logged LLM calls</p>
        </Card>
      </div>
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

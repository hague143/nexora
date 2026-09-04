import { useEffect, useMemo, useState } from 'react'
import { api, type WorkflowAction } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'

export function ActivityLog() {
  const [rows, setRows] = useState<WorkflowAction[]>([])
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')

  useEffect(() => {
    const q = new URLSearchParams()
    if (department) q.set('department', department)
    if (status) q.set('status', status)
    if (from) q.set('from', new Date(from).toISOString())
    api<WorkflowAction[]>(`/api/workflow-actions?${q.toString()}`).then(setRows).catch(() => {})
  }, [department, status, from])

  const depts = useMemo(() => ['', 'finance', 'hr', 'procurement', 'supply_chain', 'quality'], [])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Activity Log</h1>
      <Card className="flex flex-wrap gap-3 p-4">
        <select className="h-10 rounded-xl border border-slate-200 px-3 text-sm" value={department} onChange={(e) => setDepartment(e.target.value)}>
          {depts.map((d) => (
            <option key={d || 'all'} value={d}>{d ? d.replace('_', ' ') : 'All departments'}</option>
          ))}
        </select>
        <select className="h-10 rounded-xl border border-slate-200 px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['completed', 'pending_approval', 'needs_clarification', 'failed', 'rejected'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <input type="date" className="h-10 rounded-xl border border-slate-200 px-3 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Summary</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.created_at)}</td>
                <td className="px-4 py-3 capitalize">{r.department.replace('_', ' ')}</td>
                <td className="px-4 py-3">{r.action} {r.entity.replace('_', ' ')}</td>
                <td className="px-4 py-3">{r.summary}</td>
                <td className="px-4 py-3"><Badge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-sm text-slate-500">No matching actions.</p>}
      </Card>
    </div>
  )
}

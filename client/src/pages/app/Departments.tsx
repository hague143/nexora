import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, type Invoice, type LeaveRequest, type PurchaseOrder } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatDate, formatMoney } from '@/lib/utils'

type Expense = { id: string; employee_name: string; amount: number; category: string; status: string; created_at: string }

/** Approve/Reject row buttons — rendered for admins only. Everyone else just queries. */
function DecideButtons({ onDecide }: { onDecide: (status: 'approved' | 'rejected') => void }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return null
  return (
    <>
      <button className="text-xs font-semibold text-indigo-700" onClick={() => onDecide('approved')}>Approve</button>
      <button className="text-xs font-semibold text-rose-600" onClick={() => onDecide('rejected')}>Reject</button>
    </>
  )
}

export function FinancePage() {
  const [rows, setRows] = useState<Invoice[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const load = () => {
    api<Invoice[]>('/api/invoices').then(setRows)
    api<Expense[]>('/api/expenses').then(setExpenses)
  }
  useEffect(() => { load() }, [])

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const vendor = String(f.get('vendor') || '')
    const amount = Number(f.get('amount'))
    form.reset()
    const created = await api<Invoice>('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ vendor, amount }),
    })
    setRows((prev) => [created, ...prev])
  }

  async function setStatus(id: string, status: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    await api(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
  }

  return (
    <DeptShell title="Finance" subtitle="Invoices, expenses, and petty-cash style records.">
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={onCreate}>
        <Input name="vendor" placeholder="Vendor" required className="max-w-xs" />
        <Input name="amount" type="number" placeholder="Amount" required className="max-w-32" />
        <Button type="submit">Add invoice</Button>
      </form>
      <Table>
        <thead>
          <TrHead cells={['Vendor', 'Amount', 'Status', 'Created', '']} />
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-4 py-3">{r.vendor}</td>
              <td className="px-4 py-3">{formatMoney(r.amount)}</td>
              <td className="px-4 py-3"><Badge status={r.status} /></td>
              <td className="px-4 py-3">{formatDate(r.created_at)}</td>
              <td className="px-4 py-3 space-x-2">
                <DecideButtons onDecide={(status) => setStatus(r.id, status)} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="mb-2 mt-6 text-sm font-semibold">Expenses</p>
      <Table>
        <thead>
          <TrHead cells={['Employee', 'Amount', 'Category', 'Status', 'Created']} />
        </thead>
        <tbody>
          {expenses.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-4 py-3">{r.employee_name}</td>
              <td className="px-4 py-3">{formatMoney(r.amount)}</td>
              <td className="px-4 py-3">{r.category}</td>
              <td className="px-4 py-3"><Badge status={r.status} /></td>
              <td className="px-4 py-3">{formatDate(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </DeptShell>
  )
}

export function HrPage() {
  const [rows, setRows] = useState<LeaveRequest[]>([])
  const load = () => api<LeaveRequest[]>('/api/leave-requests').then(setRows)
  useEffect(() => { load() }, [])

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const payload = { type: f.get('type'), start_date: f.get('start_date'), end_date: f.get('end_date') }
    form.reset()
    const created = await api<LeaveRequest>('/api/leave-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    setRows((prev) => [created, ...prev])
  }

  async function setStatus(id: string, status: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    await api(`/api/leave-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
  }

  return (
    <DeptShell title="HR" subtitle="Leave requests and onboarding-adjacent records.">
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={onCreate}>
        <select name="type" className="h-10 rounded-xl border border-slate-200 px-3 text-sm">
          <option value="annual">Annual</option>
          <option value="sick">Sick</option>
          <option value="personal">Personal</option>
        </select>
        <Input name="start_date" type="date" required className="max-w-40" />
        <Input name="end_date" type="date" required className="max-w-40" />
        <Button type="submit">Request leave</Button>
      </form>
      <Table>
        <thead>
          <TrHead cells={['Employee', 'Type', 'Dates', 'Status', '']} />
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-4 py-3">{r.employee_name}</td>
              <td className="px-4 py-3 capitalize">{r.type}</td>
              <td className="px-4 py-3">{r.start_date} → {r.end_date}</td>
              <td className="px-4 py-3"><Badge status={r.status} /></td>
              <td className="px-4 py-3 space-x-2">
                <DecideButtons onDecide={(status) => setStatus(r.id, status)} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </DeptShell>
  )
}

export function ProcurementPage() {
  const [rows, setRows] = useState<PurchaseOrder[]>([])
  const load = () => api<PurchaseOrder[]>('/api/purchase-orders').then(setRows)
  useEffect(() => { load() }, [])

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const payload = { item: f.get('item'), quantity: Number(f.get('quantity')), amount: Number(f.get('amount')) }
    form.reset()
    const created = await api<PurchaseOrder>('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    setRows((prev) => [created, ...prev])
  }

  async function setStatus(id: string, status: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    await api(`/api/purchase-orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
  }

  return (
    <DeptShell title="Procurement" subtitle="Purchase orders for goods and services.">
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={onCreate}>
        <Input name="item" placeholder="Item" required className="max-w-xs" />
        <Input name="quantity" type="number" placeholder="Qty" required className="max-w-24" />
        <Input name="amount" type="number" placeholder="Amount" required className="max-w-32" />
        <Button type="submit">Create PO</Button>
      </form>
      <Table>
        <thead>
          <TrHead cells={['Item', 'Qty', 'Amount', 'Status', '']} />
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-4 py-3">{r.item}</td>
              <td className="px-4 py-3">{r.quantity}</td>
              <td className="px-4 py-3">{formatMoney(r.amount)}</td>
              <td className="px-4 py-3"><Badge status={r.status} /></td>
              <td className="px-4 py-3 space-x-2">
                <DecideButtons onDecide={(status) => setStatus(r.id, status)} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </DeptShell>
  )
}

function DeptShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mb-4 text-sm text-slate-500">{subtitle}</p>
      {children}
    </div>
  )
}

function Table({ children }: { children: ReactNode }) {
  return <Card className="overflow-x-auto"><table className="w-full text-left text-sm">{children}</table></Card>
}

function TrHead({ cells }: { cells: string[] }) {
  return (
    <tr className="bg-slate-50 text-xs uppercase text-slate-500">
      {cells.map((c) => <th key={c} className="px-4 py-3">{c}</th>)}
    </tr>
  )
}

type Shipment = { id: string; carrier: string; origin: string; destination: string; status: string }
type Inventory = { id: string; sku: string; name: string; quantity: number; reorder_level: number; status: string }
type Inspection = { id: string; lot: string; inspector: string; due_date: string | null; status: string; result: string | null }
type Issue = { id: string; title: string; severity: string; status: string; created_at: string }

export function SupplyPage() {
  const [ships, setShips] = useState<Shipment[]>([])
  const [items, setItems] = useState<Inventory[]>([])
  const load = () => {
    api<Shipment[]>('/api/shipments').then(setShips)
    api<Inventory[]>('/api/inventory').then(setItems)
  }
  useEffect(() => { load() }, [])

  async function addShip(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const payload = { carrier: f.get('carrier'), destination: f.get('destination') }
    form.reset()
    const created = await api<Shipment>('/api/shipments', { method: 'POST', body: JSON.stringify(payload) })
    setShips((prev) => [created, ...prev])
  }
  async function addItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const payload = { name: f.get('name'), sku: f.get('sku'), quantity: Number(f.get('quantity')) }
    form.reset()
    const created = await api<Inventory>('/api/inventory', { method: 'POST', body: JSON.stringify(payload) })
    setItems((prev) => [created, ...prev])
  }

  return (
    <DeptShell title="Supply Chain" subtitle="Shipments and inventory levels.">
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={addShip}>
        <Input name="carrier" placeholder="Carrier" className="max-w-xs" />
        <Input name="destination" placeholder="Destination" required className="max-w-xs" />
        <Button type="submit">Create shipment</Button>
      </form>
      <Table>
        <thead><TrHead cells={['Carrier', 'Route', 'Status']} /></thead>
        <tbody>
          {ships.map((s) => (
            <tr key={s.id} className="border-t border-slate-100">
              <td className="px-4 py-3">{s.carrier}</td>
              <td className="px-4 py-3">{s.origin} → {s.destination}</td>
              <td className="px-4 py-3"><Badge status={s.status} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
      <form className="my-4 flex flex-wrap gap-2" onSubmit={addItem}>
        <Input name="name" placeholder="Item name" required className="max-w-xs" />
        <Input name="sku" placeholder="SKU" className="max-w-32" />
        <Input name="quantity" type="number" placeholder="Qty" required className="max-w-24" />
        <Button type="submit">Add stock</Button>
      </form>
      <Table>
        <thead><TrHead cells={['SKU', 'Name', 'Qty', 'Reorder', 'Status']} /></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-slate-100">
              <td className="px-4 py-3">{i.sku}</td>
              <td className="px-4 py-3">{i.name}</td>
              <td className="px-4 py-3">{i.quantity}</td>
              <td className="px-4 py-3">{i.reorder_level}</td>
              <td className="px-4 py-3"><Badge status={i.status === 'low' ? 'pending' : 'success'} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </DeptShell>
  )
}

export function QualityPage() {
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const load = () => {
    api<Inspection[]>('/api/quality-inspections').then(setInspections)
    api<Issue[]>('/api/quality-issues').then(setIssues)
  }
  useEffect(() => { load() }, [])

  async function addInspection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const payload = { lot: f.get('lot'), due_date: f.get('due_date') }
    form.reset()
    const created = await api<Inspection>('/api/quality-inspections', { method: 'POST', body: JSON.stringify(payload) })
    setInspections((prev) => [created, ...prev])
  }
  async function addIssue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const payload = { title: f.get('title'), severity: f.get('severity') }
    form.reset()
    const created = await api<Issue>('/api/quality-issues', { method: 'POST', body: JSON.stringify(payload) })
    setIssues((prev) => [created, ...prev])
  }

  return (
    <DeptShell title="Quality" subtitle="Inspections and open issues.">
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={addInspection}>
        <Input name="lot" placeholder="Lot" required className="max-w-xs" />
        <Input name="due_date" type="date" className="max-w-40" />
        <Button type="submit">Schedule inspection</Button>
      </form>
      <Table>
        <thead><TrHead cells={['Lot', 'Inspector', 'Due', 'Result', 'Status']} /></thead>
        <tbody>
          {inspections.map((q) => (
            <tr key={q.id} className="border-t border-slate-100">
              <td className="px-4 py-3">{q.lot}</td>
              <td className="px-4 py-3">{q.inspector}</td>
              <td className="px-4 py-3">{q.due_date || '—'}</td>
              <td className="px-4 py-3">{q.result || '—'}</td>
              <td className="px-4 py-3"><Badge status={q.status} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
      <form className="my-4 flex flex-wrap gap-2" onSubmit={addIssue}>
        <Input name="title" placeholder="Issue title" required className="max-w-sm" />
        <select name="severity" className="h-10 rounded-xl border border-slate-200 px-3 text-sm">
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
        <Button type="submit">Log issue</Button>
      </form>
      <Table>
        <thead><TrHead cells={['Title', 'Severity', 'Status', 'Opened']} /></thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.id} className="border-t border-slate-100">
              <td className="px-4 py-3">{i.title}</td>
              <td className="px-4 py-3 capitalize">{i.severity}</td>
              <td className="px-4 py-3"><Badge status={i.status === 'open' ? 'pending' : 'success'} /></td>
              <td className="px-4 py-3">{formatDate(i.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </DeptShell>
  )
}

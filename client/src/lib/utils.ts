import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function statusTone(status: string) {
  const s = (status || '').toLowerCase()
  if (['success', 'approved', 'paid', 'fulfilled', 'connected'].includes(s)) {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-100'
  }
  if (['pending', 'pending_approval', 'needs_approval', 'needs_confirmation', 'needs_clarification'].includes(s)) {
    return 'bg-amber-50 text-amber-700 ring-amber-100'
  }
  if (['rejected', 'insufficient_permission', 'needs_info', 'failed'].includes(s)) {
    return 'bg-rose-50 text-rose-700 ring-rose-100'
  }
  return 'bg-slate-100 text-slate-600 ring-slate-200'
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    success: 'Success',
    completed: 'Completed',
    pending_approval: 'Pending Approval',
    needs_approval: 'Needs Approval',
    needs_confirmation: 'Needs Confirmation',
    needs_clarification: 'Needs Info',
    needs_info: 'Needs Info',
    insufficient_permission: 'Insufficient Permission',
    failed: 'Failed',
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    paid: 'Paid',
    fulfilled: 'Fulfilled',
  }
  return map[status] || status.replace(/_/g, ' ')
}

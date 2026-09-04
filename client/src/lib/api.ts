const TOKEN_KEY = 'nexora_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(path, { ...options, headers, signal: options.signal || controller.signal })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
    }
    return data as T
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('That took too long. Try again.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export type Role = 'admin' | 'manager' | 'employee'

export type User = {
  id: string
  email: string
  full_name: string
  company_id: string
  department?: string
  role: Role
  created_at: string
  avatar_initials: string
}

export type Company = {
  id: string
  name: string
  industry?: string
  created_at: string
}

export type WorkflowAction = {
  id: string
  user_id: string
  company_id: string
  department: string
  action: string
  entity: string
  entity_id: string | null
  fields: Record<string, unknown>
  status: string
  summary?: string
  created_at: string
}

export type Invoice = {
  id: string
  company_id: string
  vendor: string
  amount: number
  status: string
  created_at: string
}

export type LeaveRequest = {
  id: string
  company_id: string
  employee_id: string
  employee_name: string
  type: string
  start_date: string
  end_date: string
  status: string
}

export type PurchaseOrder = {
  id: string
  company_id: string
  item: string
  quantity: number
  amount: number
  status: string
}

export type ParseResult = {
  status: 'success' | 'pending_approval' | 'needs_info' | 'insufficient_permission' | 'needs_confirmation' | 'needs_clarification' | 'failed'
  summary: string
  parsed: Record<string, unknown> | null
  action?: WorkflowAction
}

export type NotificationItem = {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  body?: string
  related_action_id?: string
  is_read?: number
  read?: boolean
  created_at: string
}

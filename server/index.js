require('./env')
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { randomUUID } = require('node:crypto')
const { get, run, many, all, now, rowJson } = require('./db')
const { seed } = require('./seed')
const { processCommand } = require('./command')
const { canManageRoles, canApprove, departmentScope } = require('./permissions')
const { startJobs, runAllJobs } = require('./jobs')
const { notify } = require('./notifications/dispatcher')

seed()
startJobs()

const app = express()
const PORT = process.env.PORT || 3001
const JWT_SECRET = process.env.JWT_SECRET || 'nexora-dev-secret-change-me'

app.use(cors())
app.use(express.json())

function publicUser(u) {
  if (!u) return null
  const parts = String(u.full_name || '').split(' ').filter(Boolean)
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    company_id: u.company_id,
    department: u.department,
    role: u.role,
    created_at: u.created_at,
    avatar_initials: parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'N',
  }
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, company_id: user.company_id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = get(`SELECT * FROM users WHERE id = ?`, [payload.sub])
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}

function scoped(table, user, extra = '') {
  const dept = departmentScope(user)
  let sql = `SELECT * FROM ${table} WHERE company_id = ?`
  const params = [user.company_id]
  if (dept && extra) {
    sql += ` AND ${extra}`
    params.push(dept)
  }
  return many(sql, params)
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, product: 'Nexora' })
})

app.post('/api/auth/signup', (req, res) => {
  const { email, password, full_name, company_name, department } = req.body || {}
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Email, password, and full name are required.' })
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  if (get(`SELECT id FROM users WHERE email = ?`, [String(email).toLowerCase()])) {
    return res.status(409).json({ error: 'An account with this email already exists.' })
  }
  const t = now()
  const companyId = randomUUID()
  run(`INSERT INTO companies (id, name, industry, created_at) VALUES (?, ?, 'General', ?)`, [
    companyId,
    company_name || `${full_name.split(' ')[0]}'s Workspace`,
    t,
  ])
  const userId = randomUUID()
  run(
    `INSERT INTO users (id, email, password_hash, full_name, company_id, department, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'admin', ?)`,
    [userId, String(email).toLowerCase(), bcrypt.hashSync(password, 10), full_name, companyId, department || 'finance', t]
  )
  const user = get(`SELECT * FROM users WHERE id = ?`, [userId])
  res.status(201).json({ token: signToken(user), user: publicUser(user) })
})

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = get(`SELECT * FROM users WHERE email = ?`, [String(email || '').toLowerCase()])
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' })
  }
  res.json({ token: signToken(user), user: publicUser(user) })
})

app.post('/api/auth/google', (req, res) => {
  const { email, full_name } = req.body || {}
  if (!email) return res.status(400).json({ error: 'Email is required.' })
  let user = get(`SELECT * FROM users WHERE email = ?`, [String(email).toLowerCase()])
  if (!user) {
    const t = now()
    const companyId = randomUUID()
    const name = full_name || email.split('@')[0]
    run(`INSERT INTO companies (id, name, industry, created_at) VALUES (?, ?, 'General', ?)`, [
      companyId,
      `${name.split(' ')[0]}'s Workspace`,
      t,
    ])
    const userId = randomUUID()
    run(
      `INSERT INTO users (id, email, password_hash, full_name, company_id, department, role, created_at)
       VALUES (?, ?, ?, ?, ?, 'finance', 'admin', ?)`,
      [userId, String(email).toLowerCase(), bcrypt.hashSync(randomUUID(), 10), name, companyId, t]
    )
    user = get(`SELECT * FROM users WHERE id = ?`, [userId])
  }
  res.json({ token: signToken(user), user: publicUser(user) })
})

app.get('/api/me', auth, (req, res) => {
  const company = get(`SELECT * FROM companies WHERE id = ?`, [req.user.company_id])
  res.json({ user: publicUser(req.user), company })
})

app.post('/api/demo-requests', (req, res) => {
  const { name, email, company, message } = req.body || {}
  if (!name || !email || !company) return res.status(400).json({ error: 'Name, email, and company are required.' })
  const id = randomUUID()
  run(
    `INSERT INTO demo_requests (id, name, email, company, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, email, company, message || '', now()]
  )
  res.status(201).json({ ok: true, request: get(`SELECT * FROM demo_requests WHERE id = ?`, [id]) })
})

app.post('/api/command', auth, async (req, res) => {
  const text = String((req.body || {}).text || (req.body || {}).command || '').trim()
  if (!text) return res.status(400).json({ error: 'Command text is required.' })
  const result = await processCommand(req.user, text)
  res.json(result)
})

app.post('/api/parse-command', auth, async (req, res) => {
  const command = String((req.body || {}).command || '').trim()
  if (!command) return res.status(400).json({ error: 'Command is required.' })
  const result = await processCommand(req.user, command)
  res.json(result)
})

app.get('/api/dashboard', auth, (req, res) => {
  const cid = req.user.company_id
  const pendingInvoices = get(`SELECT COUNT(*) AS n FROM invoices WHERE company_id = ? AND status = 'pending'`, [cid]).n
  const pendingLeave = get(`SELECT COUNT(*) AS n FROM leave_requests WHERE company_id = ? AND status = 'pending'`, [cid]).n
  const openPos = get(`SELECT COUNT(*) AS n FROM purchase_orders WHERE company_id = ? AND status = 'pending'`, [cid]).n
  const actions = get(`SELECT COUNT(*) AS n FROM workflow_actions WHERE company_id = ?`, [cid]).n
  const recent = many(
    `SELECT * FROM workflow_actions WHERE company_id = ? ORDER BY created_at DESC LIMIT 6`,
    [cid]
  )
  res.json({
    stats: {
      pending_invoices: pendingInvoices,
      pending_leave: pendingLeave,
      open_pos: openPos,
      actions_this_week: actions,
    },
    recent_actions: recent,
  })
})

app.get('/api/notifications', auth, (req, res) => {
  const rows = many(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`,
    [req.user.id]
  )
  res.json(rows)
})

app.patch('/api/notifications/:id/read', auth, (req, res) => {
  run(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id])
  res.json({ ok: true })
})

function listActions(req, { ignoreDeptScope = false } = {}) {
  const { department, status, from, to, page = '1', limit = '50' } = req.query
  let sql = `SELECT * FROM workflow_actions WHERE company_id = ?`
  const params = [req.user.company_id]
  const scope = ignoreDeptScope ? null : departmentScope(req.user)
  if (department) {
    sql += ` AND department = ?`
    params.push(department)
  } else if (scope) {
    sql += ` AND department = ?`
    params.push(scope)
  }
  if (status) {
    sql += ` AND status = ?`
    params.push(status)
  }
  if (from) {
    sql += ` AND created_at >= ?`
    params.push(from)
  }
  if (to) {
    sql += ` AND created_at <= ?`
    params.push(to)
  }
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit)
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`
  params.push(Number(limit), offset)
  return many(sql, params)
}

app.get('/api/workflow-actions', auth, (req, res) => {
  res.json(listActions(req))
})

app.get('/api/activity', auth, (req, res) => {
  res.json(listActions(req))
})

app.get('/api/activity/company', auth, (req, res) => {
  const rows = many(
    `SELECT a.*, u.full_name AS actor_name
     FROM workflow_actions a
     JOIN users u ON u.id = a.user_id
     WHERE a.company_id = ?
     ORDER BY a.created_at DESC LIMIT 80`,
    [req.user.company_id]
  )
  res.json(rows)
})

app.get('/api/approvals/pending', auth, (req, res) => {
  if (!canApprove(req.user)) return res.json([])
  res.json(
    many(
      `SELECT a.*, u.full_name AS actor_name
       FROM workflow_actions a
       JOIN users u ON u.id = a.user_id
       WHERE a.company_id = ? AND a.status IN ('pending_approval','needs_approval')
       ORDER BY a.created_at ASC`,
      [req.user.company_id]
    )
  )
})

app.post('/api/approvals/:id/approve', auth, (req, res) => {
  if (!canApprove(req.user)) return res.status(403).json({ error: 'Insufficient permission.' })
  const row = get(
    `SELECT * FROM workflow_actions WHERE id = ? AND company_id = ?`,
    [req.params.id, req.user.company_id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  run(`UPDATE workflow_actions SET status = 'completed', resolved_at = ? WHERE id = ?`, [now(), row.id])
  applyEntityStatus(row, 'approved')
  notify(row.user_id, {
    companyId: req.user.company_id,
    type: 'status_update',
    title: 'Request approved',
    message: `${req.user.full_name} approved your ${row.entity.replace(/_/g, ' ')}.`,
    relatedActionId: row.id,
  })
  res.json(rowJson(get(`SELECT * FROM workflow_actions WHERE id = ?`, [row.id])))
})

app.post('/api/approvals/:id/reject', auth, (req, res) => {
  if (!canApprove(req.user)) return res.status(403).json({ error: 'Insufficient permission.' })
  const row = get(
    `SELECT * FROM workflow_actions WHERE id = ? AND company_id = ?`,
    [req.params.id, req.user.company_id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  const reason = (req.body || {}).reason || 'Rejected'
  const fields = { ...(rowJson(row).fields || {}), rejection_reason: reason }
  run(
    `UPDATE workflow_actions SET status = 'rejected', fields = ?, resolved_at = ?, summary = ? WHERE id = ?`,
    [JSON.stringify(fields), now(), reason, row.id]
  )
  applyEntityStatus(row, 'rejected')
  notify(row.user_id, {
    companyId: req.user.company_id,
    type: 'status_update',
    title: 'Request rejected',
    message: `${req.user.full_name} rejected your ${row.entity.replace(/_/g, ' ')}: ${reason}`,
    relatedActionId: row.id,
  })
  res.json(rowJson(get(`SELECT * FROM workflow_actions WHERE id = ?`, [row.id])))
})

function applyEntityStatus(action, status) {
  const map = {
    invoice: 'invoices',
    expense: 'expenses',
    leave_request: 'leave_requests',
    purchase_order: 'purchase_orders',
    quality_inspection: 'quality_inspections',
  }
  const table = map[action.entity]
  if (table && action.entity_id) {
    run(`UPDATE ${table} SET status = ? WHERE id = ?`, [status, action.entity_id])
  }
}

app.get('/api/analytics/summary', auth, (req, res) => {
  const cid = req.user.company_id
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const today = new Date().toISOString().slice(0, 10)
  const pending = get(
    `SELECT COUNT(*) AS n FROM workflow_actions WHERE company_id = ? AND status IN ('pending_approval','needs_approval')`,
    [cid]
  ).n
  const week = get(
    `SELECT COUNT(*) AS n FROM workflow_actions WHERE company_id = ? AND created_at >= ?`,
    [cid, weekAgo]
  ).n
  const todayCount = get(
    `SELECT COUNT(*) AS n FROM workflow_actions WHERE company_id = ? AND created_at >= ?`,
    [cid, today]
  ).n
  const avgRow = get(
    `SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24) AS hours
     FROM workflow_actions WHERE company_id = ? AND resolved_at IS NOT NULL`,
    [cid]
  )
  const openQuality = get(`SELECT COUNT(*) AS n FROM quality_issues WHERE company_id = ? AND status = 'open'`, [cid]).n
  const lowStock = get(
    `SELECT COUNT(*) AS n FROM inventory_items WHERE company_id = ? AND (status = 'low' OR quantity <= reorder_level)`,
    [cid]
  ).n
  const byDept = all(
    `SELECT department, COUNT(*) AS count FROM workflow_actions WHERE company_id = ? GROUP BY department`,
    [cid]
  )
  const daily = []
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const day = d.toISOString().slice(0, 10)
    const n = get(
      `SELECT COUNT(*) AS n FROM workflow_actions WHERE company_id = ? AND substr(created_at,1,10) = ? AND status = 'completed'`,
      [cid, day]
    ).n
    daily.push({ date: day.slice(5), count: n })
  }
  const logs = all(`SELECT parsed_successfully, retry_count, final_status FROM llm_logs`)
  const total = logs.length || 1
  const firstTry = logs.filter((l) => l.final_status === 'first_try' || (l.parsed_successfully && l.retry_count === 0)).length
  const afterRetry = logs.filter((l) => l.retry_count > 0 && l.parsed_successfully).length
  const failed = logs.filter((l) => !l.parsed_successfully && l.final_status === 'parse_failed').length
  res.json({
    pending_approvals: pending,
    completed_today: todayCount,
    completed_week: week,
    avg_approval_hours: Number((avgRow?.hours || 0).toFixed(2)),
    open_quality_issues: openQuality,
    low_stock_alerts: lowStock,
    by_department: byDept,
    daily,
    model_reliability: {
      sample: logs.length,
      first_try_pct: Math.round((firstTry / total) * 100),
      retry_pct: Math.round((afterRetry / total) * 100),
      failed_pct: Math.round((failed / total) * 100),
    },
  })
})

function crudList(table) {
  return (req, res) => res.json(scoped(table, req.user))
}

app.get('/api/invoices', auth, crudList('invoices'))
app.post('/api/invoices', auth, (req, res) => {
  const { vendor, amount, status } = req.body || {}
  if (!vendor || amount == null) return res.status(400).json({ error: 'Vendor and amount are required.' })
  const id = randomUUID()
  run(
    `INSERT INTO invoices (id, company_id, vendor, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, req.user.company_id, vendor, Number(amount), status || 'pending', now()]
  )
  res.status(201).json(get(`SELECT * FROM invoices WHERE id = ?`, [id]))
})
app.patch('/api/invoices/:id', auth, (req, res) => {
  const row = get(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  const vendor = req.body.vendor ?? row.vendor
  const amount = req.body.amount != null ? Number(req.body.amount) : row.amount
  const status = req.body.status ?? row.status
  run(`UPDATE invoices SET vendor = ?, amount = ?, status = ? WHERE id = ?`, [vendor, amount, status, row.id])
  res.json(get(`SELECT * FROM invoices WHERE id = ?`, [row.id]))
})

app.get('/api/expenses', auth, crudList('expenses'))
app.post('/api/expenses', auth, (req, res) => {
  const { employee_name, amount, category } = req.body || {}
  const id = randomUUID()
  run(
    `INSERT INTO expenses (id, company_id, employee_name, amount, category, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, req.user.company_id, employee_name || req.user.full_name, Number(amount || 0), category || 'general', now()]
  )
  res.status(201).json(get(`SELECT * FROM expenses WHERE id = ?`, [id]))
})

app.get('/api/leave-requests', auth, crudList('leave_requests'))
app.post('/api/leave-requests', auth, (req, res) => {
  const { type, start_date, end_date } = req.body || {}
  if (!type || !start_date || !end_date) return res.status(400).json({ error: 'Type and dates are required.' })
  const id = randomUUID()
  run(
    `INSERT INTO leave_requests (id, company_id, employee_id, employee_name, type, start_date, end_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [id, req.user.company_id, req.user.id, req.user.full_name, type, start_date, end_date]
  )
  res.status(201).json(get(`SELECT * FROM leave_requests WHERE id = ?`, [id]))
})
app.patch('/api/leave-requests/:id', auth, (req, res) => {
  const row = get(`SELECT * FROM leave_requests WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (req.body.status && !canApprove(req.user) && req.body.status !== 'pending') {
    return res.status(403).json({ error: 'Insufficient permission to change status.' })
  }
  run(
    `UPDATE leave_requests SET type = ?, start_date = ?, end_date = ?, status = ? WHERE id = ?`,
    [req.body.type ?? row.type, req.body.start_date ?? row.start_date, req.body.end_date ?? row.end_date, req.body.status ?? row.status, row.id]
  )
  res.json(get(`SELECT * FROM leave_requests WHERE id = ?`, [row.id]))
})

app.get('/api/purchase-orders', auth, crudList('purchase_orders'))
app.post('/api/purchase-orders', auth, (req, res) => {
  const { item, quantity, amount } = req.body || {}
  if (!item || quantity == null || amount == null) return res.status(400).json({ error: 'Item, quantity, and amount are required.' })
  const id = randomUUID()
  run(
    `INSERT INTO purchase_orders (id, company_id, item, quantity, amount, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [id, req.user.company_id, item, Number(quantity), Number(amount)]
  )
  res.status(201).json(get(`SELECT * FROM purchase_orders WHERE id = ?`, [id]))
})
app.patch('/api/purchase-orders/:id', auth, (req, res) => {
  const row = get(`SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  run(
    `UPDATE purchase_orders SET item = ?, quantity = ?, amount = ?, status = ? WHERE id = ?`,
    [req.body.item ?? row.item, req.body.quantity != null ? Number(req.body.quantity) : row.quantity, req.body.amount != null ? Number(req.body.amount) : row.amount, req.body.status ?? row.status, row.id]
  )
  res.json(get(`SELECT * FROM purchase_orders WHERE id = ?`, [row.id]))
})

app.get('/api/shipments', auth, crudList('shipments'))
app.post('/api/shipments', auth, (req, res) => {
  const { carrier, destination, origin } = req.body || {}
  const id = randomUUID()
  run(
    `INSERT INTO shipments (id, company_id, carrier, tracking, origin, destination, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'created', ?)`,
    [id, req.user.company_id, carrier || 'Internal', null, origin || 'HQ', destination || 'Customer', now()]
  )
  res.status(201).json(get(`SELECT * FROM shipments WHERE id = ?`, [id]))
})
app.patch('/api/shipments/:id', auth, (req, res) => {
  const row = get(`SELECT * FROM shipments WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  run(`UPDATE shipments SET status = ? WHERE id = ?`, [req.body.status ?? row.status, row.id])
  res.json(get(`SELECT * FROM shipments WHERE id = ?`, [row.id]))
})

app.get('/api/inventory', auth, crudList('inventory_items'))
app.post('/api/inventory', auth, (req, res) => {
  const { name, sku, quantity, reorder_level } = req.body || {}
  const id = randomUUID()
  const qty = Number(quantity || 0)
  const reorder = Number(reorder_level || 10)
  run(
    `INSERT INTO inventory_items (id, company_id, sku, name, quantity, reorder_level, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user.company_id, sku || `SKU-${id.slice(0, 6)}`, name || 'Item', qty, reorder, qty <= reorder ? 'low' : 'ok', now()]
  )
  res.status(201).json(get(`SELECT * FROM inventory_items WHERE id = ?`, [id]))
})

app.get('/api/quality-inspections', auth, crudList('quality_inspections'))
app.post('/api/quality-inspections', auth, (req, res) => {
  const { lot, due_date } = req.body || {}
  const id = randomUUID()
  run(
    `INSERT INTO quality_inspections (id, company_id, lot, inspector, due_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, req.user.company_id, lot || 'LOT', req.user.full_name, due_date || null, now()]
  )
  res.status(201).json(get(`SELECT * FROM quality_inspections WHERE id = ?`, [id]))
})
app.patch('/api/quality-inspections/:id', auth, (req, res) => {
  const row = get(`SELECT * FROM quality_inspections WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  run(`UPDATE quality_inspections SET status = ?, result = ? WHERE id = ?`, [
    req.body.status ?? row.status,
    req.body.result ?? row.result,
    row.id,
  ])
  res.json(get(`SELECT * FROM quality_inspections WHERE id = ?`, [row.id]))
})

app.get('/api/quality-issues', auth, crudList('quality_issues'))
app.post('/api/quality-issues', auth, (req, res) => {
  const { title, severity } = req.body || {}
  const id = randomUUID()
  run(
    `INSERT INTO quality_issues (id, company_id, title, severity, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)`,
    [id, req.user.company_id, title || 'Issue', severity || 'medium', now()]
  )
  res.status(201).json(get(`SELECT * FROM quality_issues WHERE id = ?`, [id]))
})
app.patch('/api/quality-issues/:id', auth, (req, res) => {
  const row = get(`SELECT * FROM quality_issues WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  run(`UPDATE quality_issues SET status = ? WHERE id = ?`, [req.body.status ?? row.status, row.id])
  res.json(get(`SELECT * FROM quality_issues WHERE id = ?`, [row.id]))
})

app.get('/api/employees', auth, crudList('employees'))

app.get('/api/settings/company', auth, (req, res) => {
  res.json(get(`SELECT * FROM companies WHERE id = ?`, [req.user.company_id]))
})
app.patch('/api/settings/company', auth, (req, res) => {
  if (!canManageRoles(req.user)) return res.status(403).json({ error: 'Only admins can update company profile.' })
  const company = get(`SELECT * FROM companies WHERE id = ?`, [req.user.company_id])
  run(`UPDATE companies SET name = ?, industry = ? WHERE id = ?`, [
    req.body.name ?? company.name,
    req.body.industry ?? company.industry,
    company.id,
  ])
  res.json(get(`SELECT * FROM companies WHERE id = ?`, [company.id]))
})
app.get('/api/settings/team', auth, (req, res) => {
  res.json(all(`SELECT * FROM users WHERE company_id = ?`, [req.user.company_id]).map(publicUser))
})
app.patch('/api/settings/team/:id/role', auth, (req, res) => {
  if (!canManageRoles(req.user)) return res.status(403).json({ error: 'Only admins can change roles.' })
  const { role } = req.body || {}
  if (!['admin', 'manager', 'employee'].includes(role)) return res.status(400).json({ error: 'Invalid role.' })
  const target = get(`SELECT * FROM users WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!target) return res.status(404).json({ error: 'Not found' })
  run(`UPDATE users SET role = ? WHERE id = ?`, [role, target.id])
  res.json(publicUser(get(`SELECT * FROM users WHERE id = ?`, [target.id])))
})
app.get('/api/settings/integrations', auth, (_req, res) => {
  const hf = Boolean(process.env.HF_API_TOKEN)
  res.json({
    n8n: { connected: false, label: 'Custom handlers (no n8n)' },
    huggingface: {
      connected: hf,
      label: hf ? 'Hugging Face: Connected' : 'Hugging Face: heuristic fallback',
    },
  })
})

app.post('/api/jobs/run', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  res.json(runAllJobs())
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Nexora API listening on ${PORT}`)
})

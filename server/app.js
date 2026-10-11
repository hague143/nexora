// Nexora Express app — shared by local dev (server/index.js) and Vercel
// serverless (api/[...path].js). All DB access is async (Postgres via pg).
require('./env')
const path = require('node:path')
const fs = require('node:fs')
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { randomUUID } = require('node:crypto')
const { get, run, many, all, now, rowJson } = require('./db')
const { processCommand } = require('./command')
const { canManageRoles, canApprove, departmentScope } = require('./permissions')
const {
  ensureOrgTables, requireAdmin, findPendingInvite, findInviteByToken, acceptInvite,
  createInvites, listInvites, revokeInvite, createJoinRequest, listRequests,
  approveRequest, rejectRequest, listMembers, updateMember, removeMember,
} = require('./org')
const { runAllJobs } = require('./jobs')
const { notify, notifyCompany } = require('./notifications/dispatcher')
const { writeAction } = require('./handlers')

/**
 * Log a direct (page-form, non-command-bar) change as a workflow action so it
 * shows up in the Company Feed, and broadcast it to the company bell.
 */
async function logDirectActivity(user, { action, entity, entityId, summary, fields = {}, title = 'New query' }) {
  const parsed = { department: user.department || 'finance', action, entity, fields }
  const row = await writeAction(user, parsed, 'completed', { entity_id: entityId, summary })
  await notifyCompany(
    user.company_id,
    { type: 'activity', title, message: `${user.full_name}: ${summary}`, relatedActionId: row.id },
    user.id
  )
  return row
}

/** Log an admin's approve/reject (or other status change) made from a department page. */
async function logStatusChange(user, entity, entityId, label, from, to) {
  if (!to || to === from) return
  const verb = to === 'approved' ? 'Approved' : to === 'rejected' ? 'Rejected' : `Marked ${to}`
  await logDirectActivity(user, {
    action: 'update', entity, entityId,
    summary: `${verb} ${label}`,
    title: to === 'approved' ? 'Request approved' : to === 'rejected' ? 'Request rejected' : 'Status updated',
  })
}

const app = express()
const JWT_SECRET = process.env.JWT_SECRET || 'nexora-dev-secret-change-me'
if (!process.env.JWT_SECRET) console.warn('[nexora] WARNING: JWT_SECRET not set - using insecure dev default. Set JWT_SECRET in production.')

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

async function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = await get(`SELECT * FROM users WHERE id = ?`, [payload.sub])
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    if (user.status === 'deactivated') return res.status(403).json({ error: 'This account has been deactivated.' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}

// Light IP-based rate limit for public endpoints (signup/request flows).
const publicBuckets = new Map()
function publicRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown'
  const windowMs = 3600_000
  const max = 20
  const entry = publicBuckets.get(ip) || { count: 0, start: Date.now() }
  if (Date.now() - entry.start > windowMs) { entry.count = 0; entry.start = Date.now() }
  entry.count += 1
  publicBuckets.set(ip, entry)
  if (entry.count > max) return res.status(429).json({ error: 'Too many requests. Try again later.' })
  next()
}

async function scoped(table, user, extra = '') {
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

app.post('/api/auth/signup', publicRateLimit, async (req, res) => {
  await ensureOrgTables()
  const { email, password, full_name, company_name, department } = req.body || {}
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Email, password, and full name are required.' })
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  const emailLc = String(email).toLowerCase()
  if (await get(`SELECT id FROM users WHERE email = ?`, [emailLc])) {
    return res.status(409).json({ error: 'An account with this email already exists.' })
  }
  const t = now()
  // 1. Invited employee → joins the inviting company with the invited role.
  const invite = await findPendingInvite(emailLc)
  if (invite) {
    const userId = randomUUID()
    await run(
      `INSERT INTO users (id, email, password_hash, full_name, company_id, department, role, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [userId, emailLc, bcrypt.hashSync(password, 10), full_name, invite.company_id, invite.department, invite.role, t]
    )
    await acceptInvite(invite)
    const user = await get(`SELECT * FROM users WHERE id = ?`, [userId])
    return res.status(201).json({ token: signToken(user), user: publicUser(user) })
  }
  // 2. Founder → creates a new company as its admin.
  if (company_name && String(company_name).trim()) {
    const companyId = randomUUID()
    await run(`INSERT INTO companies (id, name, industry, created_at) VALUES (?, ?, 'General', ?)`, [
      companyId,
      String(company_name).trim(),
      t,
    ])
    const userId = randomUUID()
    await run(
      `INSERT INTO users (id, email, password_hash, full_name, company_id, department, role, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', ?)`,
      [userId, emailLc, bcrypt.hashSync(password, 10), full_name, companyId, department || 'finance', t]
    )
    const user = await get(`SELECT * FROM users WHERE id = ?`, [userId])
    return res.status(201).json({ token: signToken(user), user: publicUser(user) })
  }
  // 3. Nobody else gets in.
  return res.status(403).json({
    error: 'This email has not been invited to a Nexora workspace. Ask your company admin for an invite, or request access below.',
    code: 'NOT_INVITED',
  })
})

app.post('/api/auth/login', publicRateLimit, async (req, res) => {
  const { email, password } = req.body || {}
  const user = await get(`SELECT * FROM users WHERE email = ?`, [String(email || '').toLowerCase()])
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' })
  }
  if (user.status === 'deactivated') {
    return res.status(403).json({ error: 'This account has been deactivated. Contact your company admin.' })
  }
  res.json({ token: signToken(user), user: publicUser(user) })
})

app.post('/api/auth/google', publicRateLimit, async (req, res) => {
  await ensureOrgTables()
  const { email, full_name } = req.body || {}
  if (!email) return res.status(400).json({ error: 'Email is required.' })
  const emailLc = String(email).toLowerCase()
  let user = await get(`SELECT * FROM users WHERE email = ?`, [emailLc])
  if (user) {
    if (user.status === 'deactivated') {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your company admin.' })
    }
    return res.json({ token: signToken(user), user: publicUser(user) })
  }
  // No more open account creation: join only via a pending invite.
  const invite = await findPendingInvite(emailLc)
  if (!invite) {
    return res.status(403).json({
      error: 'This email has not been invited to a Nexora workspace. Ask your company admin for an invite.',
      code: 'NOT_INVITED',
    })
  }
  const t = now()
  const userId = randomUUID()
  const name = full_name || emailLc.split('@')[0]
  await run(
    `INSERT INTO users (id, email, password_hash, full_name, company_id, department, role, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [userId, emailLc, bcrypt.hashSync(randomUUID(), 10), name, invite.company_id, invite.department, invite.role, t]
  )
  await acceptInvite(invite)
  user = await get(`SELECT * FROM users WHERE id = ?`, [userId])
  res.json({ token: signToken(user), user: publicUser(user) })
})

app.get('/api/me', auth, async (req, res) => {
  const company = await get(`SELECT * FROM companies WHERE id = ?`, [req.user.company_id])
  res.json({ user: publicUser(req.user), company })
})

/* ------------------------- organization access API ------------------------ */

// Public: look up an invite by token (prefills the signup form).
app.get('/api/access/invite/:token', publicRateLimit, async (req, res) => {
  await ensureOrgTables()
  const invite = await findInviteByToken(req.params.token)
  if (!invite) return res.status(404).json({ error: 'Invite not found or expired.' })
  const company = await get(`SELECT name FROM companies WHERE id = ?`, [invite.company_id])
  res.json({
    email: invite.email, role: invite.role, department: invite.department,
    company_name: company ? company.name : 'your company',
  })
})

// Public: request access to a company's workspace.
app.post('/api/access/request', publicRateLimit, async (req, res) => {
  await ensureOrgTables()
  try {
    const result = await createJoinRequest(req.body || {})
    res.status(201).json({
      message: result.company_found
        ? 'Request sent. Your admin will review it shortly.'
        : 'Request sent. We could not find that company — an admin can still pick it up.',
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Admin: team members
app.get('/api/admin/members', auth, requireAdmin, async (req, res) => {
  res.json({ members: await listMembers(req.user.company_id) })
})
app.patch('/api/admin/members/:id', auth, requireAdmin, async (req, res) => {
  try {
    res.json({ member: await updateMember(req.user, req.params.id, req.body || {}) })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})
app.delete('/api/admin/members/:id', auth, requireAdmin, async (req, res) => {
  try {
    res.json({ member: await removeMember(req.user, req.params.id) })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Admin: invites
app.get('/api/admin/invites', auth, requireAdmin, async (req, res) => {
  res.json({ invites: await listInvites(req.user.company_id) })
})
app.post('/api/admin/invites', auth, requireAdmin, async (req, res) => {
  try {
    const created = await createInvites(req.user, req.body || {})
    res.status(201).json({ invites: created })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})
app.delete('/api/admin/invites/:id', auth, requireAdmin, async (req, res) => {
  try {
    await revokeInvite(req.user.company_id, req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Admin: join requests
app.get('/api/admin/requests', auth, requireAdmin, async (req, res) => {
  res.json({ requests: await listRequests(req.user) })
})
app.post('/api/admin/requests/:id/approve', auth, requireAdmin, async (req, res) => {
  try {
    const invite = await approveRequest(req.user, req.params.id, req.body || {})
    res.json({ invite })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})
app.post('/api/admin/requests/:id/reject', auth, requireAdmin, async (req, res) => {
  try {
    await rejectRequest(req.user, req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/demo-requests', async (req, res) => {
  const { name, email, company, message } = req.body || {}
  if (!name || !email || !company) return res.status(400).json({ error: 'Name, email, and company are required.' })
  const id = randomUUID()
  await run(
    `INSERT INTO demo_requests (id, name, email, company, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, email, company, message || '', now()]
  )
  res.status(201).json({ ok: true, request: await get(`SELECT * FROM demo_requests WHERE id = ?`, [id]) })
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

app.get('/api/dashboard', auth, async (req, res) => {
  const cid = req.user.company_id
  const pendingInvoices = (await get(`SELECT COUNT(*)::int AS n FROM invoices WHERE company_id = ? AND status = 'pending'`, [cid])).n
  const pendingLeave = (await get(`SELECT COUNT(*)::int AS n FROM leave_requests WHERE company_id = ? AND status = 'pending'`, [cid])).n
  const openPos = (await get(`SELECT COUNT(*)::int AS n FROM purchase_orders WHERE company_id = ? AND status = 'pending'`, [cid])).n
  const actions = (await get(`SELECT COUNT(*)::int AS n FROM workflow_actions WHERE company_id = ?`, [cid])).n
  const recent = await many(
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

app.get('/api/notifications', auth, async (req, res) => {
  const rows = await many(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`,
    [req.user.id]
  )
  res.json(rows)
})

app.patch('/api/notifications/:id/read', auth, async (req, res) => {
  await run(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id])
  res.json({ ok: true })
})

async function listActions(req, { ignoreDeptScope = false } = {}) {
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

app.get('/api/workflow-actions', auth, async (req, res) => {
  res.json(await listActions(req))
})

app.get('/api/activity', auth, async (req, res) => {
  res.json(await listActions(req))
})

app.get('/api/activity/company', auth, async (req, res) => {
  const rows = await many(
    `SELECT a.*, u.full_name AS actor_name
     FROM workflow_actions a
     JOIN users u ON u.id = a.user_id
     WHERE a.company_id = ?
     ORDER BY a.created_at DESC LIMIT 80`,
    [req.user.company_id]
  )
  res.json(rows)
})

app.get('/api/approvals/pending', auth, async (req, res) => {
  if (canApprove(req.user)) {
    res.json(
      await many(
        `SELECT a.*, u.full_name AS actor_name
         FROM workflow_actions a
         JOIN users u ON u.id = a.user_id
         WHERE a.company_id = ? AND a.status IN ('pending_approval','needs_approval')
         ORDER BY a.created_at ASC`,
        [req.user.company_id]
      )
    )
    return
  }
  // Employees see the status of their own requests.
  res.json(
    await many(
      `SELECT a.*, u.full_name AS actor_name
       FROM workflow_actions a
       JOIN users u ON u.id = a.user_id
       WHERE a.company_id = ? AND a.user_id = ? AND a.status IN ('pending_approval','needs_approval')
       ORDER BY a.created_at ASC`,
      [req.user.company_id, req.user.id]
    )
  )
})

app.get('/api/approvals/decided', auth, async (req, res) => {
  const scope = canApprove(req.user) ? '' : 'AND a.user_id = ?'
  const params = canApprove(req.user) ? [req.user.company_id] : [req.user.company_id, req.user.id]
  res.json(
    await many(
      `SELECT a.*, u.full_name AS actor_name
       FROM workflow_actions a
       JOIN users u ON u.id = a.user_id
       WHERE a.company_id = ? AND a.fields LIKE '%"decided_by"%' ${scope}
       ORDER BY a.resolved_at DESC LIMIT 20`,
      params
    )
  )
})

app.post('/api/approvals/:id/approve', auth, async (req, res) => {
  if (!canApprove(req.user)) return res.status(403).json({ error: 'Insufficient permission.' })
  const row = await get(
    `SELECT * FROM workflow_actions WHERE id = ? AND company_id = ?`,
    [req.params.id, req.user.company_id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  const approveFields = { ...(rowJson(row).fields || {}), decided_by: req.user.full_name, decided: 'approved' }
  await run(`UPDATE workflow_actions SET status = 'completed', resolved_at = ?, fields = ? WHERE id = ?`, [now(), JSON.stringify(approveFields), row.id])
  await applyEntityStatus(row, 'approved')
  await notify(row.user_id, {
    companyId: req.user.company_id,
    type: 'status_update',
    title: 'Request approved',
    message: `${req.user.full_name} approved your ${row.entity.replace(/_/g, ' ')}.`,
    relatedActionId: row.id,
  })
  const requester = await get(`SELECT full_name FROM users WHERE id = ?`, [row.user_id])
  await notifyCompany(req.user.company_id, {
    type: 'status_update',
    title: 'Request approved',
    message: `${req.user.full_name} approved ${requester ? requester.full_name + "'s" : 'a'} ${row.entity.replace(/_/g, ' ')}.`,
    relatedActionId: row.id,
  }, row.user_id)
  res.json(rowJson(await get(`SELECT * FROM workflow_actions WHERE id = ?`, [row.id])))
})

app.post('/api/approvals/:id/reject', auth, async (req, res) => {
  if (!canApprove(req.user)) return res.status(403).json({ error: 'Insufficient permission.' })
  const row = await get(
    `SELECT * FROM workflow_actions WHERE id = ? AND company_id = ?`,
    [req.params.id, req.user.company_id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  const reason = (req.body || {}).reason || 'Rejected'
  const fields = { ...(rowJson(row).fields || {}), rejection_reason: reason, decided_by: req.user.full_name, decided: 'rejected' }
  await run(
    `UPDATE workflow_actions SET status = 'rejected', fields = ?, resolved_at = ?, summary = ? WHERE id = ?`,
    [JSON.stringify(fields), now(), reason, row.id]
  )
  await applyEntityStatus(row, 'rejected')
  await notify(row.user_id, {
    companyId: req.user.company_id,
    type: 'status_update',
    title: 'Request rejected',
    message: `${req.user.full_name} rejected your ${row.entity.replace(/_/g, ' ')}: ${reason}`,
    relatedActionId: row.id,
  })
  const rejectRequester = await get(`SELECT full_name FROM users WHERE id = ?`, [row.user_id])
  await notifyCompany(req.user.company_id, {
    type: 'status_update',
    title: 'Request rejected',
    message: `${req.user.full_name} rejected ${rejectRequester ? rejectRequester.full_name + "'s" : 'a'} ${row.entity.replace(/_/g, ' ')}: ${reason}`,
    relatedActionId: row.id,
  }, row.user_id)
  res.json(rowJson(await get(`SELECT * FROM workflow_actions WHERE id = ?`, [row.id])))
})

async function applyEntityStatus(action, status) {
  const map = {
    invoice: 'invoices',
    expense: 'expenses',
    leave_request: 'leave_requests',
    purchase_order: 'purchase_orders',
    quality_inspection: 'quality_inspections',
  }
  const table = map[action.entity]
  if (table && action.entity_id) {
    await run(`UPDATE ${table} SET status = ? WHERE id = ?`, [status, action.entity_id])
  }
}

app.get('/api/analytics/summary', auth, async (req, res) => {
  const cid = req.user.company_id
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const today = new Date().toISOString().slice(0, 10)
  const pending = (await get(
    `SELECT COUNT(*)::int AS n FROM workflow_actions WHERE company_id = ? AND status IN ('pending_approval','needs_approval')`,
    [cid]
  )).n
  const week = (await get(
    `SELECT COUNT(*)::int AS n FROM workflow_actions WHERE company_id = ? AND created_at >= ?`,
    [cid, weekAgo]
  )).n
  const todayCount = (await get(
    `SELECT COUNT(*)::int AS n FROM workflow_actions WHERE company_id = ? AND created_at >= ?`,
    [cid, today]
  )).n
  const avgRow = await get(
    `SELECT AVG(EXTRACT(EPOCH FROM resolved_at::timestamptz) - EXTRACT(EPOCH FROM created_at::timestamptz)) / 3600 AS hours
     FROM workflow_actions WHERE company_id = ? AND resolved_at IS NOT NULL`,
    [cid]
  )
  const openQuality = (await get(`SELECT COUNT(*)::int AS n FROM quality_issues WHERE company_id = ? AND status = 'open'`, [cid])).n
  const lowStock = (await get(
    `SELECT COUNT(*)::int AS n FROM inventory_items WHERE company_id = ? AND (status = 'low' OR quantity <= reorder_level)`,
    [cid]
  )).n
  const byDept = await all(
    `SELECT department, COUNT(*)::int AS count FROM workflow_actions WHERE company_id = ? GROUP BY department`,
    [cid]
  )
  const daily = []
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const day = d.toISOString().slice(0, 10)
    const n = (await get(
      `SELECT COUNT(*)::int AS n FROM workflow_actions WHERE company_id = ? AND substring(created_at from 1 for 10) = ? AND status = 'completed'`,
      [cid, day]
    )).n
    daily.push({ date: day.slice(5), count: n })
  }
  const logs = await all(`SELECT parsed_successfully, retry_count, final_status FROM llm_logs`)
  const total = logs.length || 1
  const firstTry = logs.filter((l) => l.final_status === 'first_try' || (l.parsed_successfully && l.retry_count === 0)).length
  const afterRetry = logs.filter((l) => l.retry_count > 0 && l.parsed_successfully).length
  const failed = logs.filter((l) => !l.parsed_successfully && l.final_status === 'parse_failed').length
  res.json({
    pending_approvals: pending,
    completed_today: todayCount,
    completed_week: week,
    avg_approval_hours: Number((Number(avgRow?.hours) || 0).toFixed(2)),
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
  return async (req, res) => res.json(await scoped(table, req.user))
}

app.get('/api/invoices', auth, crudList('invoices'))
app.post('/api/invoices', auth, async (req, res) => {
  const { vendor, amount, status } = req.body || {}
  if (!vendor || amount == null) return res.status(400).json({ error: 'Vendor and amount are required.' })
  const id = randomUUID()
  await run(
    `INSERT INTO invoices (id, company_id, vendor, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, req.user.company_id, vendor, Number(amount), status || 'pending', now()]
  )
  await logDirectActivity(req.user, { action: 'create', entity: 'invoice', entityId: id,
    summary: `Created invoice for ${vendor} ($${Number(amount)})`, fields: { vendor, amount: Number(amount) } })
  res.status(201).json(await get(`SELECT * FROM invoices WHERE id = ?`, [id]))
})
app.patch('/api/invoices/:id', auth, async (req, res) => {
  const row = await get(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (req.body.status && !canApprove(req.user) && req.body.status !== 'pending') {
    return res.status(403).json({ error: 'Insufficient permission to change status.' })
  }
  const vendor = req.body.vendor ?? row.vendor
  const amount = req.body.amount != null ? Number(req.body.amount) : row.amount
  const status = req.body.status ?? row.status
  await run(`UPDATE invoices SET vendor = ?, amount = ?, status = ? WHERE id = ?`, [vendor, amount, status, row.id])
  await logStatusChange(req.user, 'invoice', row.id, `invoice for ${row.vendor} ($${row.amount})`, row.status, req.body.status)
  res.json(await get(`SELECT * FROM invoices WHERE id = ?`, [row.id]))
})

app.get('/api/expenses', auth, crudList('expenses'))
app.post('/api/expenses', auth, async (req, res) => {
  const { employee_name, amount, category } = req.body || {}
  const id = randomUUID()
  await run(
    `INSERT INTO expenses (id, company_id, employee_name, amount, category, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, req.user.company_id, employee_name || req.user.full_name, Number(amount || 0), category || 'general', now()]
  )
  await logDirectActivity(req.user, { action: 'create', entity: 'expense', entityId: id,
    summary: `Filed $${Number(amount || 0)} ${category || 'general'} expense`, fields: { amount: Number(amount || 0) } })
  res.status(201).json(await get(`SELECT * FROM expenses WHERE id = ?`, [id]))
})

app.get('/api/leave-requests', auth, crudList('leave_requests'))
app.post('/api/leave-requests', auth, async (req, res) => {
  const { type, start_date, end_date } = req.body || {}
  if (!type || !start_date || !end_date) return res.status(400).json({ error: 'Type and dates are required.' })
  const id = randomUUID()
  await run(
    `INSERT INTO leave_requests (id, company_id, employee_id, employee_name, type, start_date, end_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [id, req.user.company_id, req.user.id, req.user.full_name, type, start_date, end_date]
  )
  await logDirectActivity(req.user, { action: 'create', entity: 'leave_request', entityId: id,
    summary: `Requested ${type} leave (${start_date} to ${end_date})`, fields: { type } })
  res.status(201).json(await get(`SELECT * FROM leave_requests WHERE id = ?`, [id]))
})
app.patch('/api/leave-requests/:id', auth, async (req, res) => {
  const row = await get(`SELECT * FROM leave_requests WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (req.body.status && !canApprove(req.user) && req.body.status !== 'pending') {
    return res.status(403).json({ error: 'Insufficient permission to change status.' })
  }
  await run(
    `UPDATE leave_requests SET type = ?, start_date = ?, end_date = ?, status = ? WHERE id = ?`,
    [req.body.type ?? row.type, req.body.start_date ?? row.start_date, req.body.end_date ?? row.end_date, req.body.status ?? row.status, row.id]
  )
  await logStatusChange(req.user, 'leave_request', row.id, `${row.type} leave request`, row.status, req.body.status)
  res.json(await get(`SELECT * FROM leave_requests WHERE id = ?`, [row.id]))
})

app.get('/api/purchase-orders', auth, crudList('purchase_orders'))
app.post('/api/purchase-orders', auth, async (req, res) => {
  const { item, quantity, amount } = req.body || {}
  if (!item || quantity == null || amount == null) return res.status(400).json({ error: 'Item, quantity, and amount are required.' })
  const id = randomUUID()
  await run(
    `INSERT INTO purchase_orders (id, company_id, item, quantity, amount, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [id, req.user.company_id, item, Number(quantity), Number(amount)]
  )
  await logDirectActivity(req.user, { action: 'create', entity: 'purchase_order', entityId: id,
    summary: `Created purchase order: ${item} x ${quantity} ($${Number(amount)})`, fields: { item, quantity: Number(quantity), amount: Number(amount) } })
  res.status(201).json(await get(`SELECT * FROM purchase_orders WHERE id = ?`, [id]))
})
app.patch('/api/purchase-orders/:id', auth, async (req, res) => {
  const row = await get(`SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (req.body.status && !canApprove(req.user) && req.body.status !== 'pending') {
    return res.status(403).json({ error: 'Insufficient permission to change status.' })
  }
  await run(
    `UPDATE purchase_orders SET item = ?, quantity = ?, amount = ?, status = ? WHERE id = ?`,
    [req.body.item ?? row.item, req.body.quantity != null ? Number(req.body.quantity) : row.quantity, req.body.amount != null ? Number(req.body.amount) : row.amount, req.body.status ?? row.status, row.id]
  )
  await logStatusChange(req.user, 'purchase_order', row.id, `purchase order ${row.item} x ${row.quantity}`, row.status, req.body.status)
  res.json(await get(`SELECT * FROM purchase_orders WHERE id = ?`, [row.id]))
})

app.get('/api/shipments', auth, crudList('shipments'))
app.post('/api/shipments', auth, async (req, res) => {
  const { carrier, destination, origin } = req.body || {}
  const id = randomUUID()
  await run(
    `INSERT INTO shipments (id, company_id, carrier, tracking, origin, destination, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'created', ?)`,
    [id, req.user.company_id, carrier || 'Internal', null, origin || 'HQ', destination || 'Customer', now()]
  )
  await logDirectActivity(req.user, { action: 'create', entity: 'shipment', entityId: id,
    summary: `Created shipment to ${destination || 'Customer'}`, fields: { destination: destination || 'Customer' } })
  res.status(201).json(await get(`SELECT * FROM shipments WHERE id = ?`, [id]))
})
app.patch('/api/shipments/:id', auth, async (req, res) => {
  const row = await get(`SELECT * FROM shipments WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  await run(`UPDATE shipments SET status = ? WHERE id = ?`, [req.body.status ?? row.status, row.id])
  await logStatusChange(req.user, 'shipment', row.id, `shipment to ${row.destination}`, row.status, req.body.status)
  res.json(await get(`SELECT * FROM shipments WHERE id = ?`, [row.id]))
})

app.get('/api/inventory', auth, crudList('inventory_items'))
app.post('/api/inventory', auth, async (req, res) => {
  const { name, sku, quantity, reorder_level } = req.body || {}
  const id = randomUUID()
  const qty = Number(quantity || 0)
  const reorder = Number(reorder_level || 10)
  await run(
    `INSERT INTO inventory_items (id, company_id, sku, name, quantity, reorder_level, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user.company_id, sku || `SKU-${id.slice(0, 6)}`, name || 'Item', qty, reorder, qty <= reorder ? 'low' : 'ok', now()]
  )
  await logDirectActivity(req.user, { action: 'create', entity: 'inventory_item', entityId: id,
    summary: `Added ${name || 'Item'} to inventory (qty ${qty})`, fields: { name: name || 'Item', quantity: qty } })
  res.status(201).json(await get(`SELECT * FROM inventory_items WHERE id = ?`, [id]))
})

app.get('/api/quality-inspections', auth, crudList('quality_inspections'))
app.post('/api/quality-inspections', auth, async (req, res) => {
  const { lot, due_date } = req.body || {}
  const id = randomUUID()
  await run(
    `INSERT INTO quality_inspections (id, company_id, lot, inspector, due_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, req.user.company_id, lot || 'LOT', req.user.full_name, due_date || null, now()]
  )
  await logDirectActivity(req.user, { action: 'create', entity: 'quality_inspection', entityId: id,
    summary: `Scheduled quality inspection for ${lot || 'LOT'}`, fields: { lot: lot || 'LOT' } })
  res.status(201).json(await get(`SELECT * FROM quality_inspections WHERE id = ?`, [id]))
})
app.patch('/api/quality-inspections/:id', auth, async (req, res) => {
  const row = await get(`SELECT * FROM quality_inspections WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  await run(`UPDATE quality_inspections SET status = ?, result = ? WHERE id = ?`, [
    req.body.status ?? row.status,
    req.body.result ?? row.result,
    row.id,
  ])
  await logStatusChange(req.user, 'quality_inspection', row.id, `inspection ${row.lot}`, row.status, req.body.status)
  res.json(await get(`SELECT * FROM quality_inspections WHERE id = ?`, [row.id]))
})

app.get('/api/quality-issues', auth, crudList('quality_issues'))
app.post('/api/quality-issues', auth, async (req, res) => {
  const { title, severity } = req.body || {}
  const id = randomUUID()
  await run(
    `INSERT INTO quality_issues (id, company_id, title, severity, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)`,
    [id, req.user.company_id, title || 'Issue', severity || 'medium', now()]
  )
  await logDirectActivity(req.user, { action: 'create', entity: 'quality_issue', entityId: id,
    summary: `Reported quality issue: ${title || 'Issue'} (${severity || 'medium'})`, fields: { title: title || 'Issue' } })
  res.status(201).json(await get(`SELECT * FROM quality_issues WHERE id = ?`, [id]))
})
app.patch('/api/quality-issues/:id', auth, async (req, res) => {
  const row = await get(`SELECT * FROM quality_issues WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  await run(`UPDATE quality_issues SET status = ? WHERE id = ?`, [req.body.status ?? row.status, row.id])
  await logStatusChange(req.user, 'quality_issue', row.id, `issue "${row.title}"`, row.status, req.body.status)
  res.json(await get(`SELECT * FROM quality_issues WHERE id = ?`, [row.id]))
})

app.get('/api/employees', auth, crudList('employees'))

app.get('/api/settings/company', auth, async (req, res) => {
  res.json(await get(`SELECT * FROM companies WHERE id = ?`, [req.user.company_id]))
})
app.patch('/api/settings/company', auth, async (req, res) => {
  if (!canManageRoles(req.user)) return res.status(403).json({ error: 'Only admins can update company profile.' })
  const company = await get(`SELECT * FROM companies WHERE id = ?`, [req.user.company_id])
  await run(`UPDATE companies SET name = ?, industry = ? WHERE id = ?`, [
    req.body.name ?? company.name,
    req.body.industry ?? company.industry,
    company.id,
  ])
  res.json(await get(`SELECT * FROM companies WHERE id = ?`, [company.id]))
})
app.get('/api/settings/team', auth, async (req, res) => {
  res.json((await all(`SELECT * FROM users WHERE company_id = ?`, [req.user.company_id])).map(publicUser))
})
app.patch('/api/settings/team/:id/role', auth, async (req, res) => {
  if (!canManageRoles(req.user)) return res.status(403).json({ error: 'Only admins can change roles.' })
  const { role } = req.body || {}
  if (!['admin', 'manager', 'employee'].includes(role)) return res.status(400).json({ error: 'Invalid role.' })
  const target = await get(`SELECT * FROM users WHERE id = ? AND company_id = ?`, [req.params.id, req.user.company_id])
  if (!target) return res.status(404).json({ error: 'Not found' })
  await run(`UPDATE users SET role = ? WHERE id = ?`, [role, target.id])
  res.json(publicUser(await get(`SELECT * FROM users WHERE id = ?`, [target.id])))
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

// Daily job sweep. Triggered by Vercel Cron (CRON_SECRET bearer) or an admin JWT.
app.all('/api/jobs/run', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET
  const header = req.headers.authorization || ''
  const isCron = Boolean(cronSecret) && header === `Bearer ${cronSecret}`
  if (!isCron) {
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    try {
      const payload = jwt.verify(token, JWT_SECRET)
      const user = await get(`SELECT * FROM users WHERE id = ?`, [payload.sub])
      if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
    } catch {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
  res.json(await runAllJobs())
})

// Serve the built Vite client when present (local dev / single-service deploys).
// On Vercel, client/dist is served by Vercel's static hosting instead.
const clientDist = path.join(__dirname, '..', 'client', 'dist')
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist))
  // SPA fallback: /api/* keeps hitting the API above; everything else serves index.html
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(clientDist, 'index.html'))
    }
    next()
  })
}

module.exports = app

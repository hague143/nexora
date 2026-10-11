/**
 * Organization access control: invites, join requests, team management.
 *
 * Model: a company's admin invites employees by email (Gmail). Only
 * invited (or approved) emails can create an account in that company —
 * everyone else is blocked at signup. No API keys, no email sending:
 * the admin shares the invite link themselves, or the employee signs up
 * with the invited address directly.
 */
const { randomUUID } = require('node:crypto')
const { run, get, all, now } = require('./db')

const ROLES = new Set(['admin', 'manager', 'employee'])
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000

let ready = false

async function tableExists(name) {
  try {
    await get(`SELECT 1 FROM ${name} LIMIT 1`)
    return true
  } catch {
    return false
  }
}

/** Idempotent: safe to call on every cold start. */
async function ensureOrgTables() {
  if (ready) return
  try {
    await run(`CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'employee', department TEXT NOT NULL DEFAULT 'finance',
      invited_by TEXT, token TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    )`)
    await run(`CREATE INDEX IF NOT EXISTS idx_invites_email ON invites (email)`)
    await run(`CREATE INDEX IF NOT EXISTS idx_invites_company ON invites (company_id)`)
    await run(`CREATE TABLE IF NOT EXISTS join_requests (
      id TEXT PRIMARY KEY, company_id TEXT, company_name TEXT NOT NULL,
      email TEXT NOT NULL, full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, resolved_at TEXT
    )`)
    await run(`CREATE INDEX IF NOT EXISTS idx_join_requests_company ON join_requests (company_id)`)
    try {
      await get(`SELECT status FROM users LIMIT 1`)
    } catch {
      await run(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`)
    }
  } catch (err) {
    // Defensive: if DDL raced or hit a quirk, verify the tables actually exist
    // before deciding this is a real failure.
    const ok = (await tableExists('invites')) && (await tableExists('join_requests'))
    if (!ok) throw err
  }
  ready = true
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' })
  }
  next()
}

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function validRole(role) {
  return ROLES.has(role) ? role : 'employee'
}

/* --------------------------------- invites -------------------------------- */

async function findPendingInvite(email) {
  const row = await get(
    `SELECT * FROM invites WHERE email = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    [cleanEmail(email)]
  )
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await run(`UPDATE invites SET status = 'expired' WHERE id = ?`, [row.id])
    return null
  }
  return row
}

async function findInviteByToken(token) {
  const row = await get(`SELECT * FROM invites WHERE token = ? LIMIT 1`, [String(token || '')])
  if (!row || row.status !== 'pending') return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await run(`UPDATE invites SET status = 'expired' WHERE id = ?`, [row.id])
    return null
  }
  return row
}

async function createInvites(adminUser, { emails, role, department }) {
  const list = [...new Set((emails || []).map(cleanEmail).filter((e) => /.+@.+\..+/.test(e)))]
  if (!list.length) throw new Error('No valid email addresses.')
  const created = []
  for (const email of list) {
    const existingUser = await get(`SELECT id FROM users WHERE email = ?`, [email])
    if (existingUser) {
      created.push({ email, skipped: 'already has an account' })
      continue
    }
    const dup = await get(
      `SELECT id FROM invites WHERE email = ? AND company_id = ? AND status = 'pending'`, [email, adminUser.company_id]
    )
    if (dup) {
      created.push({ email, skipped: 'invite already pending' })
      continue
    }
    const id = randomUUID()
    const token = randomUUID().replace(/-/g, '')
    const t = now()
    await run(
      `INSERT INTO invites (id, company_id, email, role, department, invited_by, token, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [id, adminUser.company_id, email, validRole(role), department || 'finance', adminUser.id, token, t,
        new Date(Date.now() + INVITE_TTL_MS).toISOString()]
    )
    created.push({ email, id, token, role: validRole(role) })
  }
  return created
}

async function listInvites(companyId) {
  return all(`SELECT * FROM invites WHERE company_id = ? ORDER BY created_at DESC`, [companyId])
}

async function revokeInvite(companyId, id) {
  const row = await get(`SELECT * FROM invites WHERE id = ? AND company_id = ?`, [id, companyId])
  if (!row) throw new Error('Invite not found.')
  await run(`UPDATE invites SET status = 'revoked' WHERE id = ?`, [id])
  return row
}

async function acceptInvite(invite) {
  await run(`UPDATE invites SET status = 'accepted' WHERE id = ?`, [invite.id])
}

/* ------------------------------- join requests ----------------------------- */

async function resolveCompanyId(companyName) {
  const row = await get(`SELECT id FROM companies WHERE lower(name) = lower(?) LIMIT 1`, [String(companyName || '').trim()])
  return row ? row.id : null
}

async function createJoinRequest({ email, full_name, company_name }) {
  email = cleanEmail(email)
  if (!/.+@.+\..+/.test(email)) throw new Error('Enter a valid email address.')
  if (!full_name || !company_name) throw new Error('Name and company are required.')
  const existingUser = await get(`SELECT id FROM users WHERE email = ?`, [email])
  if (existingUser) throw new Error('This email already has an account — just sign in.')
  const dup = await get(
    `SELECT id FROM join_requests WHERE email = ? AND lower(company_name) = lower(?) AND status = 'pending'`,
    [email, String(company_name).trim()]
  )
  if (dup) throw new Error('You already have a pending request for this company.')
  const invited = await findPendingInvite(email)
  if (invited) throw new Error('This email already has a pending invite — just sign up.')
  const id = randomUUID()
  const companyId = await resolveCompanyId(company_name)
  await run(
    `INSERT INTO join_requests (id, company_id, company_name, email, full_name, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, companyId, String(company_name).trim(), email, String(full_name).trim(), now()]
  )
  return { id, company_found: Boolean(companyId) }
}

async function listRequests(adminUser) {
  const company = await get(`SELECT name FROM companies WHERE id = ?`, [adminUser.company_id])
  const cname = company ? company.name : ''
  return all(
    `SELECT * FROM join_requests
     WHERE status = 'pending' AND (company_id = ? OR (company_id IS NULL AND lower(company_name) = lower(?)))
     ORDER BY created_at DESC`,
    [adminUser.company_id, cname]
  )
}

async function approveRequest(adminUser, id, { role, department }) {
  const req = await get(`SELECT * FROM join_requests WHERE id = ? AND status = 'pending'`, [id])
  if (!req) throw new Error('Request not found.')
  const company = await get(`SELECT name FROM companies WHERE id = ?`, [adminUser.company_id])
  const belongs = req.company_id === adminUser.company_id ||
    (!req.company_id && company && req.company_name.toLowerCase() === company.name.toLowerCase())
  if (!belongs) throw new Error('Request not found.')
  const [invite] = await createInvites(adminUser, {
    emails: [req.email], role: validRole(role), department: department || 'finance',
  })
  if (invite.skipped) throw new Error(`Cannot approve: ${invite.skipped}.`)
  await run(`UPDATE join_requests SET status = 'approved', resolved_at = ? WHERE id = ?`, [now(), id])
  return invite
}

async function rejectRequest(adminUser, id) {
  const req = await get(`SELECT * FROM join_requests WHERE id = ? AND status = 'pending'`, [id])
  if (!req) throw new Error('Request not found.')
  await run(`UPDATE join_requests SET status = 'rejected', resolved_at = ? WHERE id = ?`, [now(), id])
  return req
}

/* ---------------------------------- members --------------------------------- */

function publicMember(u) {
  return {
    id: u.id, email: u.email, full_name: u.full_name, role: u.role,
    department: u.department, status: u.status || 'active', created_at: u.created_at,
  }
}

async function listMembers(companyId) {
  const rows = await all(`SELECT * FROM users WHERE company_id = ? ORDER BY created_at`, [companyId])
  return rows.map(publicMember)
}

async function updateMember(adminUser, id, { role, department, status }) {
  const member = await get(`SELECT * FROM users WHERE id = ? AND company_id = ?`, [id, adminUser.company_id])
  if (!member) throw new Error('Member not found.')
  if (member.id === adminUser.id && (role || status === 'deactivated')) {
    throw new Error('You cannot change your own role or deactivate yourself.')
  }
  const updates = []
  const params = []
  if (role) {
    if (!ROLES.has(role)) throw new Error('Invalid role.')
    updates.push('role = ?'); params.push(role)
  }
  if (department) { updates.push('department = ?'); params.push(department) }
  if (status) {
    if (!['active', 'deactivated'].includes(status)) throw new Error('Invalid status.')
    updates.push('status = ?'); params.push(status)
  }
  if (!updates.length) throw new Error('Nothing to update.')
  if (role === 'employee' || status === 'deactivated') {
    const admins = await get(
      `SELECT COUNT(*)::int AS n FROM users WHERE company_id = ? AND role = 'admin' AND (status IS NULL OR status = 'active') AND id != ?`,
      [adminUser.company_id, id]
    )
    const count = Number(admins?.n ?? 0)
    if (count < 1) throw new Error('Every organization needs at least one active admin.')
  }
  params.push(id)
  await run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params)
  return publicMember(await get(`SELECT * FROM users WHERE id = ?`, [id]))
}

async function removeMember(adminUser, id) {
  return updateMember(adminUser, id, { status: 'deactivated' })
}

module.exports = {
  ensureOrgTables,
  requireAdmin,
  findPendingInvite,
  findInviteByToken,
  createInvites,
  listInvites,
  revokeInvite,
  acceptInvite,
  createJoinRequest,
  listRequests,
  approveRequest,
  rejectRequest,
  listMembers,
  updateMember,
  removeMember,
  publicMember,
  ROLES: [...ROLES],
}

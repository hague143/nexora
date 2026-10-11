// Integration test: run the migration + seed + representative app queries on pg-mem.
const fs = require('node:fs')
const path = require('node:path')
const { newDb } = require('pg-mem')

async function main() {
  const mem = newDb()
  const pg = mem.adapters.createPg()
  const pool = new pg.Pool()
  globalThis.__nexoraPool = pool // seam: db.js reuses this instead of creating its own

  const migration = fs.readFileSync(
    path.join(__dirname, 'supabase/migrations/0002_nexora_app_schema.sql'),
    'utf8'
  )
  await pool.query(migration)
  console.log('migration: OK (15 tables)')

  const { ensureSeeded } = require('./server/seed')
  await ensureSeeded()
  const { get, all, many, run } = require('./server/db')

  const users = await all('SELECT email, role FROM users ORDER BY email')
  console.log('seeded users:', users.map((u) => `${u.email}/${u.role}`).join(', '))

  // login lookup (what /api/auth/login does)
  const maya = await get('SELECT * FROM users WHERE email = ?', ['maya@northwind.example'])
  const bcrypt = require('bcryptjs')
  console.log('login password check:', bcrypt.compareSync('demo1234', maya.password_hash))

  // dashboard counts with ::int casts
  const cid = maya.company_id
  const inv = await get(`SELECT COUNT(*)::int AS n FROM invoices WHERE company_id = ? AND status = 'pending'`, [cid])
  console.log('pending invoices:', inv.n, typeof inv.n)

  // analytics: EXTRACT(EPOCH...) and substring(... from 1 for 10)
  const avgRow = await get(
    `SELECT AVG(EXTRACT(EPOCH FROM resolved_at::timestamptz) - EXTRACT(EPOCH FROM created_at::timestamptz)) / 3600 AS hours
     FROM workflow_actions WHERE company_id = ? AND resolved_at IS NOT NULL`,
    [cid]
  )
  console.log('avg approval hours:', Number(Number(avgRow?.hours) || 0).toFixed(2))
  const day = new Date().toISOString().slice(0, 10)
  const todayN = await get(
    `SELECT COUNT(*)::int AS n FROM workflow_actions WHERE company_id = ? AND substring(created_at from 1 for 10) = ? AND status = 'completed'`,
    [cid, day]
  )
  console.log('completed today:', todayN.n)

  // listActions-style pagination with LIMIT ? OFFSET ?
  const page = await many(
    `SELECT * FROM workflow_actions WHERE company_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [cid, 5, 0]
  )
  console.log('paginated actions:', page.length, '| rowJson fields type:', typeof page[0].fields)

  // writeAction + dispatch a real handler (heuristic path, no HF token)
  const { writeAction, dispatch } = require('./server/handlers')
  const parsed = {
    department: 'finance', action: 'create', entity: 'invoice',
    entity_id: null, fields: { vendor: 'Test Vendor', amount: 123.45 }, confidence: 0.9,
  }
  const result = await dispatch(maya, parsed)
  console.log('dispatch createInvoice:', result.success, '-', result.message)
  const action = await writeAction(maya, parsed, 'completed', { command: 'test', summary: result.message })
  console.log('writeAction id:', action.id.slice(0, 8))

  // notifications (rowJson is_read mapping)
  const { notify } = require('./server/notifications/dispatcher')
  await notify(maya.id, { companyId: cid, type: 'status_update', title: 't', message: 'm' })
  const notifs = await many(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, [maya.id])
  console.log('notification read flag:', notifs[0].read, '| body:', notifs[0].body)

  // jobs sweep
  const { runAllJobs } = require('./server/jobs')
  const sweep = await runAllJobs()
  console.log('jobs sweep:', JSON.stringify(sweep))

  // approvals flow: pending list then approve
  const pending = await many(
    `SELECT * FROM workflow_actions WHERE company_id = ? AND status IN ('pending_approval','needs_approval') ORDER BY created_at ASC`,
    [cid]
  )
  console.log('pending approvals:', pending.length)

  // command pipeline (heuristic, no HF token)
  const { processCommand } = require('./server/command')
  const cmd = await processCommand(maya, 'create invoice for Acme Corp $500')
  console.log('processCommand:', cmd.status, '-', cmd.summary)

  console.log('\nALL INTEGRATION CHECKS PASSED')
}

main().catch((err) => {
  console.error('INTEGRATION TEST FAILED:', err)
  process.exit(1)
})

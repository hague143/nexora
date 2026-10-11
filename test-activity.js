// Integration test: activity broadcast + live approvals.
// Employee runs commands → whole company gets bell notifications;
// approval decisions appear in the decided history.
process.env.JWT_SECRET = 'test-secret-for-activity-tests'
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { newDb } = require('pg-mem')

let ipCounter = 100
async function req(base, method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.9.${ipCounter++}` }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${base}${p}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => ({}))
  return { status: r.status, data }
}

async function main() {
  const mem = newDb()
  const pg = mem.adapters.createPg()
  globalThis.__nexoraPool = new pg.Pool()
  await globalThis.__nexoraPool.query(
    fs.readFileSync(path.join(__dirname, 'supabase/migrations/0002_nexora_app_schema.sql'), 'utf8')
  )
  const { ensureSeeded } = require('./server/seed')
  await ensureSeeded()
  const { ensureOrgTables, createInvites } = require('./server/org')
  await ensureOrgTables()

  const app = require('./server/app')
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}`
  let n = 0
  const ok = (name, cond, extra = '') => {
    n += 1
    assert.ok(cond, `FAILED: ${name} ${extra}`)
    console.log(`  ok: ${name}`)
  }
  const notes = async (token) => (await req(base, 'GET', '/api/notifications', { token })).data

  try {
    // founder (admin) + invited employee in one company
    let r = await req(base, 'POST', '/api/auth/signup', {
      body: { email: 'boss@initech.test', password: 'password123', full_name: 'Bill Boss', company_name: 'Initech' },
    })
    const adminToken = r.data.token
    const admin = r.data.user
    await createInvites({ id: admin.id, company_id: admin.company_id }, { emails: ['pete@initech.test'], role: 'employee', department: 'finance' })
    r = await req(base, 'POST', '/api/auth/signup', {
      body: { email: 'pete@initech.test', password: 'password123', full_name: 'Pete Employee' },
    })
    const empToken = r.data.token
    await createInvites({ id: admin.id, company_id: admin.company_id }, { emails: ['mia@initech.test'], role: 'manager', department: 'finance' })
    r = await req(base, 'POST', '/api/auth/signup', {
      body: { email: 'mia@initech.test', password: 'password123', full_name: 'Mia Manager' },
    })
    const managerToken = r.data.token

    // 1. employee runs a command → actor gets personal note, admin gets broadcast
    r = await req(base, 'POST', '/api/command', { token: empToken, body: { text: 'file my $30 taxi expense' } })
    ok('command succeeds', r.status === 200 && r.data.status === 'success')
    let empNotes = await notes(empToken)
    ok('actor notified personally', empNotes.some((x) => x.title === 'Command completed'))
    let adminNotes = await notes(adminToken)
    ok('company broadcast reaches admin', adminNotes.some((x) => x.title === 'New query' && /Pete Employee/.test(x.message)))

    // 2. pure query → NO broadcast (no noise)
    const before = adminNotes.length
    r = await req(base, 'POST', '/api/command', { token: empToken, body: { text: 'show me pending approvals' } })
    ok('query succeeds', r.data.status === 'success')
    adminNotes = await notes(adminToken)
    ok('query does not broadcast', adminNotes.length === before)

    // 3. big invoice → pending approval → everyone notified
    r = await req(base, 'POST', '/api/command', { token: empToken, body: { text: 'create an invoice for BigCo, $5000' } })
    ok('needs approval', r.data.status === 'pending_approval')
    adminNotes = await notes(adminToken)
    ok('approval-needed broadcast', adminNotes.some((x) => x.title === 'Approval needed'))

    // 4. employee sees own pending request in approvals
    r = await req(base, 'GET', '/api/approvals/pending', { token: empToken })
    ok('employee sees own pending', r.data.length === 1)

    // 5. admin approves → requester notified + decided history
    const itemId = (await req(base, 'GET', '/api/approvals/pending', { token: adminToken })).data[0].id
    r = await req(base, 'POST', `/api/approvals/${itemId}/approve`, { token: adminToken, body: {} })
    ok('approve ok', r.status === 200)
    empNotes = await notes(empToken)
    ok('requester notified of approval', empNotes.some((x) => x.title === 'Request approved'))
    adminNotes = await notes(adminToken)
    ok('decision broadcast to company', adminNotes.some((x) => x.title === 'Request approved' && /Bill Boss/.test(x.message)))
    r = await req(base, 'GET', '/api/approvals/decided', { token: adminToken })
    ok('decided history shows it', r.data.length === 1 && r.data[0].status === 'completed')
    r = await req(base, 'GET', '/api/approvals/decided', { token: empToken })
    ok('employee sees own decided', r.data.length === 1)

    // 6. reject path
    r = await req(base, 'POST', '/api/command', { token: empToken, body: { text: 'create an invoice for SmallCo, $2000' } })
    ok('second request pending', r.data.status === 'pending_approval')
    const item2 = (await req(base, 'GET', '/api/approvals/pending', { token: adminToken })).data[0].id
    r = await req(base, 'POST', `/api/approvals/${item2}/reject`, { token: adminToken, body: { reason: 'duplicate vendor' } })
    ok('reject ok', r.status === 200)
    empNotes = await notes(empToken)
    ok('requester notified of rejection with reason', empNotes.some((x) => x.title === 'Request rejected' && /duplicate vendor/.test(x.message)))
    r = await req(base, 'GET', '/api/approvals/decided', { token: adminToken })
    ok('decided history has both', r.data.length === 2)

    // 7. only admins can decide — manager gets 403
    r = await req(base, 'POST', '/api/command', { token: empToken, body: { text: 'create an invoice for MidCo, $3000' } })
    ok('third request pending', r.data.status === 'pending_approval')
    const item3 = (await req(base, 'GET', '/api/approvals/pending', { token: adminToken })).data[0].id
    r = await req(base, 'POST', `/api/approvals/${item3}/approve`, { token: managerToken, body: {} })
    ok('manager cannot approve (403)', r.status === 403)
    r = await req(base, 'POST', `/api/approvals/${item3}/approve`, { token: adminToken, body: {} })
    ok('admin can still approve', r.status === 200)

    // 8. direct entity status changes are admin-only (the Finance-page hole)
    r = await req(base, 'POST', '/api/invoices', { token: empToken, body: { vendor: 'TestVendor', amount: 100 } })
    const invId = r.data.id
    r = await req(base, 'PATCH', `/api/invoices/${invId}`, { token: empToken, body: { status: 'approved' } })
    ok('employee cannot self-approve invoice (403)', r.status === 403)
    r = await req(base, 'PATCH', `/api/invoices/${invId}`, { token: adminToken, body: { status: 'approved' } })
    ok('admin can approve invoice', r.status === 200 && r.data.status === 'approved')
    r = await req(base, 'POST', '/api/purchase-orders', { token: empToken, body: { item: 'paper', quantity: 10, amount: 50 } })
    const poId = r.data.id
    r = await req(base, 'PATCH', `/api/purchase-orders/${poId}`, { token: empToken, body: { status: 'approved' } })
    ok('employee cannot self-approve PO (403)', r.status === 403)

    // 9. direct form creates appear in the company feed + notify the company
    r = await req(base, 'POST', '/api/invoices', { token: empToken, body: { vendor: 'FeedVendor', amount: 77 } })
    ok('direct invoice create ok', r.status === 201)
    const feedInvId = r.data.id
    let feed = (await req(base, 'GET', '/api/activity/company', { token: adminToken })).data
    ok('feed shows direct invoice create', feed.some((x) => x.entity === 'invoice' && /FeedVendor/.test(x.summary || '')))
    adminNotes = await notes(adminToken)
    ok('company notified of direct create', adminNotes.some((x) => /FeedVendor/.test(x.message || '')))
    r = await req(base, 'PATCH', `/api/invoices/${feedInvId}`, { token: adminToken, body: { status: 'approved' } })
    ok('admin PATCH approve ok', r.status === 200)
    feed = (await req(base, 'GET', '/api/activity/company', { token: adminToken })).data
    ok('feed shows the page approval', feed.some((x) => x.action === 'update' && /Approved invoice for FeedVendor/.test(x.summary || '')))
    r = await req(base, 'POST', '/api/expenses', { token: managerToken, body: { amount: 42, category: 'travel' } })
    ok('manager direct expense ok', r.status === 201)
    feed = (await req(base, 'GET', '/api/activity/company', { token: empToken })).data
    ok("employee sees manager's activity in feed", feed.some((x) => x.entity === 'expense' && x.actor_name === 'Mia Manager'))

    console.log(`\nAll ${n} activity checks passed.`)
  } finally {
    server.close()
  }
}

main().catch((e) => { console.error('ACTIVITY TEST FAIL:', e.message); process.exit(1) })

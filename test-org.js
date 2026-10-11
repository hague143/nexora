// Integration test: organization access control (invites, gating, admin panel API).
// Runs the real Express routes over HTTP on pg-mem.
process.env.JWT_SECRET = 'test-secret-for-org-tests'
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { newDb } = require('pg-mem')

let ipCounter = 1
async function req(base, method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.0.${ipCounter++}` }
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
  const { ensureOrgTables } = require('./server/org')
  await ensureOrgTables()

  const app = require('./server/app')
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  let n = 0
  const ok = (name, cond, extra = '') => {
    n += 1
    assert.ok(cond, `FAILED: ${name} ${extra}`)
    console.log(`  ok: ${name}`)
  }

  try {
    // admin login (seeded demo admin)
    let r = await req(base, 'POST', '/api/auth/login', { body: { email: 'maya@northwind.example', password: 'demo1234' } })
    ok('admin login', r.status === 200)
    const adminToken = r.data.token

    // 1. founder signup creates org + admin
    r = await req(base, 'POST', '/api/auth/signup', {
      body: { email: 'founder@acme.test', password: 'password123', full_name: 'Ada Founder', company_name: 'Acme Corp' },
    })
    ok('founder signup → 201 admin', r.status === 201 && r.data.user.role === 'admin')
    const founderToken = r.data.token

    // 2. stranger without invite and without company → blocked
    r = await req(base, 'POST', '/api/auth/signup', {
      body: { email: 'stranger@evil.test', password: 'password123', full_name: 'Eve Stranger' },
    })
    ok('uninvited signup → 403 NOT_INVITED', r.status === 403 && r.data.code === 'NOT_INVITED')

    // 3. google endpoint no longer auto-creates companies
    r = await req(base, 'POST', '/api/auth/google', { body: { email: 'random@gmail.com', full_name: 'Random' } })
    ok('google without invite → 403', r.status === 403)

    // 4. non-admin blocked from admin API
    // first make an employee via founder invite
    r = await req(base, 'POST', '/api/admin/invites', {
      token: founderToken, body: { emails: ['worker@acme.test'], role: 'employee', department: 'finance' },
    })
    ok('admin creates invite', r.status === 201 && r.data.invites[0].email === 'worker@acme.test')
    const inviteToken = r.data.invites[0].token
    r = await req(base, 'POST', '/api/auth/signup', {
      body: { email: 'worker@acme.test', password: 'password123', full_name: 'Wendy Worker' },
    })
    ok('invited signup joins company as employee', r.status === 201 && r.data.user.role === 'employee')
    const workerToken = r.data.token
    r = await req(base, 'GET', '/api/admin/members', { token: workerToken })
    ok('non-admin → 403 on admin API', r.status === 403)

    // 5. invite lookup by token (public, prefills signup)
    r = await req(base, 'GET', `/api/access/invite/${inviteToken}`)
    ok('invite already accepted → 404', r.status === 404) // invite was consumed by signup

    // 6. duplicate invite for existing user is skipped
    r = await req(base, 'POST', '/api/admin/invites', {
      token: founderToken, body: { emails: ['worker@acme.test', 'newbie@acme.test'] },
    })
    ok('existing user skipped, new invite created',
      r.data.invites.find((i) => i.email === 'worker@acme.test').skipped &&
      r.data.invites.find((i) => i.email === 'newbie@acme.test').token)

    // 7. revoke invite → signup blocked again
    const newbieInvite = r.data.invites.find((i) => i.email === 'newbie@acme.test')
    r = await req(base, 'DELETE', `/api/admin/invites/${newbieInvite.id}`, { token: founderToken })
    ok('revoke invite', r.status === 200)
    r = await req(base, 'POST', '/api/auth/signup', {
      body: { email: 'newbie@acme.test', password: 'password123', full_name: 'Nina Newbie' },
    })
    ok('revoked invite → 403', r.status === 403)

    // 8. join request → approve → signup works
    r = await req(base, 'POST', '/api/access/request', {
      body: { email: 'applicant@acme.test', full_name: 'Andy Applicant', company_name: 'Acme Corp' },
    })
    ok('join request created', r.status === 201)
    r = await req(base, 'GET', '/api/admin/requests', { token: founderToken })
    ok('admin sees request', r.status === 200 && r.data.requests.length === 1)
    const reqId = r.data.requests[0].id
    r = await req(base, 'POST', `/api/admin/requests/${reqId}/approve`, {
      token: founderToken, body: { role: 'manager', department: 'hr' },
    })
    ok('approve creates invite', r.status === 200 && r.data.invite.email === 'applicant@acme.test')
    r = await req(base, 'POST', '/api/auth/signup', {
      body: { email: 'applicant@acme.test', password: 'password123', full_name: 'Andy Applicant' },
    })
    ok('approved applicant joins as manager/hr',
      r.status === 201 && r.data.user.role === 'manager' && r.data.user.department === 'hr')

    // 9. join request → reject
    r = await req(base, 'POST', '/api/access/request', {
      body: { email: 'reject@acme.test', full_name: 'Rita Reject', company_name: 'Acme Corp' },
    })
    r = await req(base, 'GET', '/api/admin/requests', { token: founderToken })
    const rjId = r.data.requests.find((x) => x.email === 'reject@acme.test').id
    r = await req(base, 'POST', `/api/admin/requests/${rjId}/reject`, { token: founderToken })
    ok('reject request', r.status === 200)
    r = await req(base, 'POST', '/api/auth/signup', {
      body: { email: 'reject@acme.test', password: 'password123', full_name: 'Rita Reject' },
    })
    ok('rejected applicant → 403', r.status === 403)

    // 10. member role update + deactivation
    r = await req(base, 'GET', '/api/admin/members', { token: founderToken })
    const worker = r.data.members.find((m) => m.email === 'worker@acme.test')
    ok('members list', r.status === 200 && r.data.members.length === 3)
    r = await req(base, 'PATCH', `/api/admin/members/${worker.id}`, {
      token: founderToken, body: { role: 'manager' },
    })
    ok('promote to manager', r.status === 200 && r.data.member.role === 'manager')
    r = await req(base, 'DELETE', `/api/admin/members/${worker.id}`, { token: founderToken })
    ok('deactivate member', r.status === 200 && r.data.member.status === 'deactivated')
    r = await req(base, 'POST', '/api/auth/login', {
      body: { email: 'worker@acme.test', password: 'password123' },
    })
    ok('deactivated member cannot login', r.status === 403)

    // 11. safety rails: cannot deactivate self / last admin
    r = await req(base, 'DELETE', `/api/admin/members/${r.data.user?.id || 'me'}`, { token: founderToken })
    const me = await req(base, 'GET', '/api/me', { token: founderToken })
    r = await req(base, 'DELETE', `/api/admin/members/${me.data.user.id}`, { token: founderToken })
    ok('cannot deactivate self', r.status === 400)
    r = await req(base, 'PATCH', `/api/admin/members/${me.data.user.id}`, {
      token: founderToken, body: { role: 'employee' },
    })
    ok('cannot demote last admin', r.status === 400)

    console.log(`\nAll ${n} org access checks passed.`)
  } finally {
    server.close()
  }
}

main().catch((e) => { console.error('ORG TEST FAIL:', e.message); process.exit(1) })

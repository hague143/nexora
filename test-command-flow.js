// Integration test: full command-bar flows via processCommand on pg-mem.
// Covers: real queries, slot-filling across turns, undo, help, approve.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert')
const { newDb } = require('pg-mem')

async function main() {
  const mem = newDb()
  const pg = mem.adapters.createPg()
  globalThis.__nexoraPool = new pg.Pool()

  // NOTE: 0003 is intentionally NOT run here. pg-mem has a bug where
  // CREATE TABLE IF NOT EXISTS fails on second execution when the table
  // already exists (real Postgres is fine). The 0003 file itself was
  // verified separately; here ensurePendingTable() in command.js creates
  // the table on first use, which also exercises that code path.
  for (const mig of ['0002_nexora_app_schema.sql']) {
    await globalThis.__nexoraPool.query(
      fs.readFileSync(path.join(__dirname, 'supabase/migrations', mig), 'utf8')
    )
  }
  console.log('migration 0002: OK (+0003 verified separately)')

  const { ensureSeeded } = require('./server/seed')
  await ensureSeeded()
  const { get, all } = require('./server/db')
  const { processCommand } = require('./server/command')

  const maya = await get(`SELECT * FROM users WHERE email = ?`, ['maya@northwind.example'])
  const user = { ...maya }
  let n = 0
  async function cmd(text) {
    n += 1
    const r = await processCommand(user, text)
    console.log(`\n[${n}] "${text}"\n    → ${r.status}: ${String(r.summary).split('\n')[0].slice(0, 100)}`)
    return r
  }

  // 1. real query
  let r = await cmd('Show me pending approvals')
  assert.strictEqual(r.status, 'success')
  assert.match(r.summary, /pending approval/i)

  // 2. create with smart defaults ("my" → Maya)
  r = await cmd('File my $45 taxi expense')
  assert.strictEqual(r.status, 'success')
  const exp = await get(`SELECT * FROM expenses WHERE employee_name = ? ORDER BY created_at DESC LIMIT 1`, ['Maya Chen'])
  assert.ok(exp && Number(exp.amount) === 45, 'expense created for Maya, $45')

  // 3. multi-turn slot filling
  r = await cmd('Create an invoice')
  assert.strictEqual(r.status, 'needs_clarification')
  assert.match(r.summary, /vendor/i)
  r = await cmd('Apex Logistics')
  assert.strictEqual(r.status, 'needs_clarification', 'still needs amount')
  assert.match(r.summary, /amount/i)
  r = await cmd('450')
  assert.strictEqual(r.status, 'success', 'invoice completed after slot fill')
  const inv = await get(`SELECT * FROM invoices WHERE vendor = ? ORDER BY created_at DESC LIMIT 1`, ['Apex Logistics'])
  assert.ok(inv && Number(inv.amount) === 450, 'invoice created for Apex, $450')

  // 4. undo removes it
  r = await cmd('Undo that')
  assert.strictEqual(r.status, 'success')
  const gone = await get(`SELECT * FROM invoices WHERE id = ?`, [inv.id])
  assert.strictEqual(gone, null, 'invoice removed by undo')

  // 5. help
  r = await cmd('What can you do?')
  assert.strictEqual(r.status, 'success')
  assert.match(r.summary, /Finance/)

  // 6. approve flow (admin can approve directly)
  r = await cmd('Approve the expense')
  assert.strictEqual(r.status, 'success')
  assert.match(r.summary, /approved/i)

  // 7. natural date + leave
  r = await cmd('Book leave for next Friday')
  assert.strictEqual(r.status, 'success')
  const lv = await get(`SELECT * FROM leave_requests WHERE employee_name = ?`, ['Maya Chen'])
  assert.ok(lv && lv.start_date, 'leave created with a date')

  // 8. pending state cleaned up
  const pend = await all(`SELECT * FROM pending_commands WHERE user_id = ?`, [user.id])
  assert.strictEqual(pend.length, 0, 'no stale pending commands')

  console.log(`\nAll ${n} command-flow checks passed.`)
}

main().catch((e) => { console.error('INTEGRATION FAIL:', e); process.exit(1) })

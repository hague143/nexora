const bcrypt = require('bcryptjs')
const { randomUUID } = require('node:crypto')
const { get, run, now } = require('./db')

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

async function seed() {
  if (await get(`SELECT id FROM users LIMIT 1`)) return

  const companyId = randomUUID()
  const t = now()
  await run(`INSERT INTO companies (id, name, industry, created_at) VALUES (?, ?, ?, ?)`, [
    companyId,
    'Northwind Holdings',
    'Manufacturing',
    t,
  ])

  const passwordHash = bcrypt.hashSync('demo1234', 10)
  const adminId = randomUUID()
  const managerId = randomUUID()
  const employeeId = randomUUID()

  const users = [
    [adminId, 'maya@northwind.example', 'Maya Chen', 'finance', 'admin'],
    [managerId, 'jordan@northwind.example', 'Jordan Hale', 'hr', 'manager'],
    [employeeId, 'priya@northwind.example', 'Priya Nair', 'procurement', 'employee'],
  ]
  for (const [id, email, name, dept, role] of users) {
    await run(
      `INSERT INTO users (id, email, password_hash, full_name, company_id, department, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, email, passwordHash, name, companyId, dept, role, t]
    )
  }

  await run(
    `INSERT INTO invoices (id, company_id, vendor, amount, due_date, status, created_at) VALUES
     (?, ?, 'Apex Logistics', 4820, ?, 'pending', ?),
     (?, ?, 'Helix Cloud', 1290, ?, 'approved', ?),
     (?, ?, 'Summit Facilities', 760, ?, 'rejected', ?),
     (?, ?, 'Orbit Stationery', 214, ?, 'paid', ?)`,
    [
      randomUUID(), companyId, daysAgo(-7).slice(0, 10), daysAgo(16),
      randomUUID(), companyId, daysAgo(-10).slice(0, 10), daysAgo(6),
      randomUUID(), companyId, daysAgo(-3).slice(0, 10), daysAgo(9),
      randomUUID(), companyId, daysAgo(-20).slice(0, 10), daysAgo(14),
    ]
  )

  await run(
    `INSERT INTO expenses (id, company_id, employee_name, amount, category, status, created_at) VALUES
     (?, ?, 'Sarah Kim', 200, 'travel', 'pending', ?),
     (?, ?, 'Priya Nair', 86, 'meals', 'approved', ?)`,
    [randomUUID(), companyId, daysAgo(1), randomUUID(), companyId, daysAgo(4)]
  )

  await run(
    `INSERT INTO leave_requests (id, company_id, employee_id, employee_name, type, start_date, end_date, status) VALUES
     (?, ?, ?, 'Priya Nair', 'annual', '2026-09-15', '2026-09-19', 'pending'),
     (?, ?, ?, 'Jordan Hale', 'sick', '2026-09-04', '2026-09-05', 'approved')`,
    [randomUUID(), companyId, employeeId, randomUUID(), companyId, managerId]
  )

  await run(
    `INSERT INTO purchase_orders (id, company_id, item, quantity, amount, status) VALUES
     (?, ?, 'Industrial sensors (lot of 40)', 40, 6200, 'pending'),
     (?, ?, 'Safety PPE restock', 120, 980, 'approved'),
     (?, ?, 'Warehouse racking kits', 6, 4100, 'fulfilled')`,
    [randomUUID(), companyId, randomUUID(), companyId, randomUUID(), companyId]
  )

  await run(
    `INSERT INTO employees (id, company_id, full_name, email, department, title, status, start_date, created_at) VALUES
     (?, ?, 'Priya Nair', 'priya@northwind.example', 'procurement', 'Buyer', 'active', '2024-03-01', ?),
     (?, ?, 'Jordan Hale', 'jordan@northwind.example', 'hr', 'People manager', 'active', '2023-01-12', ?)`,
    [randomUUID(), companyId, t, randomUUID(), companyId, t]
  )

  await run(
    `INSERT INTO shipments (id, company_id, carrier, tracking, origin, destination, status, created_at) VALUES
     (?, ?, 'Apex Freight', 'AX-44192', 'Chicago', 'Dallas DC', 'in_transit', ?),
     (?, ?, 'Harbor Line', 'HL-2291', 'Oakland', 'Seattle', 'delivered', ?)`,
    [randomUUID(), companyId, daysAgo(2), randomUUID(), companyId, daysAgo(8)]
  )

  await run(
    `INSERT INTO inventory_items (id, company_id, sku, name, quantity, reorder_level, status, created_at) VALUES
     (?, ?, 'SNS-40', 'Industrial sensors', 12, 20, 'low', ?),
     (?, ?, 'PPE-01', 'Safety gloves', 400, 80, 'ok', ?)`,
    [randomUUID(), companyId, t, randomUUID(), companyId, t]
  )

  await run(
    `INSERT INTO quality_inspections (id, company_id, lot, inspector, due_date, result, status, created_at) VALUES
     (?, ?, 'LOT-8841', 'Maya Chen', ?, NULL, 'pending', ?),
     (?, ?, 'LOT-7702', 'Jordan Hale', ?, 'pass', 'approved', ?)`,
    [randomUUID(), companyId, daysAgo(-1).slice(0, 10), daysAgo(3), randomUUID(), companyId, daysAgo(10).slice(0, 10), daysAgo(10)]
  )

  await run(
    `INSERT INTO quality_issues (id, company_id, title, severity, status, created_at) VALUES
     (?, ?, 'Sensor calibration drift on line 2', 'high', 'open', ?),
     (?, ?, 'Packaging scuff on outbound cartons', 'low', 'resolved', ?)`,
    [randomUUID(), companyId, daysAgo(2), randomUUID(), companyId, daysAgo(12)]
  )

  const inv = await get(`SELECT id FROM invoices WHERE vendor = 'Helix Cloud'`)
  await run(
    `INSERT INTO workflow_actions (id, user_id, company_id, department, action, entity, entity_id, fields, status, summary, created_at, resolved_at)
     VALUES (?, ?, ?, 'finance', 'approve', 'invoice', ?, '{}', 'completed', ?, ?, ?)`,
    [randomUUID(), managerId, companyId, inv?.id || null, 'Approved Helix Cloud invoice for $1,290', daysAgo(6), daysAgo(6)]
  )
  await run(
    `INSERT INTO workflow_actions (id, user_id, company_id, department, action, entity, entity_id, fields, status, summary, created_at)
     VALUES (?, ?, ?, 'hr', 'approve', 'leave_request', NULL, '{}', 'completed', 'Approved Jordan Hale sick leave', ?)`,
    [randomUUID(), adminId, companyId, daysAgo(1)]
  )
  await run(
    `INSERT INTO workflow_actions (id, user_id, company_id, department, action, entity, entity_id, fields, status, summary, created_at)
     VALUES (?, ?, ?, 'finance', 'approve', 'expense', NULL, '{"person":"Sarah","amount":200}', 'pending_approval', ?, ?)`,
    [randomUUID(), employeeId, companyId, 'Sarah $200 expense awaiting approval', daysAgo(0)]
  )

  await run(
    `INSERT INTO notifications (id, user_id, company_id, type, title, message, is_read, created_at) VALUES
     (?, ?, ?, 'approval_needed', 'Invoice awaiting review', ?, 0, ?),
     (?, ?, ?, 'status_update', 'PO fulfilled', 'Warehouse racking kits marked fulfilled.', 1, ?)`,
    [randomUUID(), adminId, companyId, 'Apex Logistics $4,820 is pending approval.', daysAgo(1), randomUUID(), adminId, companyId, daysAgo(3)]
  )

  const depts = ['finance', 'hr', 'procurement', 'supply_chain', 'quality']
  const entities = ['invoice', 'leave_request', 'purchase_order', 'shipment', 'quality_issue']
  const days = [0, 1, 2, 3, 4, 5, 6, 8, 10]
  for (let i = 0; i < days.length; i += 1) {
    await run(
      `INSERT INTO workflow_actions (id, user_id, company_id, department, action, entity, entity_id, fields, status, summary, created_at, resolved_at)
       VALUES (?, ?, ?, ?, 'create', ?, NULL, '{}', 'completed', ?, ?, ?)`,
      [
        randomUUID(),
        adminId,
        companyId,
        depts[i % 5],
        entities[i % 5],
        `Seeded action ${i}`,
        daysAgo(days[i]),
        daysAgo(days[i]),
      ]
    )
  }
}

// Idempotent: safe to call on every serverless invocation.
async function ensureSeeded() {
  try {
    await seed()
  } catch (err) {
    console.error('[seed] failed', err.message)
  }
}

module.exports = { seed, ensureSeeded }

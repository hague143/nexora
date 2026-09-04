const bcrypt = require('bcryptjs')
const { randomUUID } = require('node:crypto')
const { get, run, now } = require('./db')

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function seed() {
  if (get(`SELECT id FROM users LIMIT 1`)) return

  const companyId = randomUUID()
  const t = now()
  run(`INSERT INTO companies (id, name, industry, created_at) VALUES (?, ?, ?, ?)`, [
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
  users.forEach(([id, email, name, dept, role]) => {
    run(
      `INSERT INTO users (id, email, password_hash, full_name, company_id, department, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, email, passwordHash, name, companyId, dept, role, t]
    )
  })

  run(
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

  run(
    `INSERT INTO expenses (id, company_id, employee_name, amount, category, status, created_at) VALUES
     (?, ?, 'Sarah Kim', 200, 'travel', 'pending', ?),
     (?, ?, 'Priya Nair', 86, 'meals', 'approved', ?)`,
    [randomUUID(), companyId, daysAgo(1), randomUUID(), companyId, daysAgo(4)]
  )

  run(
    `INSERT INTO leave_requests (id, company_id, employee_id, employee_name, type, start_date, end_date, status) VALUES
     (?, ?, ?, 'Priya Nair', 'annual', '2026-09-15', '2026-09-19', 'pending'),
     (?, ?, ?, 'Jordan Hale', 'sick', '2026-09-04', '2026-09-05', 'approved')`,
    [randomUUID(), companyId, employeeId, randomUUID(), companyId, managerId]
  )

  run(
    `INSERT INTO purchase_orders (id, company_id, item, quantity, amount, status) VALUES
     (?, ?, 'Industrial sensors (lot of 40)', 40, 6200, 'pending'),
     (?, ?, 'Safety PPE restock', 120, 980, 'approved'),
     (?, ?, 'Warehouse racking kits', 6, 4100, 'fulfilled')`,
    [randomUUID(), companyId, randomUUID(), companyId, randomUUID(), companyId]
  )

  run(
    `INSERT INTO employees (id, company_id, full_name, email, department, title, status, start_date, created_at) VALUES
     (?, ?, 'Priya Nair', 'priya@northwind.example', 'procurement', 'Buyer', 'active', '2024-03-01', ?),
     (?, ?, 'Jordan Hale', 'jordan@northwind.example', 'hr', 'People manager', 'active', '2023-01-12', ?)`,
    [randomUUID(), companyId, t, randomUUID(), companyId, t]
  )

  run(
    `INSERT INTO shipments (id, company_id, carrier, tracking, origin, destination, status, created_at) VALUES
     (?, ?, 'Apex Freight', 'AX-44192', 'Chicago', 'Dallas DC', 'in_transit', ?),
     (?, ?, 'Harbor Line', 'HL-2291', 'Oakland', 'Seattle', 'delivered', ?)`,
    [randomUUID(), companyId, daysAgo(2), randomUUID(), companyId, daysAgo(8)]
  )

  run(
    `INSERT INTO inventory_items (id, company_id, sku, name, quantity, reorder_level, status, created_at) VALUES
     (?, ?, 'SNS-40', 'Industrial sensors', 12, 20, 'low', ?),
     (?, ?, 'PPE-01', 'Safety gloves', 400, 80, 'ok', ?)`,
    [randomUUID(), companyId, t, randomUUID(), companyId, t]
  )

  run(
    `INSERT INTO quality_inspections (id, company_id, lot, inspector, due_date, result, status, created_at) VALUES
     (?, ?, 'LOT-8841', 'Maya Chen', ?, NULL, 'pending', ?),
     (?, ?, 'LOT-7702', 'Jordan Hale', ?, 'pass', 'approved', ?)`,
    [randomUUID(), companyId, daysAgo(-1).slice(0, 10), daysAgo(3), randomUUID(), companyId, daysAgo(10).slice(0, 10), daysAgo(10)]
  )

  run(
    `INSERT INTO quality_issues (id, company_id, title, severity, status, created_at) VALUES
     (?, ?, 'Sensor calibration drift on line 2', 'high', 'open', ?),
     (?, ?, 'Packaging scuff on outbound cartons', 'low', 'resolved', ?)`,
    [randomUUID(), companyId, daysAgo(2), randomUUID(), companyId, daysAgo(12)]
  )

  const inv = get(`SELECT id FROM invoices WHERE vendor = 'Helix Cloud'`)
  run(
    `INSERT INTO workflow_actions (id, user_id, company_id, department, action, entity, entity_id, fields, status, summary, created_at, resolved_at)
     VALUES (?, ?, ?, 'finance', 'approve', 'invoice', ?, '{}', 'completed', 'Approved Helix Cloud invoice for $1,290', ?, ?)`,
    [randomUUID(), managerId, companyId, inv?.id || null, daysAgo(6), daysAgo(6)]
  )
  run(
    `INSERT INTO workflow_actions (id, user_id, company_id, department, action, entity, entity_id, fields, status, summary, created_at)
     VALUES (?, ?, ?, 'hr', 'approve', 'leave_request', NULL, '{}', 'completed', 'Approved Jordan Hale sick leave', ?)`,
    [randomUUID(), adminId, companyId, daysAgo(1)]
  )
  run(
    `INSERT INTO workflow_actions (id, user_id, company_id, department, action, entity, entity_id, fields, status, summary, created_at)
     VALUES (?, ?, ?, 'finance', 'approve', 'expense', NULL, '{"person":"Sarah","amount":200}', 'pending_approval', 'Sarah $200 expense awaiting approval', ?)`,
    [randomUUID(), employeeId, companyId, daysAgo(0)]
  )

  run(
    `INSERT INTO notifications (id, user_id, company_id, type, title, message, is_read, created_at) VALUES
     (?, ?, ?, 'approval_needed', 'Invoice awaiting review', 'Apex Logistics $4,820 is pending approval.', 0, ?),
     (?, ?, ?, 'status_update', 'PO fulfilled', 'Warehouse racking kits marked fulfilled.', 1, ?)`,
    [randomUUID(), adminId, companyId, daysAgo(1), randomUUID(), adminId, companyId, daysAgo(3)]
  )

  ;[0, 1, 2, 3, 4, 5, 6, 8, 10].forEach((d, i) => {
    run(
      `INSERT INTO workflow_actions (id, user_id, company_id, department, action, entity, entity_id, fields, status, summary, created_at, resolved_at)
       VALUES (?, ?, ?, ?, 'create', ?, NULL, '{}', 'completed', ?, ?, ?)`,
      [
        randomUUID(),
        adminId,
        companyId,
        ['finance', 'hr', 'procurement', 'supply_chain', 'quality'][i % 5],
        ['invoice', 'leave_request', 'purchase_order', 'shipment', 'quality_issue'][i % 5],
        `Seeded action ${i}`,
        daysAgo(d),
        daysAgo(d),
      ]
    )
  })
}

module.exports = { seed }

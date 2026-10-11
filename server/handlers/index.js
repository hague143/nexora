const { randomUUID } = require('node:crypto')
const { run, get, all, now } = require('../db')
const { sendToExternalSystem } = require('../integrations/external')

function ok(message, data) {
  return { success: true, message, data }
}

function fail(message) {
  const err = new Error(message)
  err.handler = true
  throw err
}

async function writeAction(user, parsed, status, extra = {}) {
  const id = extra.id || randomUUID()
  await run(
    `INSERT INTO workflow_actions
      (id, user_id, company_id, department, action, entity, entity_id, fields, status, summary, error_message, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      user.id,
      user.company_id,
      parsed.department,
      parsed.action,
      parsed.entity,
      extra.entity_id || parsed.entity_id || null,
      JSON.stringify({ ...(parsed.fields || {}), command: extra.command || null }),
      status,
      extra.summary || extra.message || '',
      extra.error_message || null,
      now(),
      status === 'completed' || status === 'rejected' || status === 'failed' ? now() : null,
    ]
  )
  return get(`SELECT * FROM workflow_actions WHERE id = ?`, [id])
}

const financeHandlers = {
  async createExpense(user, parsed) {
    const f = parsed.fields || {}
    const id = randomUUID()
    await run(
      `INSERT INTO expenses (id, company_id, employee_name, amount, category, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, user.company_id, f.employee_name || f.person || user.full_name, Number(f.amount || 0), f.category || 'general', now()]
    )
    const data = await get(`SELECT * FROM expenses WHERE id = ?`, [id])
    await sendToExternalSystem('finance', { op: 'createExpense', data })
    return ok(`Created expense for ${data.employee_name} ($${data.amount})`, data)
  },
  async approveExpense(user, parsed) {
    const row = await findExpense(user.company_id, parsed)
    if (!row) fail('No matching expense found.')
    await run(`UPDATE expenses SET status = 'approved' WHERE id = ?`, [row.id])
    const data = await get(`SELECT * FROM expenses WHERE id = ?`, [row.id])
    await sendToExternalSystem('finance', { op: 'approveExpense', data })
    return ok(`Approved ${data.employee_name}'s $${data.amount} expense`, data)
  },
  async createInvoice(user, parsed) {
    const f = parsed.fields || {}
    const id = randomUUID()
    await run(
      `INSERT INTO invoices (id, company_id, vendor, amount, due_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, user.company_id, f.vendor || f.person || 'Unknown vendor', Number(f.amount || 0), f.due_date || null, now()]
    )
    const data = await get(`SELECT * FROM invoices WHERE id = ?`, [id])
    await sendToExternalSystem('finance', { op: 'createInvoice', data })
    return ok(`Created invoice for ${data.vendor} ($${data.amount})`, data)
  },
  async approveInvoice(user, parsed) {
    const row = await findInvoice(user.company_id, parsed)
    if (!row) fail('No matching invoice found.')
    await run(`UPDATE invoices SET status = 'approved' WHERE id = ?`, [row.id])
    const data = await get(`SELECT * FROM invoices WHERE id = ?`, [row.id])
    await sendToExternalSystem('finance', { op: 'approveInvoice', data })
    return ok(`Approved ${data.vendor} invoice for $${data.amount}`, data)
  },
}

const hrHandlers = {
  async createLeaveRequest(user, parsed) {
    const f = parsed.fields || {}
    const id = randomUUID()
    const start = f.start_date || new Date().toISOString().slice(0, 10)
    const end = f.end_date || start
    await run(
      `INSERT INTO leave_requests (id, company_id, employee_id, employee_name, type, start_date, end_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [id, user.company_id, user.id, f.person || user.full_name, f.type || 'annual', start, end]
    )
    const data = await get(`SELECT * FROM leave_requests WHERE id = ?`, [id])
    await sendToExternalSystem('hr', { op: 'createLeaveRequest', data })
    return ok(`Filed ${data.type} leave for ${data.employee_name}`, data)
  },
  async approveLeaveRequest(user, parsed) {
    const row = await findLeave(user.company_id, parsed)
    if (!row) fail('No matching leave request found.')
    await run(`UPDATE leave_requests SET status = 'approved' WHERE id = ?`, [row.id])
    const data = await get(`SELECT * FROM leave_requests WHERE id = ?`, [row.id])
    await sendToExternalSystem('hr', { op: 'approveLeaveRequest', data })
    return ok(`Approved ${data.employee_name}'s ${data.type} leave`, data)
  },
  async onboardEmployee(user, parsed) {
    const f = parsed.fields || {}
    const id = randomUUID()
    await run(
      `INSERT INTO employees (id, company_id, full_name, email, department, title, status, start_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'onboarding', ?, ?)`,
      [
        id,
        user.company_id,
        f.person || f.full_name || 'New hire',
        f.email || null,
        f.department || 'general',
        f.title || 'Team member',
        f.start_date || now().slice(0, 10),
        now(),
      ]
    )
    const data = await get(`SELECT * FROM employees WHERE id = ?`, [id])
    await sendToExternalSystem('hr', { op: 'onboardEmployee', data })
    return ok(`Started onboarding for ${data.full_name}`, data)
  },
}

const procurementHandlers = {
  async createPurchaseOrder(user, parsed) {
    const f = parsed.fields || {}
    const id = randomUUID()
    await run(
      `INSERT INTO purchase_orders (id, company_id, item, quantity, amount, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, user.company_id, f.item || f.description || 'Unnamed item', Number(f.quantity || 1), Number(f.amount || 0)]
    )
    const data = await get(`SELECT * FROM purchase_orders WHERE id = ?`, [id])
    await sendToExternalSystem('procurement', { op: 'createPurchaseOrder', data })
    return ok(`Created PO for ${data.item} (qty ${data.quantity})`, data)
  },
  async approvePurchaseOrder(user, parsed) {
    const row = await findPo(user.company_id, parsed)
    if (!row) fail('No matching purchase order found.')
    await run(`UPDATE purchase_orders SET status = 'approved' WHERE id = ?`, [row.id])
    const data = await get(`SELECT * FROM purchase_orders WHERE id = ?`, [row.id])
    await sendToExternalSystem('procurement', { op: 'approvePurchaseOrder', data })
    return ok(`Approved PO for ${data.item}`, data)
  },
}

const supplyChainHandlers = {
  async createShipment(user, parsed) {
    const f = parsed.fields || {}
    const id = randomUUID()
    await run(
      `INSERT INTO shipments (id, company_id, carrier, tracking, origin, destination, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'created', ?)`,
      [id, user.company_id, f.carrier || 'Internal fleet', f.tracking || null, f.origin || 'HQ', f.destination || 'Customer', now()]
    )
    const data = await get(`SELECT * FROM shipments WHERE id = ?`, [id])
    await sendToExternalSystem('supply_chain', { op: 'createShipment', data })
    return ok(`Created shipment to ${data.destination}`, data)
  },
  async updateShipmentStatus(user, parsed) {
    const f = parsed.fields || {}
    const row = await findShipment(user.company_id, parsed)
    if (!row) fail('No matching shipment found.')
    await run(`UPDATE shipments SET status = ? WHERE id = ?`, [f.status || 'in_transit', row.id])
    const data = await get(`SELECT * FROM shipments WHERE id = ?`, [row.id])
    await sendToExternalSystem('supply_chain', { op: 'updateShipmentStatus', data })
    return ok(`Shipment ${data.id.slice(0, 8)} is now ${data.status}`, data)
  },
  async createInventoryItem(user, parsed) {
    const f = parsed.fields || {}
    const id = randomUUID()
    const qty = Number(f.quantity || 0)
    const reorder = Number(f.reorder_level || 10)
    await run(
      `INSERT INTO inventory_items (id, company_id, sku, name, quantity, reorder_level, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, user.company_id, f.sku || `SKU-${id.slice(0, 6)}`, f.name || f.item || 'Item', qty, reorder, qty <= reorder ? 'low' : 'ok', now()]
    )
    const data = await get(`SELECT * FROM inventory_items WHERE id = ?`, [id])
    await sendToExternalSystem('supply_chain', { op: 'createInventoryItem', data })
    return ok(`Added inventory item ${data.name}`, data)
  },
  async updateInventoryLevel(user, parsed) {
    const f = parsed.fields || {}
    const row = await findInventory(user.company_id, parsed)
    if (!row) fail('No matching inventory item found.')
    const qty = Number(f.quantity ?? f.level ?? row.quantity)
    const status = qty <= row.reorder_level ? 'low' : 'ok'
    await run(`UPDATE inventory_items SET quantity = ?, status = ? WHERE id = ?`, [qty, status, row.id])
    const data = await get(`SELECT * FROM inventory_items WHERE id = ?`, [row.id])
    await sendToExternalSystem('supply_chain', { op: 'updateInventoryLevel', data })
    return ok(`Updated ${data.name} stock to ${data.quantity}`, data)
  },
  async flagLowStock(user, parsed) {
    const row = await findInventory(user.company_id, parsed)
    if (!row) fail('No matching inventory item found.')
    await run(`UPDATE inventory_items SET status = 'low' WHERE id = ?`, [row.id])
    const data = await get(`SELECT * FROM inventory_items WHERE id = ?`, [row.id])
    await sendToExternalSystem('supply_chain', { op: 'flagLowStock', data })
    return ok(`Flagged ${data.name} as low stock`, data)
  },
}

const qualityHandlers = {
  async createQualityInspection(user, parsed) {
    const f = parsed.fields || {}
    const id = randomUUID()
    await run(
      `INSERT INTO quality_inspections (id, company_id, lot, inspector, due_date, result, status, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?)`,
      [id, user.company_id, f.lot || 'LOT-NEW', f.inspector || user.full_name, f.due_date || null, now()]
    )
    const data = await get(`SELECT * FROM quality_inspections WHERE id = ?`, [id])
    await sendToExternalSystem('quality', { op: 'createQualityInspection', data })
    return ok(`Scheduled inspection for ${data.lot}`, data)
  },
  async logQualityIssue(user, parsed) {
    const f = parsed.fields || {}
    const id = randomUUID()
    await run(
      `INSERT INTO quality_issues (id, company_id, title, severity, status, created_at)
       VALUES (?, ?, ?, ?, 'open', ?)`,
      [id, user.company_id, f.title || f.description || 'Quality issue', f.severity || 'medium', now()]
    )
    const data = await get(`SELECT * FROM quality_issues WHERE id = ?`, [id])
    await sendToExternalSystem('quality', { op: 'logQualityIssue', data })
    return ok(`Logged quality issue: ${data.title}`, data)
  },
  async resolveQualityIssue(user, parsed) {
    const row = await findIssue(user.company_id, parsed)
    if (!row) fail('No matching quality issue found.')
    await run(`UPDATE quality_issues SET status = 'resolved' WHERE id = ?`, [row.id])
    const data = await get(`SELECT * FROM quality_issues WHERE id = ?`, [row.id])
    await sendToExternalSystem('quality', { op: 'resolveQualityIssue', data })
    return ok(`Resolved quality issue ${data.title}`, data)
  },
  async approveQualityInspection(user, parsed) {
    const row = await findInspection(user.company_id, parsed)
    if (!row) fail('No matching inspection found.')
    await run(`UPDATE quality_inspections SET status = 'approved', result = 'pass' WHERE id = ?`, [row.id])
    const data = await get(`SELECT * FROM quality_inspections WHERE id = ?`, [row.id])
    await sendToExternalSystem('quality', { op: 'approveQualityInspection', data })
    return ok(`Approved inspection ${data.lot}`, data)
  },
}

const handlers = {
  finance: {
    expense: { create: financeHandlers.createExpense, approve: financeHandlers.approveExpense, reject: rejectWrapper('expenses') },
    invoice: { create: financeHandlers.createInvoice, approve: financeHandlers.approveInvoice, reject: rejectWrapper('invoices') },
  },
  hr: {
    leave_request: {
      create: async (user, parsed) => {
        if (parsed.fields?.onboard) return hrHandlers.onboardEmployee(user, parsed)
        return hrHandlers.createLeaveRequest(user, parsed)
      },
      approve: hrHandlers.approveLeaveRequest,
      reject: rejectWrapper('leave_requests'),
    },
  },
  procurement: {
    purchase_order: { create: procurementHandlers.createPurchaseOrder, approve: procurementHandlers.approvePurchaseOrder, reject: rejectWrapper('purchase_orders') },
  },
  supply_chain: {
    shipment: { create: supplyChainHandlers.createShipment, update: supplyChainHandlers.updateShipmentStatus },
    inventory_item: {
      create: supplyChainHandlers.createInventoryItem,
      update: supplyChainHandlers.updateInventoryLevel,
    },
  },
  quality: {
    quality_inspection: { create: qualityHandlers.createQualityInspection, approve: qualityHandlers.approveQualityInspection },
    quality_issue: { create: qualityHandlers.logQualityIssue, update: qualityHandlers.resolveQualityIssue },
  },
}

function rejectWrapper(table) {
  return async (user, parsed) => {
    const finder = {
      expenses: findExpense,
      invoices: findInvoice,
      leave_requests: findLeave,
      purchase_orders: findPo,
    }[table]
    const row = await finder(user.company_id, parsed)
    if (!row) fail(`No matching ${table} record found.`)
    await run(`UPDATE ${table} SET status = 'rejected' WHERE id = ?`, [row.id])
    const data = await get(`SELECT * FROM ${table} WHERE id = ?`, [row.id])
    return ok(`Rejected record ${row.id.slice(0, 8)}`, data)
  }
}

handlers.supply_chain.inventory_item.approve = supplyChainHandlers.flagLowStock

async function findInvoice(cid, parsed) {
  if (parsed.entity_id) return get(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`, [parsed.entity_id, cid])
  const vendor = String(parsed.fields?.vendor || parsed.fields?.person || '').toLowerCase()
  const amount = Number(parsed.fields?.amount)
  const rows = await all(`SELECT * FROM invoices WHERE company_id = ?`, [cid])
  return rows.find((r) => (vendor && r.vendor.toLowerCase().includes(vendor)) || (!Number.isNaN(amount) && Number(r.amount) === amount))
}
async function findExpense(cid, parsed) {
  if (parsed.entity_id) return get(`SELECT * FROM expenses WHERE id = ? AND company_id = ?`, [parsed.entity_id, cid])
  const person = String(parsed.fields?.person || parsed.fields?.employee_name || '').toLowerCase()
  const amount = Number(parsed.fields?.amount)
  const rows = await all(`SELECT * FROM expenses WHERE company_id = ?`, [cid])
  return rows.find((r) => (person && r.employee_name.toLowerCase().includes(person)) || (!Number.isNaN(amount) && Number(r.amount) === amount))
}
async function findLeave(cid, parsed) {
  if (parsed.entity_id) return get(`SELECT * FROM leave_requests WHERE id = ? AND company_id = ?`, [parsed.entity_id, cid])
  const person = String(parsed.fields?.person || '').toLowerCase()
  const rows = await all(`SELECT * FROM leave_requests WHERE company_id = ? AND status = 'pending'`, [cid])
  return rows.find((r) => !person || r.employee_name.toLowerCase().includes(person)) || rows[0]
}
async function findPo(cid, parsed) {
  if (parsed.entity_id) return get(`SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?`, [parsed.entity_id, cid])
  const item = String(parsed.fields?.item || '').toLowerCase()
  const rows = await all(`SELECT * FROM purchase_orders WHERE company_id = ?`, [cid])
  return rows.find((r) => r.status === 'pending' && (!item || r.item.toLowerCase().includes(item))) || rows[0]
}
async function findShipment(cid, parsed) {
  if (parsed.entity_id) return get(`SELECT * FROM shipments WHERE id = ? AND company_id = ?`, [parsed.entity_id, cid])
  return (await all(`SELECT * FROM shipments WHERE company_id = ? ORDER BY created_at DESC`, [cid]))[0]
}
async function findInventory(cid, parsed) {
  if (parsed.entity_id) return get(`SELECT * FROM inventory_items WHERE id = ? AND company_id = ?`, [parsed.entity_id, cid])
  const name = String(parsed.fields?.name || parsed.fields?.item || parsed.fields?.sku || '').toLowerCase()
  const rows = await all(`SELECT * FROM inventory_items WHERE company_id = ?`, [cid])
  return rows.find((r) => !name || r.name.toLowerCase().includes(name) || r.sku.toLowerCase().includes(name)) || rows[0]
}
async function findIssue(cid, parsed) {
  if (parsed.entity_id) return get(`SELECT * FROM quality_issues WHERE id = ? AND company_id = ?`, [parsed.entity_id, cid])
  return (await all(`SELECT * FROM quality_issues WHERE company_id = ? AND status = 'open'`, [cid]))[0]
}
async function findInspection(cid, parsed) {
  if (parsed.entity_id) return get(`SELECT * FROM quality_inspections WHERE id = ? AND company_id = ?`, [parsed.entity_id, cid])
  return (await all(`SELECT * FROM quality_inspections WHERE company_id = ? AND status = 'pending'`, [cid]))[0]
}

async function dispatch(user, parsed) {
  if (parsed.action === 'query') {
    return ok(`Looked up ${parsed.entity} in ${parsed.department}`, { parsed })
  }
  let fn = handlers[parsed.department]?.[parsed.entity]?.[parsed.action]
  if (!fn && parsed.entity === 'leave_request' && parsed.action === 'create' && parsed.fields?.onboard) {
    fn = hrHandlers.onboardEmployee
  }
  if (!fn && parsed.action === 'create' && parsed.entity === 'quality_issue') fn = qualityHandlers.logQualityIssue
  if (!fn && parsed.action === 'update' && parsed.entity === 'quality_issue') fn = qualityHandlers.resolveQualityIssue
  if (!fn && parsed.action === 'create' && (parsed.fields?.onboard || /onboard|hire/.test(String(parsed.fields?.type || '')))) {
    fn = hrHandlers.onboardEmployee
  }
  if (!fn) fail(`No handler for ${parsed.department}/${parsed.entity}/${parsed.action}`)
  return fn(user, parsed)
}

module.exports = {
  handlers,
  dispatch,
  writeAction,
  financeHandlers,
  hrHandlers,
  procurementHandlers,
  supplyChainHandlers,
  qualityHandlers,
}

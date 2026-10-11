// Unit tests for the rule-based NLU engine (no DB, no network, no API key).
const assert = require('node:assert')
const nlu = require('./server/nlu')

const user = { id: 'u1', full_name: 'Maya Chen', role: 'admin', company_id: 'c1' }
let passed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok: ${name}`) }
  catch (e) { console.error(`  FAIL: ${name}\n    ${e.message}`); process.exitCode = 1 }
}

console.log('— extractors —')
check('amount $1,200.50', () => assert.strictEqual(nlu.extractAmount('Pay $1,200.50 now'), 1200.5))
check('amount $5k', () => assert.strictEqual(nlu.extractAmount('budget $5k'), 5000))
check('amount 200 dollars', () => assert.strictEqual(nlu.extractAmount('200 dollars for travel'), 200))
check('amount USD 300', () => assert.strictEqual(nlu.extractAmount('USD 300'), 300))
check('quantity qty 40', () => assert.strictEqual(nlu.extractQuantity('gloves, qty 40'), 40))
check('quantity 40 units', () => assert.strictEqual(nlu.extractQuantity('40 units of cable'), 40))
check('date tomorrow', () => {
  const d = new Date(); d.setDate(d.getDate() + 1)
  assert.strictEqual(nlu.extractDate('ship it tomorrow'), d.toISOString().slice(0, 10))
})
check('date next Friday', () => {
  const ref = new Date(2026, 9, 12) // Mon Oct 12 2026
  assert.strictEqual(nlu.extractDate('leave next Friday', ref), '2026-10-16')
})
check('date "next Friday" on a Friday → +7', () => {
  const ref = new Date(2026, 9, 16) // Fri Oct 16 2026
  assert.strictEqual(nlu.extractDate('leave next Friday', ref), '2026-10-23')
})
check('date in 3 days', () => {
  const ref = new Date(2026, 9, 12)
  assert.strictEqual(nlu.extractDate('remind me in 3 days', ref), '2026-10-15')
})
check('date Oct 20', () => {
  const ref = new Date(2026, 9, 12)
  assert.strictEqual(nlu.extractDate('due on Oct 20', ref), '2026-10-20')
})
check('date end of month', () => {
  const ref = new Date(2026, 9, 12)
  assert.strictEqual(nlu.extractDate('by end of month', ref), '2026-10-31')
})

console.log('— intents —')
check('approve intent + synonyms', () => {
  for (const t of ['Approve the invoice', 'Sign off on the PO', 'Greenlight the invoice', 'ok the leave']) {
    const p = nlu.parseNaturalLanguage(t, user)
    assert.strictEqual(p.action, 'approve', t)
  }
})
check('reject synonyms', () => {
  for (const t of ['Reject the invoice', 'Turn down the PO request', 'Decline the invoice']) {
    assert.strictEqual(nlu.parseNaturalLanguage(t, user).action, 'reject', t)
  }
})
check('undo intent', () => {
  const p = nlu.parseNaturalLanguage('undo that', user)
  assert.strictEqual(p.intent, 'undo')
})
check('help intent', () => {
  assert.strictEqual(nlu.parseNaturalLanguage('what can you do?', user).intent, 'help')
})
check('query: show pending approvals', () => {
  const p = nlu.parseNaturalLanguage('Show me pending approvals', user)
  assert.strictEqual(p.action, 'query'); assert.strictEqual(p.entity, 'approvals')
})
check('cancel intent', () => {
  const p = nlu.parseNaturalLanguage('Cancel the PO for gloves', user)
  assert.strictEqual(p.action, 'cancel'); assert.strictEqual(p.entity, 'purchase_order')
})

console.log('— entities & slots —')
check('expense with my + amount', () => {
  const p = nlu.parseNaturalLanguage('File my $45 taxi expense', user)
  assert.strictEqual(p.entity, 'expense'); assert.strictEqual(p.fields.amount, 45)
  assert.strictEqual(p.fields.person, 'Maya Chen')
  assert.deepStrictEqual(nlu.getMissingSlots(p), [])
})
check('invoice missing vendor+amount → slots', () => {
  const p = nlu.parseNaturalLanguage('Create an invoice', user)
  assert.strictEqual(p.entity, 'invoice')
  assert.deepStrictEqual(nlu.getMissingSlots(p), ['vendor', 'amount'])
  assert.match(nlu.slotQuestion(p.action, p.entity, 'vendor'), /vendor/i)
})
check('leave next Friday → dates', () => {
  const p = nlu.parseNaturalLanguage('Book leave for next Friday', user)
  assert.strictEqual(p.entity, 'leave_request')
  assert.ok(p.fields.start_date, 'start_date set')
  assert.deepStrictEqual(nlu.getMissingSlots(p), [])
})
check('PO item/qty/amount extraction', () => {
  const p = nlu.parseNaturalLanguage('Raise a PO for safety gloves, qty 40, $320', user)
  assert.strictEqual(p.entity, 'purchase_order')
  assert.strictEqual(p.fields.item, 'safety gloves')
  assert.strictEqual(p.fields.quantity, 40)
  assert.strictEqual(p.fields.amount, 320)
})
check('shipment destination', () => {
  const p = nlu.parseNaturalLanguage('Create a shipment to Dallas DC', user)
  assert.strictEqual(p.fields.destination, 'Dallas DC')
})
check('shipment status update', () => {
  const p = nlu.parseNaturalLanguage('Mark the shipment as delivered', user)
  assert.strictEqual(p.action, 'update'); assert.strictEqual(p.fields.status, 'delivered')
})
check('quality issue title + severity', () => {
  const p = nlu.parseNaturalLanguage('Log a critical quality issue: sensor drift on line 2', user)
  assert.strictEqual(p.entity, 'quality_issue')
  assert.strictEqual(p.fields.severity, 'critical')
  assert.match(p.fields.title, /sensor drift/)
})
check('unclear input', () => {
  const p = nlu.parseNaturalLanguage('blargh flargh', user)
  assert.strictEqual(p.intent, 'unclear')
})
check('slot fill: free-text vendor answer', () => {
  assert.strictEqual(nlu.extractSlotValue('Apex Logistics', 'vendor', user), 'Apex Logistics')
  assert.strictEqual(nlu.extractSlotValue('$450', 'amount', user), 450)
  assert.strictEqual(nlu.extractSlotValue('next Friday', 'date', user), nlu.extractDate('next Friday'))
  assert.strictEqual(nlu.extractSlotValue('Raise a PO for gloves', 'vendor', user), null, 'command-like text rejected')
})
check('PO: quantity + item from "20 laptops, $24000"', () => {
  const p = nlu.parseNaturalLanguage('create a purchase order for 20 laptops, $24000', user)
  assert.strictEqual(p.entity, 'purchase_order')
  assert.strictEqual(p.fields.quantity, 20)
  assert.strictEqual(p.fields.item, 'laptops')
  assert.strictEqual(p.fields.amount, 24000)
})
check('PO: bare "order 40 safety gloves"', () => {
  const p = nlu.parseNaturalLanguage('order 40 safety gloves', user)
  assert.strictEqual(p.entity, 'purchase_order')
  assert.strictEqual(p.fields.quantity, 40)
  assert.strictEqual(p.fields.item, 'safety gloves')
})
check('quality inspection: LOT-99 kept intact', () => {
  const p = nlu.parseNaturalLanguage('schedule a quality inspection for LOT-99', user)
  assert.strictEqual(p.entity, 'quality_inspection')
  assert.strictEqual(p.fields.lot, 'LOT-99')
})
check('ISO dates: leave 2026-12-20 to 2026-12-25', () => {
  const p = nlu.parseNaturalLanguage('request annual leave from 2026-12-20 to 2026-12-25', user)
  assert.strictEqual(p.entity, 'leave_request')
  assert.strictEqual(p.fields.start_date, '2026-12-20')
  assert.strictEqual(p.fields.end_date, '2026-12-25')
})
check('ISO single date', () => {
  assert.strictEqual(nlu.extractDate('invoice due 2026-03-05'), '2026-03-05')
})

console.log(`\n${passed} unit checks passed${process.exitCode ? ' (WITH FAILURES)' : ''}`)

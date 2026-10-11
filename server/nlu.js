/**
 * Nexora NLU — smart rule-based natural-language parser.
 *
 * No API key, no network, no LLM: pure JavaScript intent classification +
 * entity extraction tuned for enterprise operations commands. Used as the
 * primary parser when no HF_API_TOKEN is configured (and as the fallback
 * when the LLM call fails).
 *
 * Pipeline: normalize → special intents (undo/help/cancel-pending) →
 * action scoring → entity scoring → slot extraction → defaults →
 * missing-slot analysis.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ').replace(/[.!?;,]+$/g, '').trim()
}

function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d, n) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

/* ------------------------------- extractors ------------------------------ */

function parseNumber(s) {
  if (s == null) return null
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** $1,200.50 · $5k · 200 dollars · USD 300 · "amount of 450" */
function extractAmount(text) {
  const t = String(text)
  let m = t.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*k\b/i)
  if (m) { const n = parseNumber(m[1]); if (n != null) return Math.round(n * 1000) }
  m = t.match(/\$\s*([\d,]+(?:\.\d+)?)/)
  if (m) { const n = parseNumber(m[1]); if (n != null) return n }
  m = t.match(/(\d[\d,]*\.?\d*)\s*(?:dollars?|usd)\b/i)
  if (m) { const n = parseNumber(m[1]); if (n != null) return n }
  m = t.match(/\busd\s*([\d,]+(?:\.\d+)?)/i)
  if (m) { const n = parseNumber(m[1]); if (n != null) return n }
  m = t.match(/\bamount\s*(?:of\s*)?\$?\s*([\d,]+(?:\.\d+)?)/i)
  if (m) { const n = parseNumber(m[1]); if (n != null) return n }
  return null
}

/** qty 40 · quantity 40 · 40 units · 40 pcs */
function extractQuantity(text) {
  const t = String(text)
  let m = t.match(/\bqty\.?\s*[:=]?\s*(\d+)/i) || t.match(/\bquantity\s*(?:of\s*)?(\d+)/i)
  if (m) return parseInt(m[1], 10)
  m = t.match(/(\d+)\s*(?:units?|pcs|pieces)\b/i)
  if (m) return parseInt(m[1], 10)
  return null
}

/**
 * today · tomorrow · day after tomorrow · next/this <weekday> · in N days/weeks
 * on Oct 20 · October 20 · 20 Oct · end of month · 2026-12-20  →  'YYYY-MM-DD'
 */
function extractDate(text, ref = new Date()) {
  const t = normalize(text)
  if (/\btoday\b/.test(t)) return toISODate(ref)
  if (/\bday after tomorrow\b/.test(t)) return toISODate(addDays(ref, 2))
  if (/\btomorrow\b/.test(t)) return toISODate(addDays(ref, 1))

  // ISO dates: 2026-12-20
  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (m) {
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10)
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }

  m = t.match(/\b(next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (m) {
    const target = WEEKDAYS.indexOf(m[2])
    let delta = (target - ref.getDay() + 7) % 7
    if (m[1] === 'next' && delta === 0) delta = 7 // "next Friday" said on a Friday → a week out
    return toISODate(addDays(ref, delta))
  }
  m = t.match(/\bin\s+(\d+)\s*(day|week)s?\b/)
  if (m) return toISODate(addDays(ref, parseInt(m[1], 10) * (m[2] === 'week' ? 7 : 1)))

  const monthNames = Object.keys(MONTHS).join('|')
  m = t.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`))
  if (m) {
    const d = new Date(ref.getFullYear(), MONTHS[m[1]], parseInt(m[2], 10))
    if (d < ref && d.getTime() < ref.getTime() - 86400000) d.setFullYear(d.getFullYear() + 1)
    return toISODate(d)
  }
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\b`))
  if (m) {
    const d = new Date(ref.getFullYear(), MONTHS[m[2]], parseInt(m[1], 10))
    if (d.getTime() < ref.getTime() - 86400000) d.setFullYear(d.getFullYear() + 1)
    return toISODate(d)
  }
  if (/\bend of (the )?month\b/.test(t)) {
    return toISODate(new Date(ref.getFullYear(), ref.getMonth() + 1, 0))
  }
  return null
}

function extractLeaveType(text) {
  const t = normalize(text)
  if (/\bsick\b/.test(t)) return 'sick'
  if (/\bpersonal\b/.test(t)) return 'personal'
  if (/\bmaternity|\bpaternity\b/.test(t)) return 'parental'
  if (/\bunpaid\b/.test(t)) return 'unpaid'
  return 'annual'
}

function extractSeverity(text) {
  const t = normalize(text)
  if (/\bcritical|severe|urgent\b/.test(t)) return 'critical'
  if (/\bhigh|major\b/.test(t)) return 'high'
  if (/\blow|minor\b/.test(t)) return 'low'
  return 'medium'
}

function extractShipmentStatus(text) {
  const t = normalize(text)
  if (/\bdeliver(ed)?\b/.test(t)) return 'delivered'
  if (/\bdelay(ed)?\b/.test(t)) return 'delayed'
  if (/\bcancel(l)?ed\b/.test(t)) return 'cancelled'
  if (/\bin[- ]?transit|shipped|on the way\b/.test(t)) return 'in_transit'
  return null
}

/**
 * People: "my" → the current user; possessives ("Sarah's"); "for Priya".
 * Returns { name, self } or null.
 */
function extractPerson(text, user) {
  const t = String(text)
  if (/\bfor\s+my\b|\bmy\s+(expense|leave|invoice|report|time off|pto|vacation)\b/i.test(t)) {
    return { name: user.full_name, self: true }
  }
  let m = t.match(/\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)?)'s\b/)
  if (m && !/^(what|that|this|it)s$/i.test(m[1])) return { name: m[1], self: false }
  m = t.match(/\b(?:for|by)\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)?)\b/)
  if (m) return { name: m[1], self: false }
  m = t.match(/\b(?:approve|reject|deny|decline)\s+(?:the\s+)?([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)?)\b/)
  if (m) return { name: m[1], self: false }
  return null
}

/** Short record references: "PO-12", "INV-3", "#a1b2c3" (id prefixes). */
function extractReference(text) {
  const t = String(text)
  let m = t.match(/#([A-Za-z0-9]{4,})\b/)
  if (m) return m[1].toLowerCase()
  m = t.match(/\b(?:po|inv|exp|lv|sh|qi)-?(\d+)\b/i)
  if (m) return m[0].toLowerCase()
  return null
}

/**
 * Aggregation queries: "highest invoice", "total expenses", "how many POs",
 * "average amount in finance". No AI needed — pure pattern matching.
 */
function detectAggregation(text) {
  const t = normalize(text)
  if (/\b(highest|maximum|biggest|largest|most expensive)\b/.test(t)) return 'max'
  if (/\b(lowest|minimum|smallest|least|cheapest)\b/.test(t)) return 'min'
  if (/\btotal\b/.test(t) || /\bsum\b/.test(t)) return 'sum'
  if (/\b(average|avg|mean)\b/.test(t)) return 'avg'
  if (/\bhow many\b/.test(t) || /\b(number|count) of\b/.test(t)) return 'count'
  return null
}

/** Department mentioned outright: "in finance", "for HR", "supply chain". */
function detectDepartment(text) {
  const t = normalize(text)
  if (/\bsupply[\s-]?chain\b/.test(t) || /\blogistics\b/.test(t)) return 'supply_chain'
  if (/\bprocurement\b/.test(t)) return 'procurement'
  if (/\bhr\b/.test(t) || /\bhuman resources\b/.test(t)) return 'hr'
  if (/\bquality\b/.test(t)) return 'quality'
  if (/\bfinance\b/.test(t) || /\bfinancial\b/.test(t)) return 'finance'
  return null
}

function extractDestination(text) {
  const t = String(text)
  const m = t.match(/\bto\s+([A-Za-z][A-Za-z0-9 .'-]{1,40})/)
  if (m) {
    const dest = m[1].replace(/\s+(for|with|on|by)\b.*$/i, '').trim()
    if (dest && !/^(the|a)\s+shipment$/i.test(dest)) return dest
  }
  return null
}

function extractItem(text) {
  const t = String(text)
  const m = t.match(/\b(?:for|of|order)\s+([a-z0-9][a-z0-9 ,.'-]{2,50}?)(?:,|\s+qty|\s+quantity|\s+x\d+|\s+\$|\s+\d+\s*(?:dollars?|usd)|\s*$)/i)
  if (m) {
    const item = m[1].trim().replace(/^(the|a|an)\s+/i, '')
    if (item && !/^(purchase|po)\b/i.test(item)) return item
  }
  return null
}

/* --------------------------- intent classification ------------------------- */

const ACTION_PATTERNS = [
  ['undo', [/\bundo\b/, /\bnever\s?mind\b/, /\brevert\b/, /\btake\s+(that|it)\s+back\b/, /\bthat was (a )?mistake\b/]],
  ['help', [/\bhelp\b/, /\bwhat can you do\b/, /\bshow commands\b/, /\blist commands\b/, /^commands$/]],
  ['approve', [/\bapprove[sd]?\b/, /\bsign(?:ed)?\s*off\b/, /\bgreen[- ]?light\b/, /\bauthori[sz]e[sd]?\b/, /\bok\b/]],
  ['reject', [/\breject[sd]?\b/, /\bdeclin\w+\b/, /\bden(y|ied)\b/, /\bturn\s+(it\s+|that\s+|this\s+)?down\b/, /\bveto\b/]],
  ['cancel', [/\bcancel(l)?(ed)?\b/, /\bvoid\b/, /\bdelete\b/, /\bremove\b/, /\bretract\b/, /\bcall\s+off\b/]],
  ['create', [/\bcreat\w+\b/, /\bfile[sd]?\b/, /\bsubmit(ted)?\b/, /\braise[sd]?\b/, /\blog\b/, /\bbook\b/, /\bopen\b/, /\badd\b/, /\brequest\b/, /\bonboard\b/, /\bhire[sd]?\b/, /\bschedul\w+\b/, /\border\b/, /\bnew\b/]],
  ['update', [/\bupdat\w+\b/, /\bmark\b/, /\bset\b/, /\bchang\w+\b/, /\bedit\b/, /\bresolv\w+\b/, /\bfix\b/, /\brestock\b/, /\breplenish\b/]],
  ['query', [/\bshow\b/, /\blist\b/, /\bdisplay\b/, /\bhow many\b/, /\bwhat\b/, /\bwhich\b/, /\bget\b/, /\bfind\b/, /\bsearch\b/, /\bpending\b/, /\boverdue\b/, /\breport\b/]],
]

const ENTITY_KEYWORDS = {
  expense: ['expense', 'expenses', 'petty cash', 'reimburse', 'reimbursement'],
  invoice: ['invoice', 'invoices', 'invoiced', 'bill', 'bills', 'vendor payment'],
  leave_request: ['leave', 'pto', 'vacation', 'time off', 'day off', 'sick day', 'holiday'],
  purchase_order: ['purchase order', 'purchase orders', '\\bpo\\b', 'pos\\b', 'procure', 'supplier order', '\\border\\b'],
  shipment: ['shipment', 'shipments', 'carrier', 'tracking', 'delivery', 'deliveries', 'freight', 'parcel'],
  inventory_item: ['inventory', 'stock', 'sku', 'warehouse', 'inventory item'],
  quality_inspection: ['inspection', 'inspections', 'lot check'],
  quality_issue: ['quality issue', 'defect', 'defects', 'ncr', 'nonconformance'],
  approvals: ['approval', 'approvals'],
}

const ENTITY_DEPT = {
  expense: 'finance', invoice: 'finance',
  leave_request: 'hr',
  purchase_order: 'procurement',
  shipment: 'supply_chain', inventory_item: 'supply_chain',
  quality_inspection: 'quality', quality_issue: 'quality',
  approvals: 'finance',
}

function scorePatterns(t, patterns) {
  let score = 0
  for (const re of patterns) {
    if (re.test(t)) score += 2
  }
  return score
}

function detectAction(t) {
  let best = null
  let bestScore = 0
  for (const [name, patterns] of ACTION_PATTERNS) {
    const s = scorePatterns(t, patterns)
    // 'undo'/'help' win ties — they are unambiguous conversation controls
    const adj = (name === 'undo' || name === 'help') && s > 0 ? s + 0.5 : s
    if (adj > bestScore) { bestScore = adj; best = name }
  }
  // "ship X to Y" as a verb means create shipment
  if (/\bship\b/.test(t) && /\bto\b/.test(t) && best !== 'update') {
    if (!best || best === 'query') best = 'create'
  }
  return best
}

function detectEntity(t) {
  let best = null
  let bestScore = 0
  for (const [entity, keywords] of Object.entries(ENTITY_KEYWORDS)) {
    let s = 0
    for (const kw of keywords) {
      if (new RegExp(kw, 'i').test(t)) s += kw.includes(' ') ? 3 : 2
    }
    if (s > bestScore) { bestScore = s; best = entity }
  }
  return best
}

/* ------------------------------ slot model -------------------------------- */

/**
 * Required slots per action:entity. Everything else gets a smart default.
 * Slot names: person, vendor, amount, quantity, item, date, destination,
 * name, title, status, reference.
 */
const REQUIRED_SLOTS = {
  'create:expense': ['amount'],
  'create:invoice': ['vendor', 'amount'],
  'create:leave_request': ['date'],
  'create:purchase_order': ['item', 'amount'],
  'create:shipment': ['destination'],
  'create:inventory_item': ['name', 'quantity'],
  'create:quality_inspection': [],
  'create:quality_issue': [],
  'update:shipment': [],
  'update:inventory_item': ['quantity'],
  'update:quality_issue': [],
  'approve:*': [],
  'reject:*': [],
  'cancel:*': [],
  'query:*': [],
}

const SLOT_QUESTIONS = {
  amount: 'What amount should I use?',
  vendor: 'Which vendor is this for?',
  person: 'Who is this for?',
  item: 'What should I order?',
  quantity: 'How many?',
  date: 'When? (e.g. "next Friday", "tomorrow", "Oct 20")',
  destination: 'Where should it ship to?',
  name: 'Which item?',
  title: 'How should I title it?',
  status: 'What status should I set?',
}

function requiredSlots(action, entity) {
  return REQUIRED_SLOTS[`${action}:${entity}`] ?? REQUIRED_SLOTS[`${action}:*`] ?? []
}

/** Fill smart defaults so clarification is only asked when truly needed. */
function applyDefaults(parsed, user, rawText) {
  const f = (parsed.fields = parsed.fields || {})
  const key = `${parsed.action}:${parsed.entity}`
  if (parsed.action === 'create' && parsed.entity === 'expense' && !f.person) {
    f.person = user.full_name; f.employee_name = user.full_name
  }
  if (parsed.action === 'create' && parsed.entity === 'leave_request') {
    if (!f.person) f.person = user.full_name
    if (!f.type) f.type = extractLeaveType(rawText)
  }
  if (parsed.action === 'create' && parsed.entity === 'quality_issue' && !f.title) {
    f.title = String(rawText).replace(/^log (a )?quality issue (for )?/i, '').trim().slice(0, 80) || String(rawText).slice(0, 80)
  }
  if (parsed.action === 'create' && parsed.entity === 'quality_issue' && !f.severity) {
    f.severity = extractSeverity(rawText)
  }
  if (parsed.action === 'update' && parsed.entity === 'shipment' && !f.status) {
    f.status = extractShipmentStatus(rawText) || 'in_transit'
  }
  if (parsed.action === 'create' && parsed.entity === 'shipment' && !f.carrier) {
    const m = String(rawText).match(/\b(?:via|with|using)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/)
    if (m) f.carrier = m[1]
  }
  return parsed
}

function getMissingSlots(parsed) {
  const have = parsed.fields || {}
  return requiredSlots(parsed.action, parsed.entity).filter((s) => {
    const v = have[s]
    return v == null || v === ''
  })
}

function slotQuestion(action, entity, slot) {
  const pretty = { purchase_order: 'purchase order', leave_request: 'leave request', quality_issue: 'quality issue', inventory_item: 'inventory item' }
  const en = pretty[entity] || entity.replace(/_/g, ' ')
  const q = SLOT_QUESTIONS[slot] || `What ${slot} should I use?`
  if (slot === 'amount') return `What's the amount for this ${en}?`
  if (slot === 'vendor') return `Which vendor is the ${en} from?`
  if (slot === 'date') return `When should the ${en} ${action === 'create' && entity === 'leave_request' ? 'start' : 'happen'}? (e.g. "next Friday", "tomorrow")`
  return q
}

/**
 * Try to pull a specific slot's value out of a short follow-up answer
 * ("Apex Logistics", "$320", "next Friday", "safety gloves").
 */
function extractSlotValue(text, slot, user) {
  const t = String(text).trim()
  switch (slot) {
    case 'amount': {
      const a = extractAmount(t)
      if (a != null) return a
      // bare number is fine when answering "what's the amount?"
      if (/^[\d,]+(?:\.\d+)?$/.test(t)) return parseNumber(t)
      return null
    }
    case 'quantity': return extractQuantity(t) ?? (isFinite(Number(t)) && t !== '' ? parseInt(t, 10) : null)
    case 'date': return extractDate(t)
    case 'person': {
      const p = extractPerson(t, user)
      return p ? p.name : null
    }
    case 'vendor':
    case 'item':
    case 'name':
    case 'title':
    case 'destination': {
      // free-text answer: strip conversational wrappers, reject command-like input
      if (looksLikeNewCommand(t)) return null
      let v = t.replace(/^(it'?s|its|for|the|a|an|to)\s+/i, '').trim()
      v = v.replace(/[.!?]+$/g, '').trim()
      if (v.length < 2 || v.length > 80) return null
      if (slot === 'destination') return extractDestination(`to ${v}`) || v
      return v
    }
    case 'status': return extractShipmentStatus(t)
    default: return null
  }
}

/** Does this look like a brand-new command rather than a slot answer? */
function looksLikeNewCommand(text) {
  const t = normalize(text)
  if (t.split(/\s+/).length > 8) return true
  const action = detectAction(t)
  if (action && action !== 'query') return true
  if (detectEntity(t)) return true
  return false
}

/* --------------------------------- parse ---------------------------------- */

function buildFields(t, rawText, entity, action, user) {
  const f = {}
  const amount = extractAmount(rawText)
  const quantity = extractQuantity(rawText)
  const date = extractDate(rawText)
  const person = extractPerson(rawText, user)
  const reference = extractReference(rawText)

  if (amount != null) f.amount = amount
  if (quantity != null) f.quantity = quantity
  if (reference) f.reference = reference
  if (person && !person.self) f.person = person.name
  if (person && person.self) { f.person = user.full_name }

  // Aggregation queries ("highest invoice", "total expenses in finance")
  const aggregation = detectAggregation(t)
  if (action === 'query' && aggregation) {
    f.aggregation = aggregation
    f.metric = 'amount'
    f.department_scope = detectDepartment(rawText) || ENTITY_DEPT[entity] || 'finance'
  }

  if (entity === 'invoice') {
    if (person && !person.self) f.vendor = person.name
    else {
      const m = rawText.match(/\bfrom\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)?)/)
      if (m) f.vendor = m[1]
    }
    if (date) f.due_date = date
  }
  if (entity === 'expense') {
    if (person) f.employee_name = person.name
    const cm = t.match(/\b(travel|meals?|office|supplies|software|fuel|training)\b/)
    if (cm) f.category = cm[1]
  }
  if (entity === 'leave_request') {
    if (date) { f.date = date; f.start_date = date; f.end_date = date }
    const isoRange = rawText.match(/\b(\d{4}-\d{1,2}-\d{1,2})\s*(?:-|to)\s*(\d{4}-\d{1,2}-\d{1,2})\b/i)
    if (isoRange) {
      f.start_date = isoRange[1]; f.end_date = isoRange[2]; f.date = isoRange[1]
    }
    const range = rawText.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|to)\s*(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*/i)
    if (range) {
      const mon = MONTHS[range[3].toLowerCase().slice(0, 3)]
      const y = new Date().getFullYear()
      f.start_date = toISODate(new Date(y, mon, parseInt(range[1], 10)))
      f.end_date = toISODate(new Date(y, mon, parseInt(range[2], 10)))
    }
  }
  if (entity === 'purchase_order') {
    const item = extractItem(rawText)
    if (item) f.item = item.replace(/^(for|of|the|a|an)\s+/i, '').replace(/^\d+\s+/, '').trim() || item
    if (quantity == null) {
      // bare number like "order 40 gloves" or "20 laptops, $24000" → likely quantity
      // (number right after $ is money, not a quantity)
      const bare = rawText.match(/(?<!\$)\b(\d+)\s+[a-z]/i)
      if (bare) f.quantity = parseInt(bare[1], 10)
    }
  }
  if (entity === 'shipment') {
    const dest = extractDestination(rawText)
    if (dest) f.destination = dest
    const st = extractShipmentStatus(rawText)
    if (st && action === 'update') f.status = st
  }
  if (entity === 'inventory_item') {
    const nm = rawText.match(/\b(?:stock|inventory|item|sku)\s+(?:of\s+)?([A-Za-z0-9][A-Za-z0-9 .'-]{1,40})/i)
    if (nm) f.name = nm[1].replace(/\s+(to|at|for|with)\b.*$/i, '').trim()
    else if (action === 'update') {
      const w = rawText.match(/\b(?:restock|update|set)\s+([a-z][a-z0-9 .'-]{1,40}?)(?:\s+to|\s+\d|\s*$)/i)
      if (w) f.name = w[1].trim()
    }
    // "restock X to 50" / "set X to 50"
    const toQty = rawText.match(/\bto\s+(\d+)\s*$/i) || rawText.match(/\bto\s+(\d+)\s*(?:units?)?\b/i)
    if (toQty && quantity == null) f.quantity = parseInt(toQty[1], 10)
  }
  if (entity === 'quality_issue') {
    const title = rawText.replace(/^(log|create|file|report)\s+(a\s+)?quality\s+issue:?\s+(for\s+|about\s+)?/i, '').trim()
    if (title && title.length > 3) f.title = title.slice(0, 80)
  }
  if (entity === 'quality_inspection') {
    const lot = rawText.match(/\b(lot[\s-]*[A-Za-z0-9-]+)/i)
    if (lot) f.lot = lot[1].toUpperCase().replace(/\s+/, '-')
    if (date) f.due_date = date
  }
  return f
}

function parseNaturalLanguage(text, user) {
  const rawText = String(text || '').trim()
  const t = normalize(rawText)
  if (!t) {
    return { department: 'finance', action: 'query', entity: 'invoice', entity_id: null, fields: {}, confidence: 0, intent: 'empty' }
  }

  const action = detectAction(t)
  const entity = detectEntity(t)

  // Special conversation controls
  if (action === 'undo') {
    return { department: 'finance', action: 'undo', entity: 'command', entity_id: null, fields: {}, confidence: 0.95, intent: 'undo' }
  }
  if (action === 'help') {
    return { department: 'finance', action: 'help', entity: 'command', entity_id: null, fields: {}, confidence: 0.95, intent: 'help' }
  }

  // Query without a clear entity → approvals overview is the most useful default
  let finalEntity = entity
  let finalAction = action || 'query'
  if (finalAction === 'query' && !finalEntity) {
    if (/\bapproval\b/.test(t)) finalEntity = 'approvals'
    else if (detectAggregation(t)) finalEntity = 'record' // department-scoped aggregation
    else finalEntity = null
  }
  if (!finalEntity) {
    return {
      department: 'finance', action: 'query', entity: 'invoice', entity_id: null,
      fields: {}, confidence: 0.3, intent: 'unclear', raw: rawText,
    }
  }

  const fields = buildFields(t, rawText, finalEntity, finalAction, user)
  const parsed = {
    department: ENTITY_DEPT[finalEntity] || 'finance',
    action: finalAction,
    entity: finalEntity,
    entity_id: null,
    fields,
    requires_approval: finalAction === 'approve' || finalAction === 'reject' || finalAction === 'cancel',
    confidence: 0,
    intent: 'command',
  }
  applyDefaults(parsed, user, rawText)

  // Department-scoped aggregation ("highest amount in finance") governs permissions too.
  if (parsed.fields?.department_scope) parsed.department = parsed.fields.department_scope

  // confidence: action hit + entity hit + filled required slots
  let conf = 0.45
  if (action) conf += 0.18
  if (entity) conf += 0.15
  const missing = getMissingSlots(parsed)
  const required = requiredSlots(parsed.action, parsed.entity)
  if (required.length) conf += 0.12 * ((required.length - missing.length) / required.length)
  if (fields.amount != null || fields.quantity != null || fields.person || fields.date) conf += 0.05
  parsed.confidence = Math.min(0.97, Number(conf.toFixed(2)))
  parsed.missingSlots = missing
  return parsed
}

const HELP_TEXT = `Here's what I can do — just type naturally, no codes or formats needed:

**Finance** — "File my $45 taxi expense" · "Create invoice for Apex, $1,200" · "Approve Sarah's expense"
**HR** — "Book leave for Priya next Friday" · "Approve the leave request" · "Onboard Ali as designer"
**Procurement** — "Raise a PO for safety gloves, qty 40, $320" · "Approve the gloves PO"
**Supply chain** — "Ship to Dallas DC" · "Mark the shipment delivered" · "Restock widgets to 50"
**Quality** — "Log a quality issue: sensor drift" · "Resolve the open issue"
**Ask me** — "Show pending approvals" · "List open shipments" · "How many quality issues are open?"
**Controls** — "Undo that" reverses your last action. If I'm missing a detail, I'll ask — just reply with the answer.`

module.exports = {
  parseNaturalLanguage,
  getMissingSlots,
  slotQuestion,
  applyDefaults,
  extractSlotValue,
  extractAmount,
  extractQuantity,
  extractDate,
  extractPerson,
  looksLikeNewCommand,
  HELP_TEXT,
  normalize,
}

const { randomUUID } = require('node:crypto')
const { run, now } = require('./db')

const HF_API_TOKEN = process.env.HF_API_TOKEN || ''
const HF_MODEL = process.env.HF_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3'
const HF_CHAT_URL = process.env.HF_CHAT_URL || 'https://router.huggingface.co/v1/chat/completions'
const HF_TIMEOUT_MS = Number(process.env.HF_TIMEOUT_MS || 4000)

const SCHEMA = `{
  "department": "finance" | "hr" | "procurement" | "supply_chain" | "quality",
  "action": "create" | "update" | "approve" | "reject" | "query",
  "entity": "invoice" | "expense" | "leave_request" | "purchase_order" | "shipment" | "inventory_item" | "quality_inspection" | "quality_issue",
  "entity_id": null,
  "fields": {},
  "requires_approval": false,
  "confidence": 0.0
}`

const SYSTEM = `You are Nexora, an enterprise operations copilot. Return STRICT JSON only matching this schema:
${SCHEMA}
Extract dollar amounts as numbers in fields.amount. Extract qty into fields.quantity. No markdown.`

function extractJsonBlock(text) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    /* continue */
  }
  const start = trimmed.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < trimmed.length; i += 1) {
    if (trimmed[i] === '{') depth += 1
    if (trimmed[i] === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

async function callHuggingFace(messages) {
  if (!HF_API_TOKEN) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS)
  try {
    const resp = await fetch(HF_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${HF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: HF_MODEL,
        temperature: 0,
        max_tokens: 280,
        messages,
      }),
    })
    if (resp.status === 503 || resp.status === 429) {
      throw Object.assign(new Error(`Hugging Face unavailable (${resp.status})`), { code: 'HF_UNAVAILABLE' })
    }
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`Hugging Face HTTP ${resp.status}: ${body.slice(0, 180)}`)
    }
    const data = await resp.json()
    return data.choices?.[0]?.message?.content || data.generated_text || JSON.stringify(data)
  } finally {
    clearTimeout(timer)
  }
}

function isValidParsed(obj) {
  if (!obj || typeof obj !== 'object') return false
  const depts = ['finance', 'hr', 'procurement', 'supply_chain', 'quality']
  const actions = ['create', 'update', 'approve', 'reject', 'query']
  const entities = [
    'invoice', 'expense', 'leave_request', 'purchase_order',
    'shipment', 'inventory_item', 'quality_inspection', 'quality_issue',
  ]
  if (!depts.includes(obj.department)) return false
  if (!actions.includes(obj.action)) return false
  if (!entities.includes(obj.entity)) return false
  obj.confidence = Number(obj.confidence)
  if (Number.isNaN(obj.confidence)) obj.confidence = 0.75
  if (!obj.fields || typeof obj.fields !== 'object') obj.fields = {}
  if (typeof obj.requires_approval !== 'boolean') obj.requires_approval = Boolean(obj.requires_approval)
  if (obj.entity_id === undefined) obj.entity_id = null
  return true
}

function heuristicParse(command) {
  const text = command.toLowerCase()
  const dollar = command.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/)
  const qtyMatch = command.match(/\b(?:qty|quantity)\s*[:=]?\s*([0-9]+)/i)
  const amountMatch = dollar || command.match(/\b([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\b/)
  const amount = amountMatch ? Number(String(amountMatch[1]).replace(/,/g, '')) : null
  const quantity = qtyMatch ? Number(qtyMatch[1]) : null
  const personMatch =
    command.match(/\b(?:approve|reject|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ||
    command.match(/\b([A-Z][a-z]+(?:'s)?)\s+(?:expense|leave|invoice|report)/)
  const person = personMatch ? personMatch[1].replace(/'s$/, '') : null

  let action = 'query'
  if (/\b(approve|ok|greenlight)\b/.test(text)) action = 'approve'
  else if (/\b(reject|deny|decline)\b/.test(text)) action = 'reject'
  else if (/\b(create|submit|file|open|raise|request|book|add|log|flag|onboard)\b/.test(text)) action = 'create'
  else if (/\b(update|change|edit|set|ship|restock)\b/.test(text)) action = 'update'

  let department = 'finance'
  let entity = 'invoice'
  if (/(leave|pto|vacation|time off|onboard|hire|\bhr\b)/.test(text)) {
    department = 'hr'
    entity = 'leave_request'
  }
  if (/(purchase order|\bpo\b|procure|supplier|buy )/.test(text)) {
    department = 'procurement'
    entity = 'purchase_order'
  } else if (/(shipment|ship |carrier|tracking)/.test(text)) {
    department = 'supply_chain'
    entity = 'shipment'
  } else if (/(inventory|stock|sku|warehouse)/.test(text)) {
    department = 'supply_chain'
    entity = 'inventory_item'
  } else if (/(quality|defect|ncr|inspection)/.test(text)) {
    department = 'quality'
    entity = /issue|defect|ncr/.test(text) ? 'quality_issue' : 'quality_inspection'
  } else if (/(expense|petty cash|reimburse)/.test(text)) {
    department = 'finance'
    entity = 'expense'
  } else if (/(invoice)/.test(text)) {
    department = 'finance'
    entity = 'invoice'
  }

  const fields = {}
  if (person) fields.person = person
  if (amount != null && !Number.isNaN(amount) && dollar) fields.amount = amount
  else if (amount != null && !Number.isNaN(amount) && entity !== 'purchase_order' && entity !== 'inventory_item') fields.amount = amount
  if (dollar && entity === 'purchase_order') fields.amount = Number(String(dollar[1]).replace(/,/g, ''))
  if (quantity != null) fields.quantity = quantity
  if (entity === 'leave_request') {
    if (/sick/.test(text)) fields.type = 'sick'
    else if (/personal/.test(text)) fields.type = 'personal'
    else fields.type = 'annual'
  }
  if (entity === 'purchase_order') {
    const itemMatch = command.match(/(?:for|buy|order)\s+(.+?)(?:,\s*qty|\s+qty|$)/i)
    if (itemMatch) fields.item = itemMatch[1].replace(/[.,]$/, '').trim()
  }
  if (entity === 'invoice' && person) fields.vendor = person
  if (entity === 'expense' && person) fields.employee_name = person
  if (entity === 'shipment') {
    fields.destination = (command.match(/to\s+([A-Za-z0-9 .]+)/) || [])[1]?.trim() || 'Warehouse'
  }
  if (entity === 'inventory_item') {
    fields.name = (command.match(/(?:stock|inventory|sku)\s+(?:of\s+)?([A-Za-z0-9 -]+)/i) || [])[1] || 'Item'
    fields.quantity = quantity || amount || 0
  }
  if (entity === 'quality_issue') fields.title = command.replace(/^log (a )?quality issue (for )?/i, '').slice(0, 80) || command.slice(0, 80)
  if (/onboard|hire/.test(text)) fields.onboard = true

  let confidence = 0.55
  if (action !== 'query') confidence += 0.15
  if (fields.amount) confidence += 0.12
  if (fields.person || fields.item || fields.vendor || fields.name || fields.destination) confidence += 0.12
  if (/(expense|invoice|leave|purchase|po|onboard|ship|stock|quality)/.test(text)) confidence += 0.08
  confidence = Math.min(0.96, Number(confidence.toFixed(2)))

  return {
    department,
    action,
    entity,
    entity_id: null,
    fields,
    requires_approval: action === 'approve' || action === 'reject',
    confidence,
  }
}

async function logLlm({ userId, input, raw, parsedOk, retryCount, finalStatus }) {
  await run(
    `INSERT INTO llm_logs (id, user_id, input_text, raw_model_response, parsed_successfully, retry_count, final_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), userId || null, input, raw || '', parsedOk ? 1 : 0, retryCount, finalStatus, now()]
  )
}

async function parseCommandText(command, user) {
  const heuristic = heuristicParse(command)
  if (!HF_API_TOKEN) {
    await logLlm({
      userId: user.id,
      input: command,
      raw: 'heuristic_no_token',
      parsedOk: true,
      retryCount: 0,
      finalStatus: 'heuristic',
    })
    return { parsed: heuristic, source: 'heuristic', retryCount: 0, needsClarification: heuristic.confidence < 0.7 }
  }

  const firstMessages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `User role: ${user.role}. Command: ${command}` },
  ]
  const retryMessages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Return ONLY a valid JSON object matching the schema. No explanation, no markdown, no extra text.\nCommand: ${command}` },
  ]

  let raw = ''
  let retryCount = 0
  let parsed = null

  try {
    raw = await callHuggingFace(firstMessages)
    parsed = extractJsonBlock(raw)
    if (!isValidParsed(parsed)) {
      retryCount = 1
      const retryRaw = await callHuggingFace(retryMessages)
      raw = `${raw || ''}\n---RETRY---\n${retryRaw || ''}`
      parsed = extractJsonBlock(retryRaw)
    }
  } catch (err) {
    await logLlm({
      userId: user.id,
      input: command,
      raw: String(err.message || err),
      parsedOk: true,
      retryCount,
      finalStatus: 'hf_timeout_fallback',
    })
    return { parsed: heuristic, source: 'heuristic', retryCount, needsClarification: heuristic.confidence < 0.7 }
  }

  const ok = isValidParsed(parsed)
  await logLlm({
    userId: user.id,
    input: command,
    raw,
    parsedOk: ok,
    retryCount,
    finalStatus: ok ? (retryCount ? 'retry_ok' : 'first_try') : 'heuristic_after_parse_fail',
  })

  if (!ok) {
    return { parsed: heuristic, source: 'heuristic', retryCount, needsClarification: heuristic.confidence < 0.7 }
  }
  return {
    parsed,
    source: 'huggingface',
    retryCount,
    needsClarification: parsed.confidence < 0.7,
  }
}

module.exports = { parseCommandText, heuristicParse, extractJsonBlock, HF_MODEL, HF_API_TOKEN: Boolean(HF_API_TOKEN) }

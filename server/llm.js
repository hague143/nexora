const { randomUUID } = require('node:crypto')
const { run, now } = require('./db')
const { parseNaturalLanguage, getMissingSlots: _getMissingSlots } = require('./nlu')

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

/**
 * Heuristic parser — now powered by the smart rule-based NLU engine
 * (server/nlu.js). No API key needed. Kept as the primary path when no
 * HF_API_TOKEN is set, and as the fallback when the LLM call fails.
 */
function heuristicParse(command, user) {
  const safeUser = user || { full_name: 'there', id: null }
  const parsed = parseNaturalLanguage(command, safeUser)
  const unclear = parsed.intent === 'unclear' || parsed.intent === 'empty'
  return { ...parsed, _needsClarification: unclear }
}

async function logLlm({ userId, input, raw, parsedOk, retryCount, finalStatus }) {
  await run(
    `INSERT INTO llm_logs (id, user_id, input_text, raw_model_response, parsed_successfully, retry_count, final_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), userId || null, input, raw || '', parsedOk ? 1 : 0, retryCount, finalStatus, now()]
  )
}

async function parseCommandText(command, user) {
  const heuristic = heuristicParse(command, user)
  if (!HF_API_TOKEN) {
    await logLlm({
      userId: user.id,
      input: command,
      raw: 'heuristic_no_token',
      parsedOk: true,
      retryCount: 0,
      finalStatus: 'heuristic',
    })
    return { parsed: heuristic, source: 'heuristic', retryCount: 0, needsClarification: Boolean(heuristic._needsClarification) }
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
    return { parsed: heuristic, source: 'heuristic', retryCount, needsClarification: Boolean(heuristic._needsClarification) }
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
    return { parsed: heuristic, source: 'heuristic', retryCount, needsClarification: Boolean(heuristic._needsClarification) }
  }
  return {
    parsed,
    source: 'huggingface',
    retryCount,
    needsClarification: false,
  }
}

module.exports = { parseCommandText, heuristicParse, extractJsonBlock, HF_MODEL, HF_API_TOKEN: Boolean(HF_API_TOKEN) }

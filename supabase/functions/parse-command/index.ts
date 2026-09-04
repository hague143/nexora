// Supabase Edge Function: parse-command
// Deploy with: supabase functions deploy parse-command
// Secrets: USER_LLM_API_KEY, USER_LLM_BASE_URL, USER_LLM_MODEL, N8N_WEBHOOK_URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return json({ error: 'Unauthorized' }, 401)

    const { data: profile } = await supabase.from('users').select('*').eq('id', auth.user.id).single()
    if (!profile) return json({ error: 'Profile missing' }, 403)

    const { command } = await req.json()
    if (!command) return json({ error: 'Command is required.' }, 400)

    const parsed = await parseCommand(String(command), profile)
    if (!parsed || parsed.confidence < 0.55) {
      return json({
        status: 'needs_info',
        summary: 'I need a clearer action, person, or amount before I can continue.',
        parsed,
      })
    }

    const gated = parsed.requires_approval || ['approve', 'reject'].includes(parsed.action)
    const canApprove = profile.role === 'admin' || profile.role === 'manager'
    if (gated && !canApprove) {
      await insertAction(supabase, profile.id, parsed, 'insufficient_permission', command)
      return json({
        status: 'insufficient_permission',
        summary: `Your ${profile.role} role cannot ${parsed.action} this ${parsed.entity}.`,
        parsed,
      })
    }

    const status = parsed.requires_approval && profile.role !== 'admin' ? 'pending_approval' : 'success'
    const { data: row } = await insertAction(supabase, profile.id, parsed, status, command)
    const summary = humanSummary(parsed)

    const webhook = Deno.env.get('N8N_WEBHOOK_URL')
    if (webhook) {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...parsed, user_id: profile.id, workflow_action_id: row?.id, summary }),
      }).catch(() => {})
    }

    return json({ status, summary, parsed, action: row })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

async function parseCommand(command: string, profile: { role: string }) {
  const key = Deno.env.get('USER_LLM_API_KEY')
  const base = (Deno.env.get('USER_LLM_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = Deno.env.get('USER_LLM_MODEL') || 'gpt-4o-mini'
  if (!key) return heuristic(command)

  const system = `Return STRICT JSON only:
{"department":"finance"|"hr"|"procurement"|"supply_chain"|"quality","action":"create"|"update"|"approve"|"reject"|"query","entity":"invoice"|"expense"|"leave_request"|"purchase_order"|"petty_cash"|"onboarding"|"quality_check","entity_id":null,"fields":{},"requires_approval":false,"confidence":0.0}
User role: ${profile.role}.`

  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: command },
      ],
    }),
  })
  if (!resp.ok) return heuristic(command)
  const data = await resp.json()
  const text = (data.choices?.[0]?.message?.content || '').replace(/^```json\s*|\s*```$/g, '').trim()
  return JSON.parse(text)
}

function heuristic(command: string) {
  const text = command.toLowerCase()
  const amountMatch = command.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/)
  const amount = amountMatch ? Number(String(amountMatch[1]).replace(/,/g, '')) : null
  let action = 'query'
  if (/\b(approve|ok|greenlight)\b/.test(text)) action = 'approve'
  else if (/\b(reject|deny|decline)\b/.test(text)) action = 'reject'
  else if (/\b(create|submit|file|open|raise|request)\b/.test(text)) action = 'create'
  let department = 'finance'
  let entity = 'expense'
  if (/(leave|pto|vacation)/.test(text)) { department = 'hr'; entity = 'leave_request' }
  else if (/(purchase|po\b|procure)/.test(text)) { department = 'procurement'; entity = 'purchase_order' }
  else if (/(invoice)/.test(text)) { entity = 'invoice' }
  const fields: Record<string, unknown> = {}
  if (amount != null) fields.amount = amount
  const person = command.match(/\b([A-Z][a-z]+(?:'s)?)\b/)
  if (person) fields.person = person[1].replace(/'s$/, '')
  return {
    department,
    action,
    entity,
    entity_id: null,
    fields,
    requires_approval: action === 'approve' || action === 'reject',
    confidence: amount || person ? 0.82 : 0.48,
  }
}

async function insertAction(supabase: ReturnType<typeof createClient>, userId: string, parsed: Record<string, unknown>, status: string, command: string) {
  return supabase.from('workflow_actions').insert({
    user_id: userId,
    department: parsed.department,
    action: parsed.action,
    entity: parsed.entity,
    entity_id: parsed.entity_id,
    fields: { ...(parsed.fields as object), command },
    status,
  }).select().single()
}

function humanSummary(parsed: Record<string, unknown>) {
  const fields = (parsed.fields || {}) as Record<string, unknown>
  const name = fields.person || fields.vendor || 'the record'
  const amount = fields.amount != null ? `$${fields.amount}` : ''
  return `${String(parsed.action)} ${name} ${amount} ${String(parsed.entity)}`.replace(/\s+/g, ' ').trim()
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

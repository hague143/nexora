const { parseCommandText } = require('./llm')
const { canExecute, approvalRequired, canApprove } = require('./permissions')
const { dispatch, writeAction } = require('./handlers')
const { notify, notifyCompanyManagers } = require('./notifications/dispatcher')
const { rowJson } = require('./db')

const buckets = new Map()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20

function rateLimit(userId) {
  const nowTs = Date.now()
  const entry = buckets.get(userId) || { count: 0, start: nowTs }
  if (nowTs - entry.start > WINDOW_MS) {
    entry.count = 0
    entry.start = nowTs
  }
  entry.count += 1
  buckets.set(userId, entry)
  return entry.count <= MAX_PER_WINDOW
}

function clarificationQuestion(parsed, text) {
  if (!parsed) return 'Please rephrase with an action (create/approve), a person or vendor, and an amount if it applies.'
  if (!parsed.fields?.amount && ['invoice', 'expense', 'purchase_order'].includes(parsed.entity)) {
    return 'What amount should I use for this finance action?'
  }
  if (!parsed.fields?.person && parsed.entity === 'leave_request') {
    return 'Whose leave request should I file or approve?'
  }
  return `I parsed this as ${parsed.action} ${parsed.entity} in ${parsed.department} (confidence ${parsed.confidence}). Can you add the missing person, amount, or item? Original: "${text}"`
}

/**
 * Pipeline: parse → validate → route → execute → log → notify
 */
async function processCommand(user, text) {
  if (!rateLimit(user.id)) {
    return {
      status: 'failed',
      summary: 'Rate limit reached. Try again in a minute.',
      parsed: null,
    }
  }

  const { parsed, retryCount, needsClarification, followUp } = await parseCommandText(text, user)

  if (!parsed || needsClarification) {
    const action = await writeAction(
      user,
      parsed || { department: 'finance', action: 'query', entity: 'invoice', entity_id: null, fields: {} },
      'needs_clarification',
      { command: text, summary: followUp || clarificationQuestion(parsed, text) }
    )
    return {
      status: 'needs_clarification',
      summary: followUp || clarificationQuestion(parsed, text),
      parsed,
      retryCount,
      action: rowJson(action),
    }
  }

  const perm = canExecute(user, parsed)
  if (!perm.ok) {
    const action = await writeAction(user, parsed, 'failed', {
      command: text,
      summary: perm.reason,
      error_message: perm.reason,
    })
    return {
      status: 'insufficient_permission',
      summary: perm.reason,
      parsed,
      action: rowJson(action),
    }
  }

  const needsApproval = approvalRequired(parsed, user) && parsed.action !== 'query'
  if (needsApproval && !canApprove(user)) {
    const pendingParsed = { ...parsed, requires_approval: true }
    let data = null
    try {
      if (parsed.action === 'create') {
        const result = await dispatch(user, parsed)
        data = result.data
        pendingParsed.entity_id = data?.id || parsed.entity_id
      }
    } catch {
      /* still queue the intent */
    }
    const action = await writeAction(user, pendingParsed, 'pending_approval', {
      command: text,
      summary: `Queued for manager approval: ${parsed.action} ${parsed.entity}`,
      entity_id: pendingParsed.entity_id,
    })
    await notifyCompanyManagers(user.company_id, null, {
      type: 'approval_needed',
      title: 'Approval needed',
      message: `${user.full_name} requested ${parsed.action} ${parsed.entity}`,
      relatedActionId: action.id,
    })
    return {
      status: 'pending_approval',
      summary: `This ${parsed.entity.replace(/_/g, ' ')} needs a manager to approve before it is final.`,
      parsed: pendingParsed,
      action: rowJson(action),
      data,
    }
  }

  try {
    const result = await dispatch(user, parsed)
    if (result.data?.id) parsed.entity_id = result.data.id
    const action = await writeAction(user, parsed, 'completed', {
      command: text,
      summary: result.message,
      entity_id: parsed.entity_id,
    })
    await notify(user.id, {
      companyId: user.company_id,
      type: 'status_update',
      title: 'Command completed',
      message: result.message,
      relatedActionId: action.id,
    })
    return {
      status: 'success',
      summary: result.message,
      parsed,
      action: rowJson(action),
      data: result.data,
    }
  } catch (err) {
    const action = await writeAction(user, parsed, 'failed', {
      command: text,
      summary: err.message || 'Handler failed',
      error_message: err.message || String(err),
    })
    return {
      status: 'failed',
      summary: err.message || 'Handler failed',
      parsed,
      action: rowJson(action),
    }
  }
}

module.exports = { processCommand, rateLimit }

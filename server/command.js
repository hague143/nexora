const { parseCommandText } = require('./llm')
const {
  getMissingSlots, slotQuestion, applyDefaults,
  extractSlotValue, looksLikeNewCommand, HELP_TEXT,
} = require('./nlu')
const { canExecute, approvalRequired, canApprove } = require('./permissions')
const { dispatch, writeAction, undoLastAction } = require('./handlers')
const { notify, notifyCompanyManagers } = require('./notifications/dispatcher')
const { rowJson, run, get, now } = require('./db')

const buckets = new Map()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20
const PENDING_TTL_MS = 15 * 60_000

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

/* ------------------- multi-turn slot filling (serverless-safe) ------------- */

let pendingTableReady = false
async function ensurePendingTable() {
  if (pendingTableReady) return
  await run(
    `CREATE TABLE IF NOT EXISTS pending_commands (
      user_id TEXT PRIMARY KEY,
      company_id TEXT,
      parsed TEXT NOT NULL,
      missing TEXT NOT NULL,
      question TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`
  )
  pendingTableReady = true
}

async function getPending(userId) {
  await ensurePendingTable()
  const row = await get(`SELECT * FROM pending_commands WHERE user_id = ?`, [userId])
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await run(`DELETE FROM pending_commands WHERE user_id = ?`, [userId])
    return null
  }
  return row
}

async function savePending(user, parsed, missing) {
  await ensurePendingTable()
  const question = slotQuestion(parsed.action, parsed.entity, missing[0])
  const expires = new Date(Date.now() + PENDING_TTL_MS).toISOString()
  await run(
    `INSERT INTO pending_commands (user_id, company_id, parsed, missing, question, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       parsed = excluded.parsed, missing = excluded.missing, question = excluded.question,
       created_at = excluded.created_at, expires_at = excluded.expires_at`,
    [user.id, user.company_id, JSON.stringify(parsed), JSON.stringify(missing), question, now(), expires]
  )
  return question
}

async function clearPending(userId) {
  await ensurePendingTable()
  await run(`DELETE FROM pending_commands WHERE user_id = ?`, [userId])
}

/** Map a filled slot onto the right field keys for the entity. */
function applySlot(parsed, slot, value) {
  const f = (parsed.fields = parsed.fields || {})
  if (slot === 'date' && parsed.entity === 'leave_request') {
    f.date = value; f.start_date = value; f.end_date = value
  } else if (slot === 'person') {
    f.person = value
    if (parsed.entity === 'expense') f.employee_name = value
  } else {
    f[slot] = value
  }
}

function isCancelText(text) {
  return /\b(cancel|stop|forget it|never mind)\b/i.test(String(text || ''))
}

/**
 * Try to fill the pending command's missing slots from the user's reply.
 * Returns { complete, parsed } | { progress, parsed, missing } | { none }.
 */
function tryFillPending(pending, text, user) {
  const parsed = JSON.parse(pending.parsed)
  let missing = JSON.parse(pending.missing)
  let progressed = false
  for (const slot of [...missing]) {
    const v = extractSlotValue(text, slot, user)
    if (v != null && v !== '') {
      applySlot(parsed, slot, v)
      progressed = true
    }
  }
  missing = getMissingSlots(parsed)
  if (!missing.length) return { complete: true, parsed }
  if (progressed) return { progress: true, parsed, missing }
  return { none: true }
}

async function logAction(user, parsed, status, text, summary, error) {
  return writeAction(user, parsed, status, {
    command: text,
    summary,
    ...(error ? { error_message: error } : {}),
  })
}

/* --------------------------------- pipeline -------------------------------- */

async function processCommand(user, text) {
  if (!rateLimit(user.id)) {
    return { status: 'failed', summary: 'Rate limit reached. Try again in a minute.', parsed: null }
  }
  const rawText = String(text || '').trim()

  // --- 1. pending multi-turn slot fill -------------------------------------
  let pending = await getPending(user.id)
  let parsed = null
  let source = 'heuristic'
  let retryCount = 0

  if (pending) {
    if (isCancelText(rawText) && !looksLikeNewCommand(rawText)) {
      await clearPending(user.id)
      const p = JSON.parse(pending.parsed)
      await logAction(user, p, 'cancelled', rawText, 'Clarification cancelled by user.')
      return { status: 'cancelled', summary: 'Cancelled — no problem. What would you like to do?', parsed: p }
    }
    const fill = tryFillPending(pending, rawText, user)
    if (fill.complete) {
      await clearPending(user.id)
      parsed = fill.parsed
    } else if (fill.progress) {
      const question = await savePending(user, fill.parsed, fill.missing)
      await logAction(user, fill.parsed, 'needs_clarification', rawText, question)
      return { status: 'needs_clarification', summary: question, parsed: fill.parsed, action: null }
    } else {
      // Reply didn't fill anything — maybe they changed topic?
      const fresh = await parseCommandText(rawText, user)
      if (fresh.parsed && fresh.parsed.intent === 'command' && (fresh.parsed.confidence || 0) >= 0.8) {
        await clearPending(user.id)
        parsed = fresh.parsed; source = fresh.source; retryCount = fresh.retryCount
      } else {
        return {
          status: 'needs_clarification',
          summary: pending.question || 'Could you answer the question above?',
          parsed: JSON.parse(pending.parsed),
        }
      }
    }
  }

  // --- 2. fresh parse --------------------------------------------------------
  if (!parsed) {
    const r = await parseCommandText(rawText, user)
    parsed = r.parsed; source = r.source; retryCount = r.retryCount
    if (!parsed || parsed.intent === 'unclear' || parsed.intent === 'empty') {
      const summary = 'I didn\'t catch that. Try something like "Show pending approvals" or "File my $45 taxi expense" — or type "help".'
      const action = await logAction(
        user,
        parsed || { department: 'finance', action: 'query', entity: 'invoice', entity_id: null, fields: {} },
        'needs_clarification', rawText, summary
      )
      return { status: 'needs_clarification', summary, parsed, retryCount, action: rowJson(action) }
    }
  }

  // --- 3. conversation controls ----------------------------------------------
  if (parsed.intent === 'help' || parsed.action === 'help') {
    return { status: 'success', summary: HELP_TEXT, parsed, retryCount }
  }
  if (parsed.intent === 'undo' || parsed.action === 'undo') {
    try {
      const target = await get(
        `SELECT * FROM workflow_actions WHERE user_id = ? AND company_id = ? AND status = 'completed'
         AND action NOT IN ('query', 'undo', 'help') ORDER BY created_at DESC LIMIT 1`,
        [user.id, user.company_id]
      )
      if (!target) {
        return { status: 'failed', summary: 'Nothing to undo — you have no completed actions yet.', parsed }
      }
      const result = await undoLastAction({ ...user, id: target.user_id })
      const action = await logAction(
        user,
        { department: target.department, action: 'undo', entity: target.entity, entity_id: target.entity_id, fields: {} },
        'completed', rawText, result.message
      )
      await notify(user.id, {
        companyId: user.company_id, type: 'status_update', title: 'Action undone',
        message: result.message, relatedActionId: action.id,
      })
      return { status: 'success', summary: result.message, parsed, action: rowJson(action), data: result.data }
    } catch (err) {
      return { status: 'failed', summary: err.message || 'Could not undo that.', parsed }
    }
  }

  // --- 4. slot completion ------------------------------------------------------
  parsed = applyDefaults(parsed, user, rawText)
  const missing = getMissingSlots(parsed)
  if (missing.length) {
    const question = await savePending(user, parsed, missing)
    const action = await logAction(user, parsed, 'needs_clarification', rawText, question)
    return { status: 'needs_clarification', summary: question, parsed, retryCount, action: rowJson(action) }
  }

  // --- 5. permissions ----------------------------------------------------------
  const perm = canExecute(user, parsed)
  if (!perm.ok) {
    const action = await logAction(user, parsed, 'failed', rawText, perm.reason, perm.reason)
    return { status: 'insufficient_permission', summary: perm.reason, parsed, action: rowJson(action) }
  }

  // --- 6. approval gate ----------------------------------------------------------
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
      command: rawText,
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

  // --- 7. execute ----------------------------------------------------------------
  try {
    const result = await dispatch(user, parsed)
    if (result.data?.id) parsed.entity_id = result.data.id
    const action = await writeAction(user, parsed, 'completed', {
      command: rawText,
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
    return { status: 'success', summary: result.message, parsed, action: rowJson(action), data: result.data }
  } catch (err) {
    const action = await writeAction(user, parsed, 'failed', {
      command: rawText,
      summary: err.message || 'Handler failed',
      error_message: err.message || String(err),
    })
    return { status: 'failed', summary: err.message || 'Handler failed', parsed, action: rowJson(action) }
  }
}

module.exports = { processCommand, rateLimit, getMissingSlots, slotQuestion }

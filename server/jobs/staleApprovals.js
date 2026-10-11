const { all } = require('../db')
const { notifyCompanyManagers } = require('../notifications/dispatcher')

async function runStaleApprovals() {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const rows = await all(
    `SELECT * FROM workflow_actions WHERE status IN ('pending_approval','needs_approval') AND created_at <= ?`,
    [cutoff]
  )
  for (const a of rows) {
    await notifyCompanyManagers(a.company_id, null, {
      type: 'reminder',
      title: 'Approval older than 48 hours',
      message: `${a.action} ${a.entity} is still waiting.`,
      relatedActionId: a.id,
    })
  }
  return rows.length
}

module.exports = { runStaleApprovals }

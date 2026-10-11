const { all } = require('../db')
const { notifyCompanyManagers } = require('../notifications/dispatcher')

async function runOverdueInspections() {
  const today = new Date().toISOString().slice(0, 10)
  const rows = await all(
    `SELECT * FROM quality_inspections WHERE status = 'pending' AND due_date IS NOT NULL AND due_date < ?`,
    [today]
  )
  for (const q of rows) {
    await notifyCompanyManagers(q.company_id, null, {
      type: 'reminder',
      title: 'Overdue quality inspection',
      message: `Lot ${q.lot} inspection is past due (${q.due_date}).`,
    })
  }
  return rows.length
}

module.exports = { runOverdueInspections }

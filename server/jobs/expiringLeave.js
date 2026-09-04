const { all } = require('../db')
const { notifyCompanyManagers } = require('../notifications/dispatcher')

function runExpiringLeave() {
  const soon = new Date()
  soon.setDate(soon.getDate() + 3)
  const rows = all(
    `SELECT * FROM leave_requests WHERE status = 'pending' AND start_date <= ?`,
    [soon.toISOString().slice(0, 10)]
  )
  rows.forEach((r) => {
    notifyCompanyManagers(r.company_id, null, {
      type: 'reminder',
      title: 'Leave starting soon',
      message: `${r.employee_name}'s ${r.type} leave starts ${r.start_date} and is still pending.`,
    })
  })
  return rows.length
}

module.exports = { runExpiringLeave }

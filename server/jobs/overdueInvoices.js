const { all } = require('../db')
const { notifyCompanyManagers } = require('../notifications/dispatcher')

function runOverdueInvoices() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 14)
  const rows = all(
    `SELECT * FROM invoices WHERE status = 'pending' AND created_at <= ?`,
    [cutoff.toISOString()]
  )
  rows.forEach((inv) => {
    notifyCompanyManagers(inv.company_id, null, {
      type: 'reminder',
      title: 'Overdue invoice',
      message: `${inv.vendor} invoice of $${inv.amount} has been pending more than 14 days.`,
    })
  })
  return rows.length
}

module.exports = { runOverdueInvoices }

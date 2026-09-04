const cron = require('node-cron')
const { runOverdueInvoices } = require('./overdueInvoices')
const { runStaleApprovals } = require('./staleApprovals')
const { runExpiringLeave } = require('./expiringLeave')
const { runLowInventory } = require('./lowInventory')
const { runOverdueInspections } = require('./overdueInspections')

function runAllJobs() {
  return {
    overdueInvoices: runOverdueInvoices(),
    staleApprovals: runStaleApprovals(),
    expiringLeave: runExpiringLeave(),
    lowInventory: runLowInventory(),
    overdueInspections: runOverdueInspections(),
  }
}

function startJobs() {
  cron.schedule('0 8 * * *', () => {
    console.log('[jobs] daily sweep', runAllJobs())
  })
}

module.exports = { startJobs, runAllJobs }

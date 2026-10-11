const { runOverdueInvoices } = require('./overdueInvoices')
const { runStaleApprovals } = require('./staleApprovals')
const { runExpiringLeave } = require('./expiringLeave')
const { runLowInventory } = require('./lowInventory')
const { runOverdueInspections } = require('./overdueInspections')

async function runAllJobs() {
  return {
    overdueInvoices: await runOverdueInvoices(),
    staleApprovals: await runStaleApprovals(),
    expiringLeave: await runExpiringLeave(),
    lowInventory: await runLowInventory(),
    overdueInspections: await runOverdueInspections(),
  }
}

// Local-dev only: on Vercel the sweep runs via vercel.json crons -> /api/jobs/run
function startJobs() {
  if (process.env.VERCEL) return
  const cron = require('node-cron')
  cron.schedule('0 8 * * *', async () => {
    console.log('[jobs] daily sweep', await runAllJobs())
  })
}

module.exports = { startJobs, runAllJobs }

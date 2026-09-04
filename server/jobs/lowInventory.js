const { all } = require('../db')
const { notifyCompanyManagers } = require('../notifications/dispatcher')

function runLowInventory() {
  const rows = all(`SELECT * FROM inventory_items WHERE quantity <= reorder_level OR status = 'low'`)
  rows.forEach((item) => {
    notifyCompanyManagers(item.company_id, null, {
      type: 'reminder',
      title: 'Low inventory',
      message: `${item.name} (${item.sku}) is at ${item.quantity}, reorder at ${item.reorder_level}.`,
    })
  })
  return rows.length
}

module.exports = { runLowInventory }

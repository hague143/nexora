// Vercel serverless catch-all for /api/* — delegates to the Express app.
// The Vite client is served by Vercel's static hosting (client/dist);
// every /api/* request lands here.
const app = require('../server/app')
const { ensureSeeded } = require('../server/seed')
const { ensureOrgTables } = require('../server/org')

let seeded = false

module.exports = async (req, res) => {
  if (!seeded) {
    await ensureSeeded()
    await ensureOrgTables()
    seeded = true
  }
  return app(req, res)
}

// Local-dev / single-service entry point.
// On Vercel the app is served via api/[...path].js instead (no listen here).
require('./env')
const app = require('./app')
const { ensureSeeded } = require('./seed')
const { startJobs } = require('./jobs')

const PORT = process.env.PORT || 3001

async function main() {
  await ensureSeeded()
  startJobs()
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Nexora API listening on ${PORT}`)
  })
}

main().catch((err) => {
  console.error('[nexora] failed to start', err)
  process.exit(1)
})

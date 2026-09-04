/**
 * Replaces n8n HTTP Request nodes.
 * Mock implementation logs the payload. A production call would:
 *   - pick base URL + auth per department (QuickBooks, BambooHR, carrier APIs)
 *   - attach Authorization headers from env (QBO_ACCESS_TOKEN, BAMBOOHR_API_KEY, ...)
 *   - retry 429/5xx with exponential backoff (see retryWithBackoff)
 */
async function sendToExternalSystem(department, payload) {
  const target = {
    finance: process.env.QUICKBOOKS_API_URL || 'https://quickbooks.example.invalid/v3',
    hr: process.env.BAMBOOHR_API_URL || 'https://api.bamboohr.example.invalid/v1',
    procurement: process.env.PROCUREMENT_API_URL || 'https://procurement.example.invalid/api',
    supply_chain: process.env.CARRIER_API_URL || 'https://api.carrier.example.invalid/v1',
    quality: process.env.QMS_API_URL || 'https://qms.example.invalid/v1',
  }[department] || 'https://hooks.example.invalid'

  console.log(`[integration-mock] ${department} -> ${target}`, JSON.stringify(payload))

  if (process.env.NEXORA_LIVE_INTEGRATIONS === '1') {
    return retryWithBackoff(() =>
      fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.EXTERNAL_API_TOKEN || ''}`,
        },
        body: JSON.stringify(payload),
      })
    )
  }
  return { mocked: true, department, accepted: true }
}

async function retryWithBackoff(fn, attempts = 3) {
  let last
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fn()
      if (res.ok || (res.status !== 429 && res.status < 500)) return res
      last = new Error(`HTTP ${res.status}`)
    } catch (err) {
      last = err
    }
    await new Promise((r) => setTimeout(r, 300 * 2 ** i))
  }
  throw last
}

module.exports = { sendToExternalSystem }

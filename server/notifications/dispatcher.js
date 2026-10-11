const { randomUUID } = require('node:crypto')
const { run, now } = require('../db')

/**
 * Pluggable notify(). Default: persist to `notifications` and send a stub email.
 * Swap sendEmail() for Resend/SendGrid/SMTP. Credentials belong in env:
 *   RESEND_API_KEY / SMTP_HOST / SMTP_USER / SMTP_PASS
 */
function sendEmail(toUserId, notification) {
  // Real credential injection point — do not hardcode keys.
  // if (process.env.RESEND_API_KEY) { await fetch('https://api.resend.com/emails', ...) }
  // if (process.env.SMTP_HOST) { transporter.sendMail({ to, subject: notification.title, text: notification.message }) }
  console.log(`[email-stub] user=${toUserId} title=${notification.title}`)
}

async function notify(userId, notification) {
  const id = randomUUID()
  const created = now()
  await run(
    `INSERT INTO notifications (id, user_id, company_id, type, title, message, related_action_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      userId,
      notification.companyId,
      notification.type,
      notification.title,
      notification.message,
      notification.relatedActionId || null,
      created,
    ]
  )
  sendEmail(userId, notification)
  return { id, ...notification, is_read: 0, created_at: created }
}

async function notifyCompanyManagers(companyId, extra, notification) {
  const { all } = require('../db')
  const managers = await all(
    `SELECT id FROM users WHERE company_id = ? AND role IN ('admin','manager')`,
    [companyId]
  )
  const ids = extra ? Array.from(new Set([...managers.map((m) => m.id), extra])) : managers.map((m) => m.id)
  for (const uid of ids) {
    await notify(uid, { ...notification, companyId })
  }
}

module.exports = { notify, notifyCompanyManagers, sendEmail }

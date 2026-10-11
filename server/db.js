// Postgres (Supabase) data layer — async.
// Same helper names as the old node:sqlite layer. Write SQL with `?`
// placeholders exactly as before; they are rewritten to $1, $2, ...
const { Pool } = require('pg')

function getPool() {
  if (!globalThis.__nexoraPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set')
    }
    globalThis.__nexoraPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Supabase pooler requires SSL
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
    globalThis.__nexoraPool.on('error', (err) => {
      console.error('[db] pool error', err.message)
    })
  }
  return globalThis.__nexoraPool
}

// Rewrite ? placeholders to $n, skipping ? inside single-quoted literals.
function toPg(sql) {
  let out = ''
  let n = 0
  let inStr = false
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    if (ch === "'") {
      if (inStr && sql[i + 1] === "'") {
        out += "''"
        i += 1
        continue
      }
      inStr = !inStr
      out += ch
      continue
    }
    if (ch === '?' && !inStr) {
      n += 1
      out += `$${n}`
      continue
    }
    out += ch
  }
  return out
}

async function query(sql, params = []) {
  const res = await getPool().query(toPg(sql), params)
  return res
}

async function all(sql, params = []) {
  return (await query(sql, params)).rows
}

async function get(sql, params = []) {
  const rows = await all(sql, params)
  return rows[0] || null
}

async function run(sql, params = []) {
  await query(sql, params)
}

async function many(sql, params = []) {
  return (await all(sql, params)).map((r) => rowJson(r))
}

function now() {
  return new Date().toISOString()
}

function rowJson(row, key = 'fields') {
  if (!row) return row
  const copy = { ...row }
  if (typeof copy[key] === 'string') {
    try {
      copy[key] = JSON.parse(copy[key])
    } catch {
      copy[key] = {}
    }
  }
  if (copy.is_read !== undefined) {
    copy.read = Boolean(copy.is_read)
    copy.body = copy.message
  }
  if (copy.parsed_successfully !== undefined) copy.parsed_successfully = Boolean(copy.parsed_successfully)
  return copy
}

module.exports = { getPool, query, now, rowJson, all, get, run, many, toPg }

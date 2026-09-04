const { DatabaseSync } = require('node:sqlite')
const path = require('node:path')
const fs = require('node:fs')

const dataDir = path.join(__dirname, 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(path.join(dataDir, 'nexora.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  company_id TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'finance',
  role TEXT NOT NULL DEFAULT 'employee',
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS workflow_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  department TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  summary TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_action_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  input_text TEXT NOT NULL,
  raw_model_response TEXT,
  parsed_successfully INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  final_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  vendor TEXT NOT NULL,
  amount REAL NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT,
  employee_name TEXT NOT NULL,
  type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  department TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  start_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  carrier TEXT,
  tracking TEXT,
  origin TEXT,
  destination TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_inspections (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  lot TEXT,
  inspector TEXT,
  due_date TEXT,
  result TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_issues (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
`)

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

function all(sql, params = []) {
  return db.prepare(sql).all(...params)
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params)
}

function run(sql, params = []) {
  return db.prepare(sql).run(...params)
}

function many(sql, params = []) {
  return all(sql, params).map((r) => rowJson(r))
}

module.exports = { db, now, rowJson, all, get, run, many }

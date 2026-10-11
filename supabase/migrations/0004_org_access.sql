-- Nexora migration 0004: organization access control.
-- Invites let a company admin authorize employees by email (Gmail).
-- Only invited (or approved) emails can create an account in a company;
-- everyone else is blocked at signup. Join requests let outsiders ask
-- an admin for access.
-- NOTE: the API also ensures these idempotently at runtime
-- (server/org.js ensureOrgTables), so this file is belt-and-braces
-- for fresh database setups.

CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'employee',
  department  TEXT NOT NULL DEFAULT 'finance',
  invited_by  TEXT,
  token       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites (email);
CREATE INDEX IF NOT EXISTS idx_invites_company ON invites (company_id);

CREATE TABLE IF NOT EXISTS join_requests (
  id           TEXT PRIMARY KEY,
  company_id   TEXT,
  company_name TEXT NOT NULL,
  email        TEXT NOT NULL,
  full_name    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_join_requests_company ON join_requests (company_id);

-- Soft-delete for team members (keeps the audit trail intact).
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

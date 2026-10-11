-- Nexora migration 0003: multi-turn command slot filling.
-- Holds a user's in-progress command while the assistant asks follow-up
-- questions (serverless-safe conversation memory for the command bar).
-- Note: the API also creates this table idempotently at runtime
-- (see server/command.js ensurePendingTable), so this is belt-and-braces
-- for fresh database setups.

CREATE TABLE IF NOT EXISTS pending_commands (
  user_id    TEXT PRIMARY KEY,
  company_id TEXT,
  parsed     TEXT NOT NULL,   -- JSON of the partially-parsed command
  missing    TEXT NOT NULL,   -- JSON array of still-missing slot names
  question   TEXT,            -- last clarification question asked
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL    -- pending state auto-expires (15 min)
);

-- Nexora app schema for Supabase (Postgres), mirroring the Express app's
-- original SQLite schema 1:1 (text ids, ISO-8601 text timestamps, integer flags).
-- NOTE: the earlier 0001_init.sql scaffolding defines DIFFERENT tables with the
-- same names (uuid PKs, no password_hash, etc.). Only run this migration if those
-- tables are absent or have been dropped; otherwise drop the stale 0001 tables
-- first (verify they hold no real data).

create table if not exists public.companies (
  id text primary key,
  name text not null,
  industry text,
  created_at text not null
);

create table if not exists public.users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  full_name text not null,
  company_id text not null references public.companies(id),
  department text not null default 'finance',
  role text not null default 'employee',
  created_at text not null
);

create table if not exists public.workflow_actions (
  id text primary key,
  user_id text not null references public.users(id),
  company_id text not null,
  department text not null,
  action text not null,
  entity text not null,
  entity_id text,
  fields text not null default '{}',
  status text not null,
  summary text,
  error_message text,
  created_at text not null,
  resolved_at text
);

create table if not exists public.notifications (
  id text primary key,
  user_id text not null,
  company_id text not null,
  type text not null,
  title text not null,
  message text not null,
  related_action_id text,
  is_read integer not null default 0,
  created_at text not null
);

create table if not exists public.llm_logs (
  id text primary key,
  user_id text,
  input_text text not null,
  raw_model_response text,
  parsed_successfully integer not null default 0,
  retry_count integer not null default 0,
  final_status text not null,
  created_at text not null
);

create table if not exists public.demo_requests (
  id text primary key,
  name text not null,
  email text not null,
  company text not null,
  message text,
  created_at text not null
);

create table if not exists public.invoices (
  id text primary key,
  company_id text not null,
  vendor text not null,
  amount double precision not null,
  due_date text,
  status text not null default 'pending',
  created_at text not null
);

create table if not exists public.expenses (
  id text primary key,
  company_id text not null,
  employee_name text not null,
  amount double precision not null,
  category text,
  status text not null default 'pending',
  created_at text not null
);

create table if not exists public.leave_requests (
  id text primary key,
  company_id text not null,
  employee_id text,
  employee_name text not null,
  type text not null,
  start_date text not null,
  end_date text not null,
  status text not null default 'pending'
);

create table if not exists public.purchase_orders (
  id text primary key,
  company_id text not null,
  item text not null,
  quantity integer not null,
  amount double precision not null,
  status text not null default 'pending'
);

create table if not exists public.employees (
  id text primary key,
  company_id text not null,
  full_name text not null,
  email text,
  department text,
  title text,
  status text not null default 'active',
  start_date text,
  created_at text not null
);

create table if not exists public.shipments (
  id text primary key,
  company_id text not null,
  carrier text,
  tracking text,
  origin text,
  destination text,
  status text not null default 'created',
  created_at text not null
);

create table if not exists public.inventory_items (
  id text primary key,
  company_id text not null,
  sku text not null,
  name text not null,
  quantity integer not null default 0,
  reorder_level integer not null default 10,
  status text not null default 'ok',
  created_at text not null
);

create table if not exists public.quality_inspections (
  id text primary key,
  company_id text not null,
  lot text,
  inspector text,
  due_date text,
  result text,
  status text not null default 'pending',
  created_at text not null
);

create table if not exists public.quality_issues (
  id text primary key,
  company_id text not null,
  title text not null,
  severity text not null default 'medium',
  status text not null default 'open',
  created_at text not null
);

-- Helpful indexes for the app's hot queries
create index if not exists idx_workflow_actions_company on public.workflow_actions (company_id, created_at desc);
create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);
create index if not exists idx_users_email on public.users (email);

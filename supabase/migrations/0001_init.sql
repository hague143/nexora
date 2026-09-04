-- Nexora schema for Supabase (Postgres)
-- Enable when connecting a hosted project. Local demo uses the Express API.

create extension if not exists "pgcrypto";

do $$ begin
  create type public.user_role as enum ('admin', 'manager', 'employee');
exception when duplicate_object then null;
end $$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  role public.user_role not null default 'employee',
  created_at timestamptz not null default now()
);

create table if not exists public.workflow_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  department text not null,
  action text not null,
  entity text not null,
  entity_id text,
  fields jsonb not null default '{}'::jsonb,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text not null,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor text not null,
  amount numeric not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'pending'
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item text not null,
  quantity integer not null,
  amount numeric not null,
  status text not null default 'pending'
);

alter table public.companies enable row level security;
alter table public.users enable row level security;
alter table public.workflow_actions enable row level security;
alter table public.demo_requests enable row level security;
alter table public.invoices enable row level security;
alter table public.leave_requests enable row level security;
alter table public.purchase_orders enable row level security;

create or replace function public.current_company_id()
returns uuid
language sql
stable
as $$
  select company_id from public.users where id = auth.uid()
$$;

create policy companies_select on public.companies
  for select using (id = public.current_company_id());

create policy users_select on public.users
  for select using (company_id = public.current_company_id());

create policy users_update_admin on public.users
  for update using (
    company_id = public.current_company_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

create policy workflow_select on public.workflow_actions
  for select using (
    exists (
      select 1 from public.users u
      where u.id = workflow_actions.user_id and u.company_id = public.current_company_id()
    )
  );

create policy workflow_insert on public.workflow_actions
  for insert with check (user_id = auth.uid());

create policy demo_insert on public.demo_requests
  for insert with check (true);

create policy invoices_all on public.invoices
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy leave_all on public.leave_requests
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy po_all on public.purchase_orders
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

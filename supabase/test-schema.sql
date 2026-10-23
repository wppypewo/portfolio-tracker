-- 整合測試用最小 schema。正式欄位變動時需同步，讓 RPC 測試能抓到漂移。
-- 冪等：可重複套用。

create schema if not exists auth;
do $$ begin
  create role anon;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role authenticated;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role;
exception when duplicate_object then null;
end $$;

create table if not exists auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid() returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
-- 與 supabase/auth migration 20220531120530 的定義相同
create or replace function auth.jwt() returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- MFA factor：只放 mfa_satisfied() 用到的欄位（supabase/auth migration 20221003041349）。
-- 刻意不 grant 給 authenticated，讓測試能抓到函式少了 security definer。
do $$ begin
  create type auth.factor_status as enum ('unverified', 'verified');
exception when duplicate_object then null;
end $$;
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status auth.factor_status not null
);

grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.jwt() to authenticated;

drop table if exists recurring_plan_runs cascade;
drop table if exists recurring_plans cascade;
drop table if exists decision_reviews cascade;
drop table if exists investment_decisions cascade;
drop table if exists account_status_history cascade;
drop table if exists account_snapshots cascade;
drop table if exists transactions cascade;
drop table if exists accounts cascade;
drop table if exists profiles cascade;
drop type if exists txn_type cascade;
drop type if exists price_market cascade;
drop type if exists asset_class cascade;
drop type if exists account_status cascade;

create type asset_class as enum ('liquid_cash','fund','stock','crypto','precious_metal','other_investment','fixed_asset','receivable','liability');
create type price_market as enum ('us','tw','crypto','manual');
create type txn_type as enum ('create','adjust_quantity','adjust_balance','price_update','sell','dividend','interest','adjust_cost');
create type account_status as enum ('active','archived');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  base_currency text not null default 'TWD',
  allocation_targets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  asset_class asset_class not null,
  price_market price_market not null default 'manual',
  symbol text,
  quantity numeric(20,8) not null default 0,
  native_currency text not null default 'TWD',
  last_unit_price numeric(20,8),
  last_fx_rate numeric(20,8) not null default 1,
  manual_value_base numeric(20,2),
  last_priced_at timestamptz,
  cost_basis_twd numeric(20,2) not null default 0,
  cost_basis_native numeric(20,8) not null default 0,
  realized_pnl_twd numeric(20,2) not null default 0,
  status account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null references accounts(id) on delete cascade,
  type txn_type not null,
  quantity_after numeric(20,8),
  unit_price numeric(20,8),
  fx_rate numeric(20,8),
  value_after_base numeric(20,2),
  note text,
  created_at timestamptz not null default now(),
  cashflow_twd numeric(20,2),
  realized_pnl numeric(20,2)
);

create table account_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null references accounts(id) on delete cascade,
  snapshot_date date not null,
  quantity numeric(20,8) not null,
  unit_price numeric(20,8),
  fx_rate numeric(20,8) not null default 1,
  value_base numeric(20,2) not null,
  created_at timestamptz not null default now(),
  unique (account_id, snapshot_date)
);

create table recurring_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null references accounts(id) on delete cascade,
  amount_twd numeric(20,2) not null check (amount_twd > 0),
  day_of_month integer not null check (day_of_month between 1 and 28),
  start_date date not null,
  next_run_date date not null,
  last_run_date date,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

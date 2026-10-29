-- Delivery Manager: テーブル定義
-- 金額は円単位の numeric(12,0)、日時は timestamptz、業務日付は日本時間（Asia/Tokyo）で扱う。

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;

-- ---------------------------------------------------------------
-- 列挙型
-- ---------------------------------------------------------------
create type public.app_role as enum ('admin', 'driver');
create type public.order_status as enum (
  'unassigned',  -- 未割当
  'assigned',    -- 配車済
  'picked_up',   -- 集荷完了
  'in_transit',  -- 配送中
  'delivered',   -- 配送完了
  'failed',      -- 配送失敗
  'cancelled'    -- キャンセル
);
create type public.employment_type as enum ('full_time', 'contractor');
create type public.driver_status as enum ('active', 'day_off', 'leave', 'retired');
create type public.vehicle_status as enum ('active', 'maintenance', 'standby', 'retired');
create type public.expense_category as enum (
  'fuel', 'toll', 'labor', 'outsourcing', 'vehicle_maintenance', 'other'
);

-- ---------------------------------------------------------------
-- 共通トリガー：updated_at
-- ---------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------
-- 会社（テナント）
-- ---------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  is_demo boolean not null default false,
  demo_owner uuid,
  demo_expires_at timestamptz,
  demo_seed integer,
  order_seq integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_demo_expires_idx on public.companies (demo_expires_at) where is_demo;

create table public.offices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  address text not null,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index offices_company_idx on public.offices (company_id);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null check (char_length(name) between 1 and 50),
  name_kana text,
  phone text,
  email text,
  office_id uuid references public.offices (id) on delete set null,
  employment_type public.employment_type not null default 'full_time',
  status public.driver_status not null default 'active',
  hired_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create index drivers_company_idx on public.drivers (company_id, status);

-- profiles は auth.users と 1:1。driver ロールは drivers の1行と紐づく。
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  role public.app_role not null,
  driver_id uuid references public.drivers (id) on delete set null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_driver_role check (role <> 'driver' or driver_id is not null)
);
create index profiles_company_idx on public.profiles (company_id);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  plate_number text not null,
  vehicle_type text not null,
  maker text not null,
  model text,
  capacity_kg integer check (capacity_kg is null or capacity_kg > 0),
  inspection_expires_on date not null,
  insurance_expires_on date not null,
  status public.vehicle_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, plate_number)
);
create index vehicles_company_idx on public.vehicles (company_id, status);
create index vehicles_inspection_idx on public.vehicles (company_id, inspection_expires_on);
create index vehicles_insurance_idx on public.vehicles (company_id, insurance_expires_on);

-- 車両の担当履歴（end_on が null の行が現在の担当）
create table public.vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  start_on date not null,
  end_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_on is null or end_on >= start_on)
);
create unique index vehicle_assignments_current_vehicle on public.vehicle_assignments (vehicle_id) where end_on is null;
create unique index vehicle_assignments_current_driver on public.vehicle_assignments (driver_id) where end_on is null;
create index vehicle_assignments_company_idx on public.vehicle_assignments (company_id);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null check (char_length(name) between 1 and 100),
  contact_name text,
  phone text,
  email text,
  address text,
  lat double precision,
  lng double precision,
  started_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create index clients_company_idx on public.clients (company_id);
create index clients_name_trgm on public.clients using gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------
-- 配送案件
-- ---------------------------------------------------------------
create table public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_no text not null,
  client_id uuid not null references public.clients (id) on delete restrict,
  pickup_address text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  delivery_name text not null,
  delivery_address text not null,
  delivery_lat double precision,
  delivery_lng double precision,
  pickup_at timestamptz not null,
  delivery_at timestamptz not null,
  driver_id uuid references public.drivers (id) on delete restrict,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  cargo_type text not null,
  quantity integer not null check (quantity > 0),
  fee numeric(12, 0) not null check (fee >= 0),
  status public.order_status not null default 'unassigned',
  completed_at timestamptz,
  notes text,
  invoiced boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, order_no),
  constraint delivery_orders_time_order check (delivery_at >= pickup_at),
  constraint delivery_orders_completed check ((status = 'delivered') = (completed_at is not null)),
  constraint delivery_orders_driver_required check (
    status in ('unassigned', 'cancelled') or driver_id is not null
  ),
  constraint delivery_orders_unassigned_no_driver check (status <> 'unassigned' or driver_id is null)
);
create index delivery_orders_company_delivery_idx on public.delivery_orders (company_id, delivery_at);
create index delivery_orders_company_status_idx on public.delivery_orders (company_id, status, delivery_at);
create index delivery_orders_driver_idx on public.delivery_orders (driver_id, delivery_at);
create index delivery_orders_client_idx on public.delivery_orders (client_id, delivery_at);
create index delivery_orders_search_trgm on public.delivery_orders
  using gin ((order_no || ' ' || delivery_name || ' ' || delivery_address) extensions.gin_trgm_ops);

create table public.delivery_status_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid not null references public.delivery_orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  changed_by uuid,
  changed_by_name text,
  note text,
  created_at timestamptz not null default now()
);
create index delivery_status_logs_order_idx on public.delivery_status_logs (order_id, created_at);
create index delivery_status_logs_company_idx on public.delivery_status_logs (company_id, created_at desc);

create table public.delivery_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid not null references public.delivery_orders (id) on delete cascade,
  author_id uuid,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index delivery_notes_order_idx on public.delivery_notes (order_id, created_at);

-- ---------------------------------------------------------------
-- 経費・通知・操作履歴
-- ---------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  spent_on date not null,
  category public.expense_category not null,
  amount numeric(12, 0) not null check (amount >= 0),
  driver_id uuid references public.drivers (id) on delete set null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_company_date_idx on public.expenses (company_id, spent_on);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  audience public.app_role not null,
  driver_id uuid references public.drivers (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (audience = 'admin' or driver_id is not null)
);
create index notifications_company_idx on public.notifications (company_id, audience, created_at desc);
create index notifications_driver_idx on public.notifications (driver_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_id uuid,
  actor_name text,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_company_idx on public.audit_logs (company_id, created_at desc);

-- updated_at トリガー
do $$
declare t text;
begin
  foreach t in array array['companies','offices','drivers','profiles','vehicles','vehicle_assignments',
                           'clients','delivery_orders','expenses']
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app.touch_updated_at()',
      t || '_touch_updated_at', t);
  end loop;
end $$;

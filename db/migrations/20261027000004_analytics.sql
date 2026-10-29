-- Delivery Manager: 集計ロジック
-- 売上・経費・利益はすべてここで計算し、どの画面も同じ関数を使う。
--   売上      = 配送完了案件の配送料金（計上日 = 配送予定日、日本時間）
--   配送原価  = 経費の合計（燃料費・高速代・人件費・外注費・車両維持費・その他）
--   粗利益    = 売上 - 配送原価
--   粗利益率  = 粗利益 ÷ 売上 × 100（売上 0 円のときは null）
--   遅延      = 予定時刻から15分を過ぎて完了した案件、または予定時刻を過ぎても完了していない案件

create or replace function app.jst_start(p_day date) returns timestamptz
language sql immutable as $$ select (p_day::timestamp at time zone 'Asia/Tokyo') $$;

create or replace function app.jst_date(p_at timestamptz) returns date
language sql immutable as $$ select (p_at at time zone 'Asia/Tokyo')::date $$;

create or replace function app.today_jst() returns date
language sql stable as $$ select (now() at time zone 'Asia/Tokyo')::date $$;

create or replace function app.require_admin() returns void
language plpgsql stable as $$
begin
  if not app.is_admin() then
    raise exception '管理者のみ閲覧できます' using errcode = 'insufficient_privilege';
  end if;
end $$;

-- 案件の集計用ビュー（RLS は呼び出したユーザーの権限で効く）
create or replace view public.v_order_facts with (security_invoker = true) as
select
  o.id,
  o.company_id,
  o.client_id,
  o.driver_id,
  o.status,
  o.fee,
  o.delivery_at,
  o.completed_at,
  app.jst_date(o.delivery_at) as service_date,
  case when o.status = 'delivered' then o.fee else 0 end as revenue,
  case when o.status not in ('cancelled', 'failed') then o.fee else 0 end as expected_revenue,
  (o.status = 'delivered' and o.completed_at > o.delivery_at + interval '15 minutes')
    or (o.status in ('unassigned', 'assigned', 'picked_up', 'in_transit') and o.delivery_at + interval '15 minutes' < now())
    as is_late
from public.delivery_orders o;

grant select on public.v_order_facts to authenticated;

-- 期間の合計
create or replace function public.analytics_summary(p_from date, p_to date)
returns table (
  revenue numeric, expense numeric, gross_profit numeric, gross_margin numeric,
  order_count bigint, delivered_count bigint, late_count bigint
)
language plpgsql stable set search_path = '' as $$
begin
  perform app.require_admin();
  return query
  with o as (
    select coalesce(sum(f.revenue), 0) as revenue,
           count(*) filter (where f.status <> 'cancelled') as order_count,
           count(*) filter (where f.status = 'delivered') as delivered_count,
           count(*) filter (where f.is_late) as late_count
      from public.v_order_facts f
     where f.delivery_at >= app.jst_start(p_from) and f.delivery_at < app.jst_start(p_to + 1)
  ), e as (
    select coalesce(sum(x.amount), 0) as expense
      from public.expenses x
     where x.spent_on between p_from and p_to
  )
  select o.revenue, e.expense, o.revenue - e.expense,
         case when o.revenue = 0 then null else round((o.revenue - e.expense) / o.revenue * 100, 1) end,
         o.order_count, o.delivered_count, o.late_count
    from o, e;
end $$;

-- 推移（日別・週別・月別）
create or replace function public.analytics_series(p_from date, p_to date, p_grain text)
returns table (
  bucket date, revenue numeric, expense numeric, gross_profit numeric,
  order_count bigint, delivered_count bigint
)
language plpgsql stable set search_path = '' as $$
declare
  v_step interval;
begin
  perform app.require_admin();
  if p_grain not in ('day', 'week', 'month') then
    raise exception '集計単位が不正です' using errcode = 'invalid_parameter_value';
  end if;
  v_step := ('1 ' || p_grain)::interval;
  return query
  with buckets as (
    select g::date as b
      from generate_series(date_trunc(p_grain, p_from::timestamp), p_to::timestamp, v_step) g
  ), o as (
    select date_trunc(p_grain, f.service_date::timestamp)::date as b,
           sum(f.revenue) as revenue,
           count(*) filter (where f.status <> 'cancelled') as order_count,
           count(*) filter (where f.status = 'delivered') as delivered_count
      from public.v_order_facts f
     where f.delivery_at >= app.jst_start(p_from) and f.delivery_at < app.jst_start(p_to + 1)
     group by 1
  ), e as (
    select date_trunc(p_grain, x.spent_on::timestamp)::date as b, sum(x.amount) as expense
      from public.expenses x
     where x.spent_on between p_from and p_to
     group by 1
  )
  select buckets.b,
         coalesce(o.revenue, 0), coalesce(e.expense, 0),
         coalesce(o.revenue, 0) - coalesce(e.expense, 0),
         coalesce(o.order_count, 0), coalesce(o.delivered_count, 0)
    from buckets
    left join o on o.b = buckets.b
    left join e on e.b = buckets.b
   order by buckets.b;
end $$;

-- ドライバー別
create or replace function public.analytics_by_driver(p_from date, p_to date)
returns table (
  driver_id uuid, driver_name text, order_count bigint, delivered_count bigint,
  late_count bigint, revenue numeric, completion_rate numeric
)
language plpgsql stable set search_path = '' as $$
begin
  perform app.require_admin();
  return query
  select d.id, d.name,
         count(f.id) filter (where f.status <> 'cancelled'),
         count(f.id) filter (where f.status = 'delivered'),
         count(f.id) filter (where f.is_late),
         coalesce(sum(f.revenue), 0),
         case when count(f.id) filter (where f.status <> 'cancelled') = 0 then null
              else round(count(f.id) filter (where f.status = 'delivered')::numeric
                         / count(f.id) filter (where f.status <> 'cancelled') * 100, 1) end
    from public.drivers d
    left join public.v_order_facts f
      on f.driver_id = d.id
     and f.delivery_at >= app.jst_start(p_from) and f.delivery_at < app.jst_start(p_to + 1)
   where d.status <> 'retired' or f.id is not null
   group by d.id, d.name
   order by coalesce(sum(f.revenue), 0) desc, d.name;
end $$;

-- 荷主別
create or replace function public.analytics_by_client(p_from date, p_to date)
returns table (client_id uuid, client_name text, order_count bigint, revenue numeric)
language plpgsql stable set search_path = '' as $$
begin
  perform app.require_admin();
  return query
  select c.id, c.name,
         count(f.id) filter (where f.status <> 'cancelled'),
         coalesce(sum(f.revenue), 0)
    from public.clients c
    left join public.v_order_facts f
      on f.client_id = c.id
     and f.delivery_at >= app.jst_start(p_from) and f.delivery_at < app.jst_start(p_to + 1)
   group by c.id, c.name
   order by coalesce(sum(f.revenue), 0) desc, c.name;
end $$;

-- 経費内訳
create or replace function public.analytics_expense_breakdown(p_from date, p_to date)
returns table (category public.expense_category, amount numeric)
language plpgsql stable set search_path = '' as $$
begin
  perform app.require_admin();
  return query
  select x.category, sum(x.amount)
    from public.expenses x
   where x.spent_on between p_from and p_to
   group by x.category
   order by sum(x.amount) desc;
end $$;

-- ダッシュボードの KPI（1回の呼び出しでまとめて返す）
-- 前月比は「今月1日〜今日」と「前月1日〜前月の同じ日」を比べる（月の途中でも公平に比較するため）
create or replace function public.dashboard_kpis(p_day date)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_month_start date := date_trunc('month', p_day::timestamp)::date;
  v_prev_start date := (date_trunc('month', p_day::timestamp) - interval '1 month')::date;
  v_prev_end date := least(
    (v_prev_start + (p_day - v_month_start))::date,
    (v_month_start - 1)::date);
  v_today record;
  v_month record;
  v_prev record;
  v_active_drivers bigint;
begin
  perform app.require_admin();

  select count(*) filter (where f.status <> 'cancelled') as planned,
         count(*) filter (where f.status = 'delivered') as delivered,
         count(*) filter (where f.status in ('picked_up', 'in_transit')) as in_progress,
         count(*) filter (where f.status in ('unassigned', 'assigned')) as not_started,
         count(*) filter (where f.status = 'unassigned') as unassigned,
         count(*) filter (where f.status = 'failed') as failed,
         count(*) filter (where f.is_late) as late,
         coalesce(sum(f.expected_revenue), 0) as expected_revenue
    into v_today
    from public.v_order_facts f
   where f.delivery_at >= app.jst_start(p_day) and f.delivery_at < app.jst_start(p_day + 1);

  select count(distinct f.driver_id) into v_active_drivers
    from public.v_order_facts f
   where f.delivery_at >= app.jst_start(p_day) and f.delivery_at < app.jst_start(p_day + 1)
     and f.driver_id is not null and f.status <> 'cancelled';

  select * into v_month from public.analytics_summary(v_month_start, p_day);
  select * into v_prev from public.analytics_summary(v_prev_start, v_prev_end);

  return jsonb_build_object(
    'day', p_day,
    'planned', v_today.planned,
    'delivered', v_today.delivered,
    'inProgress', v_today.in_progress,
    'notStarted', v_today.not_started,
    'unassigned', v_today.unassigned,
    'failed', v_today.failed,
    'late', v_today.late,
    'completionRate', case when v_today.planned = 0 then null
                           else round(v_today.delivered::numeric / v_today.planned * 100, 1) end,
    'activeDrivers', v_active_drivers,
    'expectedRevenueToday', v_today.expected_revenue,
    'monthRevenue', v_month.revenue,
    'monthExpense', v_month.expense,
    'monthGrossProfit', v_month.gross_profit,
    'monthGrossMargin', v_month.gross_margin,
    'prevMonthRevenueSamePeriod', v_prev.revenue,
    'revenueMoM', case when v_prev.revenue = 0 then null
                       else round((v_month.revenue - v_prev.revenue) / v_prev.revenue * 100, 1) end
  );
end $$;

grant execute on function
  public.analytics_summary(date, date),
  public.analytics_series(date, date, text),
  public.analytics_by_driver(date, date),
  public.analytics_by_client(date, date),
  public.analytics_expense_breakdown(date, date),
  public.dashboard_kpis(date)
  to authenticated;
grant execute on all functions in schema app to authenticated;

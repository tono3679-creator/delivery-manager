-- ダッシュボードの遅延件数を「対応中の遅延」と「遅れて完了」に分ける
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
         count(*) filter (where f.is_late and f.status in ('unassigned', 'assigned', 'picked_up', 'in_transit')) as late,
         count(*) filter (where f.is_late and f.status = 'delivered') as late_delivered,
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
    'lateDelivered', v_today.late_delivered,
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


-- 荷主・ドライバーごとの案件推移（荷主詳細・ドライバー詳細のグラフ用）
-- 会社全体の analytics_series と同じ v_order_facts を使うため、数字は他の画面と一致する

create or replace function public.analytics_order_series(
  p_from date,
  p_to date,
  p_grain text,
  p_client_id uuid default null,
  p_driver_id uuid default null
)
returns table (bucket date, revenue numeric, order_count bigint, delivered_count bigint, late_count bigint)
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
           count(*) filter (where f.status = 'delivered') as delivered_count,
           count(*) filter (where f.is_late) as late_count
      from public.v_order_facts f
     where f.delivery_at >= app.jst_start(p_from) and f.delivery_at < app.jst_start(p_to + 1)
       and (p_client_id is null or f.client_id = p_client_id)
       and (p_driver_id is null or f.driver_id = p_driver_id)
     group by 1
  )
  select buckets.b, coalesce(o.revenue, 0), coalesce(o.order_count, 0), coalesce(o.delivered_count, 0), coalesce(o.late_count, 0)
    from buckets
    left join o on o.b = buckets.b
   order by buckets.b;
end $$;

revoke all on function public.analytics_order_series(date, date, text, uuid, uuid) from public, anon;
grant execute on function public.analytics_order_series(date, date, text, uuid, uuid) to authenticated;

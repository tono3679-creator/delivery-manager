-- Delivery Manager: 行レベルセキュリティ（RLS）
-- 方針：
--   * すべての行は「自分の会社」のものだけ見える
--   * 管理者は自社の業務データをすべて操作できる
--   * ドライバーは自分に割り当てられた案件と、その案件に必要な情報だけ見える
--   * ドライバーの案件更新は driver_update_status() 経由のみ
-- (select ...) で囲むのは、行ごとに関数を呼ばず1回だけ評価させるため。

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
revoke all on schema app from public;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
grant usage on schema public to authenticated;

alter table public.companies enable row level security;
alter table public.offices enable row level security;
alter table public.drivers enable row level security;
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_assignments enable row level security;
alter table public.clients enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.delivery_status_logs enable row level security;
alter table public.delivery_notes enable row level security;
alter table public.expenses enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- 権限（行の絞り込みは下のポリシーで行う）
grant select, update on public.companies to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on
  public.offices, public.drivers, public.vehicles, public.vehicle_assignments,
  public.clients, public.delivery_orders, public.expenses
  to authenticated;
grant select on public.delivery_status_logs to authenticated;
grant select, insert on public.delivery_notes to authenticated;
grant select, update (read_at) on public.notifications to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant execute on function public.can_transition(public.order_status, public.order_status) to authenticated;
grant execute on function public.driver_update_status(uuid, public.order_status, public.order_status, text) to authenticated;
grant execute on function public.admin_update_status(uuid, public.order_status, public.order_status, text) to authenticated;

-- companies
create policy companies_select on public.companies for select to authenticated
  using (id = (select app.current_company_id()));
create policy companies_update on public.companies for update to authenticated
  using (id = (select app.current_company_id()) and (select app.is_admin()))
  with check (id = (select app.current_company_id()));

-- profiles：自分自身、または管理者は自社の全員
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid())
         or (company_id = (select app.current_company_id()) and (select app.is_admin())));

-- 管理者が全操作できる表（会社で絞る）
do $$
declare t text;
begin
  foreach t in array array['offices','drivers','vehicles','vehicle_assignments','clients',
                           'delivery_orders','expenses']
  loop
    execute format($f$
      create policy %1$s_admin_all on public.%1$I for all to authenticated
        using (company_id = (select app.current_company_id()) and (select app.is_admin()))
        with check (company_id = (select app.current_company_id()) and (select app.is_admin()))
    $f$, t);
  end loop;
end $$;

-- ドライバー：自分の案件
create policy delivery_orders_driver_select on public.delivery_orders for select to authenticated
  using (driver_id = (select app.current_driver_id()));

-- ドライバー：自分のプロフィール（drivers 行）
create policy drivers_driver_select on public.drivers for select to authenticated
  using (id = (select app.current_driver_id()));

-- ドライバー：自社の営業所・車両（案件に表示するため）
create policy offices_driver_select on public.offices for select to authenticated
  using (company_id = (select app.current_company_id()));
create policy vehicles_driver_select on public.vehicles for select to authenticated
  using (company_id = (select app.current_company_id()) and (select app.current_driver_id()) is not null);

-- ドライバー：自分の案件の荷主だけ
create policy clients_driver_select on public.clients for select to authenticated
  using (exists (
    select 1 from public.delivery_orders o
     where o.client_id = clients.id and o.driver_id = (select app.current_driver_id())
  ));

-- ステータス履歴・メモ
create policy status_logs_admin_select on public.delivery_status_logs for select to authenticated
  using (company_id = (select app.current_company_id()) and (select app.is_admin()));
create policy status_logs_driver_select on public.delivery_status_logs for select to authenticated
  using (exists (
    select 1 from public.delivery_orders o
     where o.id = delivery_status_logs.order_id and o.driver_id = (select app.current_driver_id())
  ));

create policy notes_admin on public.delivery_notes for select to authenticated
  using (company_id = (select app.current_company_id()) and (select app.is_admin()));
create policy notes_admin_insert on public.delivery_notes for insert to authenticated
  with check (company_id = (select app.current_company_id()) and (select app.is_admin())
              and author_id = (select auth.uid()));
create policy notes_driver_select on public.delivery_notes for select to authenticated
  using (exists (
    select 1 from public.delivery_orders o
     where o.id = delivery_notes.order_id and o.driver_id = (select app.current_driver_id())
  ));
create policy notes_driver_insert on public.delivery_notes for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and company_id = (select app.current_company_id())
    and exists (
      select 1 from public.delivery_orders o
       where o.id = delivery_notes.order_id and o.driver_id = (select app.current_driver_id())
    ));

-- 通知
create policy notifications_admin on public.notifications for select to authenticated
  using (company_id = (select app.current_company_id()) and audience = 'admin' and (select app.is_admin()));
create policy notifications_admin_update on public.notifications for update to authenticated
  using (company_id = (select app.current_company_id()) and audience = 'admin' and (select app.is_admin()))
  with check (company_id = (select app.current_company_id()));
create policy notifications_driver on public.notifications for select to authenticated
  using (audience = 'driver' and driver_id = (select app.current_driver_id()));
create policy notifications_driver_update on public.notifications for update to authenticated
  using (audience = 'driver' and driver_id = (select app.current_driver_id()))
  with check (audience = 'driver' and driver_id = (select app.current_driver_id()));

-- 操作履歴：管理者のみ閲覧。記録は本人名義のみ
create policy audit_admin_select on public.audit_logs for select to authenticated
  using (company_id = (select app.current_company_id()) and (select app.is_admin()));
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (company_id = (select app.current_company_id()) and actor_id = (select auth.uid()));

-- Realtime（Supabase Realtime は購読者の RLS を適用して変更を配信する）。
-- 配信の仕組み（publication）がある環境でだけ登録する（Neon・ローカルでは画面が定期的に取り直す）
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.delivery_orders, public.notifications;
  end if;
end $$;

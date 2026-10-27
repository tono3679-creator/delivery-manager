-- 権限の締め直し（Phase 5）
--
-- Supabase は public スキーマの表・関数に anon / authenticated / service_role への「全権限」を既定で付ける。
-- そのままだと、行レベルセキュリティ（RLS）が効かない TRUNCATE や、REFERENCES・TRIGGER、
-- 会社の「デモの期限」を書き換える UPDATE なども付いたままになる。
-- Supabase のデータ API（PostgREST）はブラウザに公開している鍵とログイン中のトークンで呼べるため、
-- アプリの画面を通さない操作でも困らないよう、いったんすべて外してアプリが使う権限だけを付け直す。
--
-- 方針
--   * anon（ログインしていない訪問者）：public スキーマの表・関数は何も使えない
--   * authenticated（ログイン中の利用者）：下に書いた権限だけ。行の絞り込みは RLS（0003）が行う
--   * 会社の情報で変更できるのは会社名だけ（デモの期限・所有者・案件番号の連番は変更できない）
--   * 今後追加する表・関数も、明示的に付けない限り権限を持たない

-- ---------------------------------------------------------------
-- いったんすべて外す
-- ---------------------------------------------------------------
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- 今後作る表・関数にも自動では権限を付けない（マイグレーションを実行するロールが作るもの）
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 表：アプリが使う権限だけを付け直す
-- ---------------------------------------------------------------
grant select on public.companies to authenticated;
grant update (name) on public.companies to authenticated;

grant select on public.profiles to authenticated;

grant select, insert, update, delete on
  public.offices, public.drivers, public.vehicles, public.vehicle_assignments,
  public.clients, public.delivery_orders, public.expenses
  to authenticated;

grant select on public.delivery_status_logs to authenticated;
grant select, insert on public.delivery_notes to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant select on public.client_invoices to authenticated;
grant update (notes) on public.client_invoices to authenticated;
grant select on public.v_order_facts to authenticated;

-- ---------------------------------------------------------------
-- 関数：ログイン中の利用者が呼ぶものだけ（中で会社・ロールを確認している）
-- demo_cleanup() はサーバー（定期実行）専用のため付けない
-- ---------------------------------------------------------------
grant execute on function
  public.can_transition(public.order_status, public.order_status),
  public.driver_update_status(uuid, public.order_status, public.order_status, text),
  public.admin_update_status(uuid, public.order_status, public.order_status, text),
  public.analytics_summary(date, date),
  public.analytics_series(date, date, text),
  public.analytics_by_driver(date, date),
  public.analytics_by_client(date, date),
  public.analytics_expense_breakdown(date, date),
  public.analytics_order_series(date, date, text, uuid, uuid),
  public.dashboard_kpis(date),
  public.demo_switch_role(public.app_role, uuid),
  public.issue_client_invoice(uuid, date, text),
  public.cancel_client_invoice(uuid),
  public.refresh_late_alerts()
  to authenticated;

-- ---------------------------------------------------------------
-- 配送メモ・操作履歴：書いた人の名前と日時はデータベースで決める
--   画面を通さずに書き込まれても、他人の名前を名乗ったり日時をさかのぼったりできないようにする。
-- ---------------------------------------------------------------
create or replace function app.stamp_author() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if app.is_bulk_load() or v_uid is null then
    return new;
  end if;
  v_name := app.current_actor_name();
  if tg_table_name = 'delivery_notes' then
    new.author_id := v_uid;
    new.author_name := coalesce(v_name, new.author_name);
  else
    new.actor_id := v_uid;
    new.actor_name := coalesce(v_name, new.actor_name);
  end if;
  new.created_at := now();
  return new;
end $$;

create trigger delivery_notes_stamp_author before insert on public.delivery_notes
  for each row execute function app.stamp_author();
create trigger audit_logs_stamp_author before insert on public.audit_logs
  for each row execute function app.stamp_author();

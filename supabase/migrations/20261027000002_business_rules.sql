-- Delivery Manager: 業務ルール（ステータス遷移・履歴・配車チェック・通知）

-- デモデータ一括投入中はトリガーの検証・履歴作成を止める。
-- ログインユーザーからは有効にできない（JWT があるとき、または authenticated / anon ロールのときは常に無効）。
-- トリガーは security definer で動くため current_user ではなく role 設定と JWT で判定する。
create or replace function app.is_bulk_load() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.bulk_load', true), '') = 'on'
     and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
     and auth.uid() is null
$$;

-- ---------------------------------------------------------------
-- ログイン中ユーザーの情報（RLS から使う）
-- ---------------------------------------------------------------
create or replace function app.current_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from public.profiles where id = auth.uid()
$$;

create or replace function app.current_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function app.current_driver_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select driver_id from public.profiles where id = auth.uid() and role = 'driver'
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function app.current_actor_name() returns text
language sql stable security definer set search_path = '' as $$
  select display_name from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------
-- ステータス遷移
--   未割当 → 配車済 → 集荷完了 → 配送中 → 配送完了
--   例外：配送失敗（集荷完了・配送中から）、キャンセル（集荷前まで）
--   配送失敗 → 配車済（再配達）/ キャンセル、配車済 → 未割当（配車解除）
-- ---------------------------------------------------------------
create or replace function public.can_transition(p_from public.order_status, p_to public.order_status)
returns boolean language sql immutable as $$
  select case p_from
    when 'unassigned' then p_to in ('assigned', 'cancelled')
    when 'assigned'   then p_to in ('unassigned', 'picked_up', 'cancelled')
    when 'picked_up'  then p_to in ('in_transit', 'failed')
    when 'in_transit' then p_to in ('delivered', 'failed')
    when 'failed'     then p_to in ('assigned', 'cancelled')
    else false
  end
$$;

create or replace function app.orders_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_seq integer;
  v_driver record;
  v_vehicle record;
begin
  if app.is_bulk_load() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.order_no is null or new.order_no = '' then
      update public.companies set order_seq = order_seq + 1
       where id = new.company_id returning order_seq into v_seq;
      new.order_no := 'DM-' || lpad(v_seq::text, 6, '0');
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.status not in ('unassigned', 'assigned') then
      raise exception '新規案件は「未割当」か「配車済」で登録してください' using errcode = 'check_violation';
    end if;
  else
    if new.company_id <> old.company_id or new.order_no <> old.order_no then
      raise exception '会社や案件IDは変更できません' using errcode = 'check_violation';
    end if;
    if old.status in ('delivered', 'cancelled')
       and (new.driver_id is distinct from old.driver_id
            or new.pickup_at <> old.pickup_at or new.delivery_at <> old.delivery_at) then
      raise exception '完了・キャンセル済みの案件は配車や予定を変更できません' using errcode = 'check_violation';
    end if;
  end if;

  -- ドライバーの付け外しに合わせてステータスを自動で揃える
  if new.driver_id is not null and new.status = 'unassigned' then
    new.status := 'assigned';
  elsif new.driver_id is null and new.status = 'assigned' then
    new.status := 'unassigned';
  end if;

  -- ステータス遷移の検証
  if tg_op = 'UPDATE' and new.status <> old.status then
    if not public.can_transition(old.status, new.status) then
      raise exception 'ステータスを「%」から「%」には変更できません', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;

  -- 完了日時
  if new.status = 'delivered' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;

  -- 関連データが同じ会社のものか、割り当て可能か（保存禁止の条件）
  if tg_op = 'INSERT' or new.client_id <> old.client_id then
    perform 1 from public.clients where id = new.client_id and company_id = new.company_id;
    if not found then
      raise exception '荷主が見つかりません' using errcode = 'foreign_key_violation';
    end if;
  end if;

  if new.driver_id is not null and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id) then
    select company_id, status, name into v_driver from public.drivers where id = new.driver_id;
    if not found or v_driver.company_id <> new.company_id then
      raise exception 'ドライバーが見つかりません' using errcode = 'foreign_key_violation';
    end if;
    if v_driver.status in ('leave', 'retired') then
      raise exception '%さんは休職中または退職済みのため割り当てできません', v_driver.name
        using errcode = 'check_violation';
    end if;
  end if;

  if new.vehicle_id is not null and (tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id) then
    select company_id, status, plate_number into v_vehicle from public.vehicles where id = new.vehicle_id;
    if not found or v_vehicle.company_id <> new.company_id then
      raise exception '車両が見つかりません' using errcode = 'foreign_key_violation';
    end if;
    if v_vehicle.status in ('maintenance', 'retired') then
      raise exception '車両 % は整備中または廃車のため使用できません', v_vehicle.plate_number
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

create trigger delivery_orders_before_write
  before insert or update on public.delivery_orders
  for each row execute function app.orders_before_write();

-- ステータス履歴と通知
create or replace function app.orders_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(current_setting('app.status_note', true), '');
  v_actor uuid := auth.uid();
  v_name text := app.current_actor_name();
  v_role public.app_role := app.current_role();
  v_driver_name text;
begin
  if app.is_bulk_load() then
    return null;
  end if;

  if tg_op = 'INSERT' or new.status <> old.status then
    insert into public.delivery_status_logs
      (company_id, order_id, from_status, to_status, changed_by, changed_by_name, note)
    values
      (new.company_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
       v_actor, coalesce(v_name, 'システム'), v_note);
  end if;

  -- 新しく割り当てられたドライバーへ通知
  if new.driver_id is not null and new.status = 'assigned'
     and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id) then
    insert into public.notifications (company_id, audience, driver_id, kind, title, body, link)
    values (new.company_id, 'driver', new.driver_id, 'assigned',
            '新しい配送が割り当てられました',
            new.order_no || ' ' || new.delivery_name,
            '/driver/orders/' || new.id);
  end if;

  -- ドライバーの完了・失敗を管理者へ通知
  if tg_op = 'UPDATE' and new.status <> old.status
     and new.status in ('delivered', 'failed') and v_role = 'driver' then
    select name into v_driver_name from public.drivers where id = new.driver_id;
    insert into public.notifications (company_id, audience, kind, title, body, link)
    values (new.company_id, 'admin',
            case when new.status = 'delivered' then 'delivered' else 'failed' end,
            case when new.status = 'delivered' then '配送が完了しました' else '配送に失敗しました' end,
            new.order_no || ' ' || new.delivery_name || '（' || coalesce(v_driver_name, '') || '）',
            '/orders/' || new.id);
  end if;

  return null;
end $$;

create trigger delivery_orders_after_write
  after insert or update on public.delivery_orders
  for each row execute function app.orders_after_write();

-- ---------------------------------------------------------------
-- ドライバー用：自分の案件のステータスを進める
-- p_expected は画面に表示していたステータス。異なれば更新しない（二重送信・同時操作の防止）。
-- ---------------------------------------------------------------
create or replace function public.driver_update_status(
  p_order_id uuid,
  p_expected public.order_status,
  p_to public.order_status,
  p_note text default null
) returns public.delivery_orders
language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := app.current_driver_id();
  v_order public.delivery_orders;
begin
  if v_driver is null then
    raise exception 'ドライバーとしてログインしてください' using errcode = 'insufficient_privilege';
  end if;
  if p_to not in ('picked_up', 'in_transit', 'delivered', 'failed') then
    raise exception 'この操作はできません' using errcode = 'insufficient_privilege';
  end if;
  if p_to = 'failed' and coalesce(btrim(p_note), '') = '' then
    raise exception '配送失敗の理由を入力してください' using errcode = 'check_violation';
  end if;

  select * into v_order from public.delivery_orders where id = p_order_id for update;
  if not found or v_order.driver_id is distinct from v_driver then
    raise exception '案件が見つかりません' using errcode = 'no_data_found';
  end if;
  if v_order.status <> p_expected then
    raise exception '案件のステータスが更新されています。画面を更新してください'
      using errcode = 'serialization_failure';
  end if;

  perform set_config('app.status_note', coalesce(p_note, ''), true);
  update public.delivery_orders set status = p_to where id = p_order_id returning * into v_order;
  perform set_config('app.status_note', '', true);
  return v_order;
end $$;

-- ---------------------------------------------------------------
-- 管理者用：ステータス変更（メモ付き・楽観ロック）
-- ---------------------------------------------------------------
create or replace function public.admin_update_status(
  p_order_id uuid,
  p_expected public.order_status,
  p_to public.order_status,
  p_note text default null
) returns public.delivery_orders
language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.delivery_orders;
begin
  if not app.is_admin() then
    raise exception '管理者のみ操作できます' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.status_note', coalesce(p_note, ''), true);
  update public.delivery_orders set status = p_to
   where id = p_order_id and status = p_expected
   returning * into v_order;
  perform set_config('app.status_note', '', true);
  if v_order.id is null then
    raise exception '案件のステータスが更新されています。画面を更新してください'
      using errcode = 'serialization_failure';
  end if;
  return v_order;
end $$;

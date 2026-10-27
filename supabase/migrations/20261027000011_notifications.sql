-- 通知の追加（Phase 4）
--   ・通知と案件を結びつける（order_id）。同じ案件の遅延を二重に通知しないため
--   ・遅延（管理者向け）：配送予定時刻を 15 分過ぎても完了していない案件。管理者の画面から定期的に refresh_late_alerts() を呼ぶ
--   ・キャンセル・削除（担当ドライバー向け）：配車済みの案件が取り消されたことを伝える
--   ・配送メモ（ドライバー → 管理者、管理者 → 担当ドライバー）

alter table public.notifications
  add column order_id uuid references public.delivery_orders (id) on delete set null;

-- これまでの通知はリンク先から案件を結びつける
update public.notifications n
   set order_id = o.id
  from public.delivery_orders o
 where n.link ~ '/orders/[0-9a-f-]{36}$'
   and o.id = substring(n.link from '([0-9a-f-]{36})$')::uuid
   and o.company_id = n.company_id;

create index notifications_order_idx on public.notifications (order_id) where order_id is not null;
-- 遅延の通知は1案件につき1回
create unique index notifications_late_once on public.notifications (order_id) where kind = 'late';

-- ---------------------------------------------------------------
-- 案件の登録・更新時の通知（0007 の内容に order_id とキャンセルの通知を加える）
-- ---------------------------------------------------------------
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

  -- 新しく割り当てられたドライバー（再配達を含む）へ通知
  if new.driver_id is not null and new.status = 'assigned'
     and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id or old.status <> 'assigned') then
    insert into public.notifications (company_id, audience, driver_id, order_id, kind, title, body, link)
    values (new.company_id, 'driver', new.driver_id, new.id, 'assigned',
            case when tg_op = 'UPDATE' and old.status = 'failed' then '再配達が割り当てられました'
                 else '新しい配送が割り当てられました' end,
            new.order_no || ' ' || new.delivery_name,
            '/driver/orders/' || new.id);
  end if;

  -- 担当を外れたドライバーへ通知
  if tg_op = 'UPDATE' and old.driver_id is not null and new.driver_id is distinct from old.driver_id then
    insert into public.notifications (company_id, audience, driver_id, order_id, kind, title, body, link)
    values (new.company_id, 'driver', old.driver_id, new.id, 'unassigned',
            '配送の割り当てが解除されました',
            new.order_no || ' ' || new.delivery_name,
            null);
  end if;

  -- 配車済みの案件がキャンセルされたら担当ドライバーへ通知（担当はそのまま残るため、上の通知とは重ならない）
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status = 'assigned'
     and new.driver_id is not null and new.driver_id = old.driver_id then
    insert into public.notifications (company_id, audience, driver_id, order_id, kind, title, body, link)
    values (new.company_id, 'driver', new.driver_id, new.id, 'cancelled',
            '配送がキャンセルされました',
            new.order_no || ' ' || new.delivery_name || coalesce('（' || v_note || '）', ''),
            null);
  end if;

  -- 担当のまま予定時刻が変わったら通知
  if tg_op = 'UPDATE' and new.driver_id is not null and new.driver_id = old.driver_id
     and new.status in ('assigned', 'picked_up', 'in_transit')
     and (new.pickup_at <> old.pickup_at or new.delivery_at <> old.delivery_at) then
    insert into public.notifications (company_id, audience, driver_id, order_id, kind, title, body, link)
    values (new.company_id, 'driver', new.driver_id, new.id, 'rescheduled',
            '配送予定の時刻が変更されました',
            new.order_no || ' ' || new.delivery_name,
            '/driver/orders/' || new.id);
  end if;

  -- ドライバーの完了・失敗を管理者へ通知
  if tg_op = 'UPDATE' and new.status <> old.status
     and new.status in ('delivered', 'failed') and v_role = 'driver' then
    select name into v_driver_name from public.drivers where id = new.driver_id;
    insert into public.notifications (company_id, audience, order_id, kind, title, body, link)
    values (new.company_id, 'admin', new.id,
            case when new.status = 'delivered' then 'delivered' else 'failed' end,
            case when new.status = 'delivered' then '配送が完了しました' else '配送に失敗しました' end,
            new.order_no || ' ' || new.delivery_name || '（' || coalesce(v_driver_name, '') || '）',
            '/orders/' || new.id);
  end if;

  return null;
end $$;

-- ---------------------------------------------------------------
-- 配車済みの案件が削除されたら担当ドライバーへ通知（案件は残らないので order_id・リンクは付けない）
-- ---------------------------------------------------------------
create or replace function app.orders_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.is_bulk_load() then
    return null;
  end if;
  -- 会社ごと削除しているとき（デモの期限切れなど）は通知しない
  if old.driver_id is not null and old.status = 'assigned'
     and exists (select 1 from public.companies where id = old.company_id)
     and exists (select 1 from public.drivers where id = old.driver_id) then
    insert into public.notifications (company_id, audience, driver_id, kind, title, body, link)
    values (old.company_id, 'driver', old.driver_id, 'cancelled',
            '配送が取り消されました',
            old.order_no || ' ' || old.delivery_name || '（案件が削除されました）',
            null);
  end if;
  return null;
end $$;

create trigger delivery_orders_after_delete
  after delete on public.delivery_orders
  for each row execute function app.orders_after_delete();

-- ---------------------------------------------------------------
-- 配送メモの通知
--   ドライバーが書いたメモ → 管理者へ
--   管理者が書いたメモ → 担当ドライバーへ（担当がいるときだけ）
-- ---------------------------------------------------------------
create or replace function app.notes_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.current_role();
  v_order record;
  v_excerpt text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 60);
begin
  if app.is_bulk_load() then
    return null;
  end if;
  select id, order_no, delivery_name, driver_id into v_order
    from public.delivery_orders where id = new.order_id;
  if v_order.id is null then
    return null;
  end if;

  if v_role = 'driver' then
    insert into public.notifications (company_id, audience, order_id, kind, title, body, link)
    values (new.company_id, 'admin', new.order_id, 'note',
            new.author_name || 'さんからメモが届きました',
            v_order.order_no || ' ' || v_excerpt,
            '/orders/' || new.order_id);
  elsif v_role = 'admin' and v_order.driver_id is not null then
    insert into public.notifications (company_id, audience, driver_id, order_id, kind, title, body, link)
    values (new.company_id, 'driver', v_order.driver_id, new.order_id, 'note',
            '管理者からメモが届きました',
            v_order.order_no || ' ' || v_excerpt,
            '/driver/orders/' || new.order_id);
  end if;
  return null;
end $$;

create trigger delivery_notes_after_insert
  after insert on public.delivery_notes
  for each row execute function app.notes_after_insert();

-- ---------------------------------------------------------------
-- 遅延の通知（管理者向け）
--   配送予定時刻 + 15 分を過ぎても完了していない案件を、1案件につき1回だけ通知する（遅延の判定は v_order_facts と同じ）。
--   時間の経過で起きる出来事なので、管理者の画面が開いている間、定期的に呼び出す。直近2日より前の案件は対象にしない。
--   戻り値：新しく通知した件数
-- ---------------------------------------------------------------
create or replace function public.refresh_late_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
  v_count integer;
begin
  if v_company is null or not app.is_admin() then
    raise exception 'この操作を行う権限がありません' using errcode = 'insufficient_privilege';
  end if;
  insert into public.notifications (company_id, audience, order_id, kind, title, body, link)
  select o.company_id, 'admin', o.id, 'late', '配送が遅れています',
         o.order_no || ' ' || o.delivery_name
           || '（予定 ' || to_char(o.delivery_at at time zone 'Asia/Tokyo', 'HH24:MI') || '・'
           || coalesce(d.name, '未割当') || '）',
         '/orders/' || o.id
    from public.delivery_orders o
    left join public.drivers d on d.id = o.driver_id
   where o.company_id = v_company
     and o.status in ('unassigned', 'assigned', 'picked_up', 'in_transit')
     and o.delivery_at + interval '15 minutes' < now()
     and o.delivery_at > now() - interval '2 days'
   order by o.delivery_at
  on conflict (order_id) where kind = 'late' do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.refresh_late_alerts() from public, anon;
grant execute on function public.refresh_late_alerts() to authenticated;

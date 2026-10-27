-- 配車変更の通知を追加
--   ・再配達（配送失敗 → 配車済）でも担当ドライバーへ通知する
--   ・担当を外れたドライバーへ「割り当て解除」を通知する（ドライバー画面からその案件が消えることを伝え、画面を更新させる）

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
    insert into public.notifications (company_id, audience, driver_id, kind, title, body, link)
    values (new.company_id, 'driver', new.driver_id, 'assigned',
            case when tg_op = 'UPDATE' and old.status = 'failed' then '再配達が割り当てられました'
                 else '新しい配送が割り当てられました' end,
            new.order_no || ' ' || new.delivery_name,
            '/driver/orders/' || new.id);
  end if;

  -- 担当を外れたドライバーへ通知
  if tg_op = 'UPDATE' and old.driver_id is not null and new.driver_id is distinct from old.driver_id then
    insert into public.notifications (company_id, audience, driver_id, kind, title, body, link)
    values (new.company_id, 'driver', old.driver_id, 'unassigned',
            '配送の割り当てが解除されました',
            new.order_no || ' ' || new.delivery_name,
            null);
  end if;

  -- 担当のまま予定時刻が変わったら通知
  if tg_op = 'UPDATE' and new.driver_id is not null and new.driver_id = old.driver_id
     and new.status in ('assigned', 'picked_up', 'in_transit')
     and (new.pickup_at <> old.pickup_at or new.delivery_at <> old.delivery_at) then
    insert into public.notifications (company_id, audience, driver_id, kind, title, body, link)
    values (new.company_id, 'driver', new.driver_id, 'rescheduled',
            '配送予定の時刻が変更されました',
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

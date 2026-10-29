-- Delivery Manager: マスタ（ドライバー・車両・担当車両）の業務ルール
-- 画面とサーバー処理でも確認するが、最終的な保存禁止は DB で守る（直接 API を叩かれても崩れないように）。

-- ---------------------------------------------------------------
-- 管理コードの自動採番（D-001 / V-001 / C-001）
--   未指定のときだけ、会社内の最大番号 + 1 を振る。同時登録に備えて会社×表単位でロックする。
-- ---------------------------------------------------------------
create or replace function app.assign_master_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prefix text := tg_argv[0];
  v_next integer;
begin
  if new.code is not null and new.code <> '' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.company_id::text));
  execute format(
    $q$select coalesce(max((substring(code from '^%1$s-(\d+)$'))::integer), 0) + 1
         from public.%2$I where company_id = $1$q$, v_prefix, tg_table_name)
    into v_next using new.company_id;
  new.code := v_prefix || '-' || lpad(v_next::text, 3, '0');
  return new;
end $$;

create trigger drivers_assign_code before insert on public.drivers
  for each row execute function app.assign_master_code('D');
create trigger vehicles_assign_code before insert on public.vehicles
  for each row execute function app.assign_master_code('V');
create trigger clients_assign_code before insert on public.clients
  for each row execute function app.assign_master_code('C');

-- ---------------------------------------------------------------
-- ドライバー：対応中の案件があるうちは休職・退職にできない。退職したら担当車両を外す。
-- ---------------------------------------------------------------
create or replace function app.drivers_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_active integer;
begin
  if app.is_bulk_load() then
    return new;
  end if;
  if new.company_id <> old.company_id or new.code <> old.code then
    raise exception '会社や管理コードは変更できません' using errcode = 'check_violation';
  end if;
  if new.status in ('leave', 'retired') and new.status is distinct from old.status then
    select count(*) into v_active from public.delivery_orders
     where driver_id = new.id and status in ('assigned', 'picked_up', 'in_transit');
    if v_active > 0 then
      raise exception '%さんには対応中の案件が%件あります。配車を変更してから休職・退職にしてください', new.name, v_active
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger drivers_before_update before update on public.drivers
  for each row execute function app.drivers_before_update();

-- ---------------------------------------------------------------
-- 車両：対応中の案件で使っているうちは整備中・廃車にできない。廃車にしたら担当を外す。
-- ---------------------------------------------------------------
create or replace function app.vehicles_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_active integer;
begin
  if app.is_bulk_load() then
    return new;
  end if;
  if new.company_id <> old.company_id or new.code <> old.code then
    raise exception '会社や管理コードは変更できません' using errcode = 'check_violation';
  end if;
  if new.status in ('maintenance', 'retired') and new.status is distinct from old.status then
    select count(*) into v_active from public.delivery_orders
     where vehicle_id = new.id and status in ('assigned', 'picked_up', 'in_transit');
    if v_active > 0 then
      raise exception '車両 % は対応中の案件%件で使われています。案件の車両を変更してから整備中・廃車にしてください',
        new.plate_number, v_active using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger vehicles_before_update before update on public.vehicles
  for each row execute function app.vehicles_before_update();

-- 退職・廃車になったら、現在の担当（end_on が null の行）を今日で終える
create or replace function app.masters_after_retire() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.is_bulk_load() then
    return null;
  end if;
  if new.status = 'retired' and old.status <> 'retired' then
    if tg_table_name = 'drivers' then
      update public.vehicle_assignments set end_on = greatest(start_on, app.today_jst())
       where driver_id = new.id and end_on is null;
    else
      update public.vehicle_assignments set end_on = greatest(start_on, app.today_jst())
       where vehicle_id = new.id and end_on is null;
    end if;
  end if;
  return null;
end $$;

create trigger drivers_after_retire after update of status on public.drivers
  for each row execute function app.masters_after_retire();
create trigger vehicles_after_retire after update of status on public.vehicles
  for each row execute function app.masters_after_retire();

-- ---------------------------------------------------------------
-- 担当車両：同じ会社のドライバー・車両どうしで、退職者・廃車は新しく担当にできない
-- ---------------------------------------------------------------
create or replace function app.vehicle_assignments_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_driver record;
  v_vehicle record;
begin
  if app.is_bulk_load() then
    return new;
  end if;
  select company_id, status, name into v_driver from public.drivers where id = new.driver_id;
  if not found or v_driver.company_id <> new.company_id then
    raise exception 'ドライバーが見つかりません' using errcode = 'foreign_key_violation';
  end if;
  select company_id, status, plate_number into v_vehicle from public.vehicles where id = new.vehicle_id;
  if not found or v_vehicle.company_id <> new.company_id then
    raise exception '車両が見つかりません' using errcode = 'foreign_key_violation';
  end if;
  if new.end_on is null and (tg_op = 'INSERT' or old.end_on is not null) then
    if v_driver.status = 'retired' then
      raise exception '%さんは退職済みのため車両を担当にできません', v_driver.name using errcode = 'check_violation';
    end if;
    if v_vehicle.status = 'retired' then
      raise exception '車両 % は廃車のため担当にできません', v_vehicle.plate_number using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger vehicle_assignments_before_write before insert or update on public.vehicle_assignments
  for each row execute function app.vehicle_assignments_before_write();

-- 経費：ドライバー・車両は同じ会社のものだけ
create or replace function app.expenses_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.is_bulk_load() then
    return new;
  end if;
  if new.driver_id is not null then
    perform 1 from public.drivers where id = new.driver_id and company_id = new.company_id;
    if not found then
      raise exception 'ドライバーが見つかりません' using errcode = 'foreign_key_violation';
    end if;
  end if;
  if new.vehicle_id is not null then
    perform 1 from public.vehicles where id = new.vehicle_id and company_id = new.company_id;
    if not found then
      raise exception '車両が見つかりません' using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end $$;

create trigger expenses_before_write before insert or update on public.expenses
  for each row execute function app.expenses_before_write();

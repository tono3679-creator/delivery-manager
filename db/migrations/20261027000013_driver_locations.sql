-- ドライバーの現在地（追加機能）
--
-- ドライバーがスマホで「位置情報の共有」をオンにしている間、ブラウザの位置情報を1分ごとに送る。
-- 保存するのはドライバーごとの最新の1件だけ（移動の履歴は残さない）。共有を止めると削除する。
--
-- 方針
--   * 書き込みは関数 driver_report_location() / driver_stop_location_sharing() だけ。
--     本人のドライバー ID・会社は DB が決める（他人の位置を送ったり、他社に書いたりできない）
--   * 見られるのは自社の管理者と本人だけ（RLS）
--   * 共有の開始・停止は操作履歴に残す（位置そのものは残さない）
--   * デモ・見本の会社（データが架空）は、共有していないドライバーを案件の予定から求めた模擬位置で表示する
--     （companies.simulate_locations。画面側で計算し、DB には保存しない）

alter table public.companies add column simulate_locations boolean not null default false;
update public.companies set simulate_locations = true where is_demo;

create table public.driver_locations (
  driver_id uuid primary key references public.drivers (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  -- 上限も付けて NaN・Infinity を弾く（PostgreSQL では NaN がどの数より大きい）
  accuracy_m real check (accuracy_m >= 0 and accuracy_m <= 100000),
  heading real check (heading >= 0 and heading < 360),
  speed_mps real check (speed_mps >= 0 and speed_mps <= 100),
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index driver_locations_company_idx on public.driver_locations (company_id);

alter table public.driver_locations enable row level security;
grant select on public.driver_locations to authenticated;

create policy driver_locations_admin_select on public.driver_locations for select to authenticated
  using (company_id = (select app.current_company_id()) and (select app.is_admin()));
create policy driver_locations_driver_select on public.driver_locations for select to authenticated
  using (driver_id = (select app.current_driver_id()));

-- ---------------------------------------------------------------
-- 位置の送信（ドライバー本人のみ）
--   送信間隔は画面側で1分ごと。15秒以内の再送は保存せず null を返す（連打・不正な連続送信で DB を埋めない）
--   端末の時刻（p_recorded_at）は10分より古いものを受け付けず、未来の時刻は今に丸める
-- ---------------------------------------------------------------
create or replace function public.driver_report_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy real,
  p_heading real,
  p_speed real,
  p_recorded_at timestamptz
) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := app.current_driver_id();
  v_company uuid := app.current_company_id();
  v_name text;
  v_inserted boolean;
  v_at timestamptz;
begin
  if v_driver is null or app.current_role() is distinct from 'driver' then
    raise exception '位置情報を送れるのはドライバーだけです' using errcode = '42501';
  end if;
  select d.name into v_name from public.drivers d
   where d.id = v_driver and d.company_id = v_company and d.status <> 'retired';
  if v_name is null then
    raise exception '在籍中のドライバーだけが位置情報を送れます' using errcode = '42501';
  end if;
  -- NaN は PostgreSQL ではどの数より大きいので、範囲の確認で弾かれる
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception '位置が正しくありません' using errcode = '22023';
  end if;
  if p_recorded_at is null or p_recorded_at < now() - interval '10 minutes' then
    raise exception '位置の取得時刻が古すぎます。もう一度お試しください' using errcode = '22023';
  end if;

  insert into public.driver_locations as l
         (driver_id, company_id, lat, lng, accuracy_m, heading, speed_mps, recorded_at, updated_at)
  values (v_driver, v_company, p_lat, p_lng, p_accuracy, p_heading, p_speed, least(p_recorded_at, now()), now())
  on conflict (driver_id) do update
     set company_id = excluded.company_id, lat = excluded.lat, lng = excluded.lng,
         accuracy_m = excluded.accuracy_m, heading = excluded.heading, speed_mps = excluded.speed_mps,
         recorded_at = excluded.recorded_at, updated_at = excluded.updated_at
   where l.updated_at <= now() - interval '15 seconds'
  returning (l.xmax = 0), l.updated_at into v_inserted, v_at;  -- xmax = 0 は新しく入れた行（＝共有の開始）

  if v_inserted then
    insert into public.audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
    values (v_company, auth.uid(), app.current_actor_name(), 'share_start', 'driver_location', v_driver,
            jsonb_build_object('driverName', v_name));
  end if;
  return v_at;
end $$;

-- 共有の停止：保存している位置を消す
create or replace function public.driver_stop_location_sharing() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := app.current_driver_id();
  v_company uuid := app.current_company_id();
  v_name text;
begin
  if v_driver is null or app.current_role() is distinct from 'driver' then
    raise exception 'この操作を行う権限がありません' using errcode = '42501';
  end if;
  delete from public.driver_locations where driver_id = v_driver;
  if not found then
    return false;
  end if;
  select d.name into v_name from public.drivers d where d.id = v_driver;
  insert into public.audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
  values (v_company, auth.uid(), app.current_actor_name(), 'share_stop', 'driver_location', v_driver,
          jsonb_build_object('driverName', v_name));
  return true;
end $$;

revoke all on function public.driver_report_location(double precision, double precision, real, real, real, timestamptz) from public, anon;
revoke all on function public.driver_stop_location_sharing() from public, anon;
grant execute on function
  public.driver_report_location(double precision, double precision, real, real, real, timestamptz),
  public.driver_stop_location_sharing()
  to authenticated;

-- ---------------------------------------------------------------
-- 定期実行（毎日）：期限切れのデモ会社に加えて、1日以上更新のない位置も消す
-- ---------------------------------------------------------------
create or replace function public.demo_cleanup() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_owners uuid[];
begin
  select array_agg(demo_owner) into v_owners
    from public.companies where is_demo and demo_expires_at < now();
  delete from public.companies where is_demo and demo_expires_at < now();
  get diagnostics v_count = row_count;
  if v_owners is not null then
    delete from auth.users where id = any (v_owners) and is_anonymous;
  end if;
  delete from public.driver_locations where updated_at < now() - interval '1 day';
  return v_count;
end $$;

-- Delivery Manager: 公開デモ
-- 訪問者ごとに専用のデモ会社を作る（作成はサーバー側でデータベース所有者として実行）。
-- デモ会社の利用者だけが、管理者とドライバーの画面を切り替えられる。

create or replace function public.demo_switch_role(p_role public.app_role, p_driver_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company public.companies;
  v_driver uuid := p_driver_id;
begin
  select c.* into v_company
    from public.companies c join public.profiles p on p.company_id = c.id
   where p.id = auth.uid();
  if v_company.id is null or not v_company.is_demo or v_company.demo_owner is distinct from auth.uid() then
    raise exception 'ロールの切り替えはデモ環境でのみ利用できます' using errcode = 'insufficient_privilege';
  end if;

  if p_role = 'driver' then
    if v_driver is null then
      -- 本日の担当件数が最も多いドライバーを選ぶ
      select o.driver_id into v_driver
        from public.delivery_orders o
       where o.company_id = v_company.id and o.driver_id is not null
         and o.delivery_at >= app.jst_start(app.today_jst())
         and o.delivery_at < app.jst_start(app.today_jst() + 1)
       group by o.driver_id order by count(*) desc limit 1;
    end if;
    perform 1 from public.drivers where id = v_driver and company_id = v_company.id;
    if not found then
      raise exception 'ドライバーが見つかりません' using errcode = 'no_data_found';
    end if;
    update public.profiles
       set role = 'driver', driver_id = v_driver,
           display_name = (select name from public.drivers where id = v_driver)
     where id = auth.uid();
  else
    update public.profiles set role = 'admin', driver_id = null, display_name = 'デモ管理者'
     where id = auth.uid();
  end if;
end $$;

grant execute on function public.demo_switch_role(public.app_role, uuid) to authenticated;

-- 期限切れのデモ会社を削除（定期実行）。匿名ユーザーも合わせて削除する。
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
  return v_count;
end $$;

revoke execute on function public.demo_cleanup() from public, authenticated, anon;

-- Delivery Manager: 荷主への請求（月末締め）
-- 売上（配送完了分の料金）を荷主ごと・月ごとに締めて、請求番号を振って記録する。
--   請求対象 = 締め済みの月（前月以前）に配送予定日がある、配送完了・未請求の案件
--   請求金額 = 対象案件の配送料金の合計（発行時の金額を保存する）
--   請求後   = 案件の料金・荷主・配送日は変更できない。変えるときは請求を取り消す
--   取り消し = 請求は消さずに「取消」として残し、含まれていた案件を未請求に戻す（請求番号は再利用しない）
--   追加請求 = 締めた後に同じ月の案件が完了したら、その分だけ追加の請求を発行できる
-- 月の区切りは売上と同じ「配送予定日（日本時間）」。

create table public.client_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  invoice_no text not null,
  period_start date not null,
  period_end date not null,
  order_count integer not null check (order_count > 0),
  amount numeric(12, 0) not null check (amount >= 0),
  issued_on date not null,
  notes text check (char_length(notes) <= 500),
  cancelled_at timestamptz,
  cancelled_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, invoice_no),
  constraint client_invoices_period check (period_end >= period_start)
);
create index client_invoices_client_idx on public.client_invoices (client_id, period_start desc);
create index client_invoices_company_idx on public.client_invoices (company_id, period_start desc);

create trigger client_invoices_touch_updated_at before update on public.client_invoices
  for each row execute function app.touch_updated_at();

-- 案件と請求のひも付け（既存の invoiced フラグは invoice_id と常に一致させる）
alter table public.delivery_orders
  add column invoice_id uuid references public.client_invoices (id) on delete set null;
create index delivery_orders_invoice_idx on public.delivery_orders (invoice_id) where invoice_id is not null;
create index delivery_orders_unbilled_idx on public.delivery_orders (client_id, delivery_at)
  where status = 'delivered' and invoice_id is null;

-- ---------------------------------------------------------------
-- 既存データの移行：invoiced = true の配送完了案件を、荷主×月の請求にまとめる
-- （デモデータを入れる前の環境では対象なし）
-- ---------------------------------------------------------------
with grouped as (
  select o.company_id, o.client_id, date_trunc('month', app.jst_date(o.delivery_at))::date as month_start,
         count(*)::integer as order_count, sum(o.fee) as amount
    from public.delivery_orders o
   where o.invoiced and o.status = 'delivered'
   group by 1, 2, 3
), numbered as (
  select g.*, row_number() over (partition by g.company_id, g.month_start order by c.code, c.id) as seq
    from grouped g join public.clients c on c.id = g.client_id
)
insert into public.client_invoices
  (company_id, client_id, invoice_no, period_start, period_end, order_count, amount, issued_on)
select company_id, client_id,
       'INV-' || to_char(month_start, 'YYYYMM') || '-' || lpad(seq::text, 3, '0'),
       month_start, (month_start + interval '1 month - 1 day')::date, order_count, amount,
       least((month_start + interval '1 month 4 days')::date, app.today_jst())
  from numbered;

update public.delivery_orders o
   set invoice_id = i.id
  from public.client_invoices i
 where o.invoiced and o.status = 'delivered'
   and i.company_id = o.company_id and i.client_id = o.client_id
   and app.jst_date(o.delivery_at) between i.period_start and i.period_end;

-- 配送完了でないのに invoiced = true の行は請求の根拠が無いため未請求に戻す
update public.delivery_orders set invoiced = false where invoiced and invoice_id is null;

alter table public.delivery_orders
  add constraint delivery_orders_invoiced_matches check (invoiced = (invoice_id is not null));

-- ---------------------------------------------------------------
-- 請求済み案件の保護
-- ---------------------------------------------------------------
create or replace function app.orders_invoice_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_inv record;
begin
  new.invoiced := new.invoice_id is not null;
  if app.is_bulk_load() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.invoice_id is not null then
      raise exception '新しい案件は請求済みにできません' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- 請求済みのまま：請求金額の根拠になる項目は変えられない
  if old.invoice_id is not null and new.invoice_id is not distinct from old.invoice_id then
    if new.fee <> old.fee or new.client_id <> old.client_id or new.delivery_at <> old.delivery_at then
      raise exception '請求済みの案件は料金・荷主・配送日を変更できません（請求を取り消してから変更してください）'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- 請求から外す：請求を取り消したとき（cancel_client_invoice）か、請求が無くなったときだけ
  if old.invoice_id is not null
     and exists (select 1 from public.client_invoices where id = old.invoice_id and cancelled_at is null) then
    raise exception '請求済みの案件は個別に請求から外せません。請求を取り消してください'
      using errcode = 'check_violation';
  end if;

  -- 請求に含める：請求の発行処理（issue_client_invoice）の中だけ
  if new.invoice_id is not null then
    if coalesce(current_setting('app.invoice_issue', true), '') <> new.invoice_id::text then
      raise exception '請求は荷主の画面の「請求済みにする」から発行してください'
        using errcode = 'insufficient_privilege';
    end if;
    select company_id, client_id, period_start, period_end, cancelled_at into v_inv
      from public.client_invoices where id = new.invoice_id;
    if not found or v_inv.cancelled_at is not null
       or v_inv.company_id <> new.company_id or v_inv.client_id <> new.client_id then
      raise exception '請求の荷主と案件の荷主が一致しません' using errcode = 'check_violation';
    end if;
    if new.status <> 'delivered' then
      raise exception '配送完了の案件だけ請求できます' using errcode = 'check_violation';
    end if;
    if app.jst_date(new.delivery_at) not between v_inv.period_start and v_inv.period_end then
      raise exception '請求の対象期間外の案件です' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger delivery_orders_invoice_guard
  before insert or update on public.delivery_orders
  for each row execute function app.orders_invoice_guard();

-- 発行した請求の金額・期間・番号は変えられない（変えるときは取り消して発行し直す）。取り消しは元に戻せない
create or replace function app.client_invoices_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.is_bulk_load() then
    return new;
  end if;
  if (new.company_id, new.client_id, new.invoice_no, new.period_start, new.period_end,
      new.order_count, new.amount, new.issued_on, new.created_by)
     is distinct from
     (old.company_id, old.client_id, old.invoice_no, old.period_start, old.period_end,
      old.order_count, old.amount, old.issued_on, old.created_by) then
    raise exception '発行済みの請求は変更できません。取り消してから発行し直してください'
      using errcode = 'check_violation';
  end if;
  if old.cancelled_at is not null
     and (new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by) then
    raise exception '取り消した請求は元に戻せません。必要なら新しく発行してください' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- 請求は削除しない（取り消しとして残す）。会社ごと削除するとき（デモの片付け）だけ消える
create or replace function app.client_invoices_before_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.is_bulk_load() or not exists (select 1 from public.companies where id = old.company_id) then
    return old;
  end if;
  raise exception '請求は削除できません。取り消してください' using errcode = 'check_violation';
end $$;

create trigger client_invoices_before_delete before delete on public.client_invoices
  for each row execute function app.client_invoices_before_delete();

create trigger client_invoices_before_update before update on public.client_invoices
  for each row execute function app.client_invoices_before_update();

-- ---------------------------------------------------------------
-- 請求の発行：荷主 × 締め済みの月の、配送完了・未請求の案件をまとめて請求済みにする
--   請求番号は会社ごと・対象月ごとの連番（INV-202609-001）
-- ---------------------------------------------------------------
create or replace function public.issue_client_invoice(p_client_id uuid, p_month date, p_notes text default null)
returns public.client_invoices
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_count integer;
  v_amount numeric;
  v_linked integer;
  v_seq integer;
  v_inv public.client_invoices;
begin
  if v_company is null or not app.is_admin() then
    raise exception '管理者のみ操作できます' using errcode = 'insufficient_privilege';
  end if;
  if p_client_id is null or p_month is null then
    raise exception '荷主と対象月を指定してください' using errcode = 'invalid_parameter_value';
  end if;
  if v_start >= date_trunc('month', app.today_jst())::date then
    raise exception '請求できるのは締め済みの月（前月以前）だけです' using errcode = 'check_violation';
  end if;

  -- 同じ荷主の発行・取り消しを順番に処理する（二重発行を防ぐ）
  perform 1 from public.clients where id = p_client_id and company_id = v_company for update;
  if not found then
    raise exception '荷主が見つかりません' using errcode = 'foreign_key_violation';
  end if;

  select count(*), coalesce(sum(t.fee), 0) into v_count, v_amount
    from (select o.fee from public.delivery_orders o
           where o.company_id = v_company and o.client_id = p_client_id
             and o.status = 'delivered' and o.invoice_id is null
             and o.delivery_at >= app.jst_start(v_start) and o.delivery_at < app.jst_start(v_end + 1)
           for update) t;
  if v_count = 0 then
    raise exception '請求対象の案件がありません' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('client_invoices:' || v_company::text));
  select coalesce(max((substring(invoice_no from '^INV-\d{6}-(\d+)$'))::integer), 0) + 1 into v_seq
    from public.client_invoices
   where company_id = v_company and invoice_no like 'INV-' || to_char(v_start, 'YYYYMM') || '-%';

  insert into public.client_invoices
    (company_id, client_id, invoice_no, period_start, period_end, order_count, amount, issued_on, notes, created_by)
  values
    (v_company, p_client_id, 'INV-' || to_char(v_start, 'YYYYMM') || '-' || lpad(v_seq::text, 3, '0'),
     v_start, v_end, v_count, v_amount, app.today_jst(), nullif(btrim(p_notes), ''), auth.uid())
  returning * into v_inv;

  perform set_config('app.invoice_issue', v_inv.id::text, true);
  update public.delivery_orders o set invoice_id = v_inv.id
   where o.company_id = v_company and o.client_id = p_client_id
     and o.status = 'delivered' and o.invoice_id is null
     and o.delivery_at >= app.jst_start(v_start) and o.delivery_at < app.jst_start(v_end + 1);
  get diagnostics v_linked = row_count;
  perform set_config('app.invoice_issue', '', true);

  if v_linked <> v_count then
    raise exception '案件が更新されています。画面を更新してから発行してください' using errcode = 'serialization_failure';
  end if;
  return v_inv;
end $$;

-- ---------------------------------------------------------------
-- 請求の取り消し：請求は「取消」として残し、含まれていた案件を未請求に戻す
-- ---------------------------------------------------------------
create or replace function public.cancel_client_invoice(p_invoice_id uuid)
returns public.client_invoices
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
  v_inv public.client_invoices;
begin
  if v_company is null or not app.is_admin() then
    raise exception '管理者のみ操作できます' using errcode = 'insufficient_privilege';
  end if;
  select * into v_inv from public.client_invoices where id = p_invoice_id and company_id = v_company;
  if not found then
    raise exception '請求が見つかりません。画面を更新してください' using errcode = 'no_data_found';
  end if;
  perform 1 from public.clients where id = v_inv.client_id for update;
  select * into v_inv from public.client_invoices where id = p_invoice_id for update;
  if v_inv.cancelled_at is not null then
    raise exception '請求 % は既に取り消されています。画面を更新してください', v_inv.invoice_no
      using errcode = 'serialization_failure';
  end if;

  update public.client_invoices set cancelled_at = now(), cancelled_by = auth.uid()
   where id = p_invoice_id returning * into v_inv;
  update public.delivery_orders set invoice_id = null where invoice_id = p_invoice_id;
  return v_inv;
end $$;

-- ---------------------------------------------------------------
-- 権限：参照とメモの更新だけ。発行・取り消しは上の関数経由のみ
-- （Supabase の既定権限で付く INSERT/UPDATE/DELETE を先に外す）
-- ---------------------------------------------------------------
alter table public.client_invoices enable row level security;
revoke all on public.client_invoices from public, anon, authenticated;
grant select on public.client_invoices to authenticated;
grant update (notes) on public.client_invoices to authenticated;

create policy client_invoices_admin_all on public.client_invoices for all to authenticated
  using (company_id = (select app.current_company_id()) and (select app.is_admin()))
  with check (company_id = (select app.current_company_id()) and (select app.is_admin()));

revoke all on function public.issue_client_invoice(uuid, date, text) from public, anon;
revoke all on function public.cancel_client_invoice(uuid) from public, anon;
grant execute on function public.issue_client_invoice(uuid, date, text) to authenticated;
grant execute on function public.cancel_client_invoice(uuid) to authenticated;

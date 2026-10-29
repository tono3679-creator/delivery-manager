-- ログインをアプリの中で行う（Supabase Auth を使わない）
--
-- * auth.sessions：ログイン中の端末ごとのセッション。Cookie にはランダムな値を入れ、DB にはその SHA-256 だけを保存する
--   （DB の中身が漏れても、そのまま Cookie として使えない）。ログアウトで削除、期限を過ぎたものは毎日の定期処理で削除
-- * auth.rate_limits：ログインの失敗・デモの作成を数えて、短時間の繰り返しを断る（総当たり・大量作成の対策）
-- * どちらもアプリのサーバー（DB の所有者の接続）だけが使う。ログイン中の利用者のロール（authenticated）からは読めない

create table if not exists auth.sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on auth.sessions (user_id);
create index if not exists sessions_expires_idx on auth.sessions (expires_at);

create table if not exists auth.rate_limits (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limits_bucket_idx on auth.rate_limits (bucket, created_at);

revoke all on auth.sessions, auth.rate_limits from public, anon, authenticated;

-- メールアドレスは大文字・小文字を区別せずに探す
create unique index if not exists users_email_lower_idx on auth.users (lower(email)) where email is not null;

-- ---------------------------------------------------------------
-- 定期実行（毎日）：期限切れのデモ会社と匿名ユーザー、更新のない位置に加えて、
-- 期限切れのセッションと1日より前の回数の記録も消す
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
  -- デモ会社を作る前に止まった匿名ユーザー（会社のないもの）も片付ける
  delete from auth.users u
   where u.is_anonymous and u.created_at < now() - interval '1 day'
     and not exists (select 1 from public.profiles p where p.id = u.id);
  delete from public.driver_locations where updated_at < now() - interval '1 day';
  delete from auth.sessions where expires_at < now();
  delete from auth.rate_limits where created_at < now() - interval '1 day';
  return v_count;
end $$;
revoke all on function public.demo_cleanup() from public, anon, authenticated;

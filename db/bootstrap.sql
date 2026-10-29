-- マイグレーションの前に1回だけ適用する土台（何度実行しても同じ結果になる）。
-- 公開環境（Neon）・ローカル・CI の PostgreSQL で共通に使う。
--
--   * ログイン中の利用者の権限で SQL を実行するためのロール（authenticated）と、未ログインのロール（anon）
--   * 利用者の表（auth.users）と、トランザクションに設定した利用者 ID を読む auth.uid()
--
-- RLS の考え方は Supabase と同じ形にしている（アプリはトランザクションごとにロールを authenticated に切り替え、
-- request.jwt.claims に利用者 ID を入れる。src/lib/db/rls.ts）。
-- 新しく作る表・関数には既定で全権限が付く状態から始め、マイグレーション（0012）で必要な権限だけに締め直す。
-- その結果は tests/db/privileges.test.ts で確かめている。
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
end $$;
-- 接続するユーザー（DB の所有者）が、トランザクションの中で authenticated に切り替えられるようにする
grant anon, authenticated to current_user;

grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  is_anonymous boolean not null default false,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on auth.users from public, anon, authenticated;

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;

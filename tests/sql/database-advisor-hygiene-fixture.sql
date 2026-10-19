-- Disposable PostgreSQL fixture for database advisor hygiene migration testing.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema private;
create schema auth;
create or replace function auth.uid()
returns uuid language sql stable as $$ select null::uuid $$;

create table private.kingshot_developer_account_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null
);
alter table private.kingshot_developer_account_sessions enable row level security;

create table public.profiles (
  id uuid primary key,
  display_name text
);
alter table public.profiles enable row level security;

create policy "Public profiles are readable"
  on public.profiles for select to anon, authenticated using (true);
create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid() as uid) = id);

create table public.mightpulse_api_key_budget (id bigint primary key);
alter table public.mightpulse_api_key_budget enable row level security;
create table public.mightpulse_api_request_budget (id bigint primary key);
alter table public.mightpulse_api_request_budget enable row level security;

-- Per-Discord-server alert destinations and durable announcement confirmations.
create table if not exists public.discord_guild_settings (
 guild_id text primary key check (guild_id ~ '^[0-9]{5,25}$'),
 gift_code_alert_channel_id text check (gift_code_alert_channel_id is null or gift_code_alert_channel_id ~ '^[0-9]{5,25}$'),
 updated_by_discord_id text,
 updated_at timestamptz not null default now()
);
create table if not exists public.discord_pending_announcements (
 id bigint generated always as identity primary key,
 guild_id text not null check (guild_id ~ '^[0-9]{5,25}$'),
 channel_id text not null check (channel_id ~ '^[0-9]{5,25}$'),
 title text not null check (length(title) between 1 and 256),
 message text not null check (length(message) between 1 and 3500),
 created_by_discord_id text not null check (created_by_discord_id ~ '^[0-9]{5,25}$'),
 status text not null default 'pending' check (status in ('pending','sent','cancelled')),
 discord_message_id text,
 expires_at timestamptz not null,
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists discord_pending_announcements_expiry_idx on public.discord_pending_announcements(status,expires_at);
alter table public.discord_guild_settings enable row level security;
alter table public.discord_pending_announcements enable row level security;
revoke all on public.discord_guild_settings,public.discord_pending_announcements from public,anon,authenticated;
grant select,insert,update,delete on public.discord_guild_settings,public.discord_pending_announcements to service_role;
grant usage,select on sequence public.discord_pending_announcements_id_seq to service_role;

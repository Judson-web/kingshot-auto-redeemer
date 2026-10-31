-- Durable website-admin announcement scheduling.
create table if not exists public.discord_scheduled_announcements (
  id uuid primary key default gen_random_uuid(),
  target text not null,
  delivery_mode text not null default 'both' check (delivery_mode in ('discord','website','both')),
  title text not null default '',
  message text not null check (length(message) between 1 and 4096),
  footer text not null default '',
  color text not null default '#5865F2',
  image_url text,\n  attachment_path text check (attachment_path is null or length(attachment_path)<=300),
  guild_id text,
  channel_id text,
  role_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(role_ids)='array' and jsonb_array_length(role_ids)<=25),
  starts_at timestamptz not null,
  ends_at timestamptz,
  interval_seconds integer check (interval_seconds is null or interval_seconds between 60 and 31536000),
  timezone text not null default 'UTC',
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','paused','completed','cancelled','failed')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists discord_scheduled_announcements_due_idx
  on public.discord_scheduled_announcements(status,next_run_at) where status='scheduled';
alter table public.discord_scheduled_announcements enable row level security;
revoke all on public.discord_scheduled_announcements from public,anon,authenticated;
grant select,insert,update,delete on public.discord_scheduled_announcements to service_role;

create or replace function public.claim_due_discord_announcements(p_limit integer default 10)
returns setof public.discord_scheduled_announcements
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select id from public.discord_scheduled_announcements
    where status='scheduled' and next_run_at <= now()
      and (lease_until is null or lease_until < now())
      and (ends_at is null or ends_at >= now())
    order by next_run_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),25))
  )
  update public.discord_scheduled_announcements a
  set lease_token=gen_random_uuid(), lease_until=now()+interval '4 minutes',
      attempts=attempts+1, updated_at=now()
  from due where a.id=due.id
  returning a.*;
end;
$$;
revoke all on function public.claim_due_discord_announcements(integer) from public,anon,authenticated;
grant execute on function public.claim_due_discord_announcements(integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('announcement-attachments','announcement-attachments',false,8388608,
  array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public=false,file_size_limit=8388608,
  allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "service role manages announcement attachments" on storage.objects;
create policy "service role manages announcement attachments"
on storage.objects for all to service_role
using (bucket_id='announcement-attachments')
with check (bucket_id='announcement-attachments');

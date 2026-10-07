begin;

create schema if not exists private;

create table if not exists private.custom_message_scheduler_secret (
  id boolean primary key default true check (id),
  secret text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.kingshot_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  target text not null,
  target_name text,
  message text not null check (char_length(trim(message)) between 1 and 4096),
  title text not null default '' check (char_length(title) <= 256),
  footer text not null default 'Kingshot Auto Redeem' check (char_length(footer) <= 2048),
  color text not null default '#5865F2',
  image_url text not null default '' check (char_length(image_url) <= 2048),
  mentions jsonb not null default '[]'::jsonb check (jsonb_typeof(mentions) = 'array'),
  scheduled_for timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED','CANCELLED')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_attempt_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kingshot_scheduled_messages_due_idx
  on public.kingshot_scheduled_messages(status, scheduled_for);

alter table public.kingshot_scheduled_messages enable row level security;

create or replace function public.claim_due_custom_messages(p_limit integer default 10)
returns setof public.kingshot_scheduled_messages
language sql
security definer
set search_path = public
as $$
  with due as (
    select id
    from public.kingshot_scheduled_messages
    where status = 'PENDING'
      and scheduled_for <= now()
    order by scheduled_for, id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.kingshot_scheduled_messages m
  set status = 'SENDING',
      attempts = m.attempts + 1,
      claimed_at = now(),
      last_attempt_at = now(),
      updated_at = now()
  from due
  where m.id = due.id
  returning m.*;
$$;

revoke all on function public.claim_due_custom_messages(integer) from public, anon, authenticated;
grant execute on function public.claim_due_custom_messages(integer) to service_role;
revoke all on table public.kingshot_scheduled_messages from anon, authenticated;

do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'kingshot-custom-message-scheduler') then
    perform cron.schedule(
      'kingshot-custom-message-scheduler',
      '* * * * *',
      $job$
        select net.http_post(
          url := 'https://kingshot-autoredeemer.vercel.app/api/custom-message-scheduler',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select secret from private.custom_message_scheduler_secret where id = true)
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 8000
        );
      $job$
    );
  end if;
end $do$;

commit;

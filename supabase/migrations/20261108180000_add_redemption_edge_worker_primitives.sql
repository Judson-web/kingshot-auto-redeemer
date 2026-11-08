-- Independent Supabase Edge redemption worker primitives.
-- Apply to the secondary execution project only.
-- The existing claim RPC remains the single atomic SKIP LOCKED queue-claim path.

create or replace function public.redemption_check_worker_secret(p_secret text)
returns boolean
language sql
security definer
set search_path to 'pg_catalog','vault'
as $$
  select coalesce(p_secret,'') <> ''
     and p_secret = (
       select decrypted_secret
       from vault.decrypted_secrets
       where name='secondary_redemption_sync_secret'
       order by created_at desc
       limit 1
     );
$$;
revoke all on function public.redemption_check_worker_secret(text) from public, anon, authenticated;
grant execute on function public.redemption_check_worker_secret(text) to service_role;

create or replace function public.redemption_defer_claim(
  p_queue_id bigint,
  p_worker text,
  p_seconds integer default 30
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','redemption'
as $$
declare
  v_count integer;
begin
  update redemption.queue
     set state='pending',
         attempts=greatest(0,attempts-1),
         available_at=greatest(
           available_at,
           now()+make_interval(secs=>greatest(5,least(coalesce(p_seconds,30),3600)))
         ),
         lease_owner=null,
         lease_until=null,
         updated_at=now()
   where id=p_queue_id
     and state='leased'
     and lease_owner=p_worker;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function public.redemption_defer_claim(bigint,text,integer) from public, anon, authenticated;
grant execute on function public.redemption_defer_claim(bigint,text,integer) to service_role;

create or replace function public.redemption_finalize_attempt(
  p_queue_id bigint,
  p_worker text,
  p_state text,
  p_status text,
  p_err_code integer,
  p_message text,
  p_result jsonb,
  p_journal_state text default 'recorded'
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','redemption'
as $$
declare
  v_q redemption.queue%rowtype;
begin
  if p_state not in ('completed','uncertain','dead') then
    raise exception 'Invalid final state';
  end if;
  if p_journal_state not in ('recorded','uncertain') then
    raise exception 'Invalid journal state';
  end if;

  update redemption.queue
     set state=p_state,
         last_status=left(coalesce(p_status,'UNKNOWN'),64),
         last_error=case
           when p_status in ('SUCCESS','RECEIVED','SAME TYPE EXCHANGE') then null
           else left(coalesce(p_message,''),500)
         end,
         result=coalesce(p_result,'{}'::jsonb),
         lease_owner=null,
         lease_until=null,
         updated_at=now()
   where id=p_queue_id
     and state='leased'
     and lease_owner=p_worker
  returning * into v_q;

  if not found then
    return false;
  end if;

  insert into redemption.journal(
    player_id,gift_code,attempt_no,state,upstream_status,err_code,message,finished_at
  )
  values(
    v_q.player_id,v_q.gift_code,v_q.attempts,p_journal_state,
    left(coalesce(p_status,'UNKNOWN'),64),p_err_code,
    left(coalesce(p_message,''),240),now()
  )
  on conflict(player_id,gift_code,attempt_no) do update
    set state=excluded.state,
        upstream_status=excluded.upstream_status,
        err_code=excluded.err_code,
        message=excluded.message,
        finished_at=excluded.finished_at;

  return true;
end;
$$;
revoke all on function public.redemption_finalize_attempt(bigint,text,text,text,integer,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.redemption_finalize_attempt(bigint,text,text,text,integer,text,jsonb,text)
  to service_role;

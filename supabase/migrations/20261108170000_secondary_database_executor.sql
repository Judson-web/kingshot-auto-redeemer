-- Secondary Supabase database-native Kingshot executor.
-- Cloudflare coordinates and reconciles. Neon supplies per-item reservation times.
alter table redemption.queue add column if not exists reconciled_at timestamptz;
create index if not exists redemption_queue_reconcile_idx on redemption.queue(state,reconciled_at,id);

create or replace function public.redemption_enqueue_batch(p_items jsonb)
returns integer language plpgsql security definer
set search_path=pg_catalog,public,redemption as $$
declare v_count integer;
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then
  raise exception 'p_items must be an array with at most 100 items';
 end if;
 insert into redemption.queue(player_id,gift_code,kingdom_id,available_at)
 select trim(x->>'player_id'),upper(trim(x->>'gift_code')),nullif(trim(x->>'kingdom_id'),''),
        coalesce(nullif(x->>'available_at','')::timestamptz,now())
 from jsonb_array_elements(p_items) x
 where coalesce(trim(x->>'player_id'),'')<>'' and coalesce(trim(x->>'gift_code'),'')<>''
 on conflict(player_id,gift_code) do update
  set kingdom_id=excluded.kingdom_id,
      available_at=greatest(redemption.queue.available_at,excluded.available_at),
      updated_at=now()
  where redemption.queue.state in ('pending','dead');
 get diagnostics v_count=row_count;
 return v_count;
end $$;

create or replace function public.redemption_execute_batch(p_limit integer default 100)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,redemption,extensions as $$
declare
 v_worker text:='supabase-db-'||gen_random_uuid()::text;
 v_item redemption.queue%rowtype;
 v_http record;
 v_body text;
 v_payload text;
 v_sign text;
 v_json jsonb;
 v_status text;
 v_err integer;
 v_done integer:=0;
 v_uncertain integer:=0;
 v_failed integer:=0;
 v_fid text;
 v_code text;
 v_kid text;
 v_epoch text;
 v_wait numeric;
begin
 if p_limit is null or p_limit<1 then raise exception 'p_limit must be between 1 and 100'; end if;
 for v_item in select * from public.redemption_claim_batch(v_worker,0,1,least(p_limit,100),600)
 loop
  v_fid:=regexp_replace(v_item.player_id,'[^0-9]','','g');
  v_code:=upper(trim(v_item.gift_code));
  v_kid:=regexp_replace(coalesce(v_item.kingdom_id,''),'[^0-9]','','g');
  v_wait:=extract(epoch from (v_item.available_at-clock_timestamp()));
  if v_wait>0 then perform pg_sleep(least(v_wait,600)); end if;
  v_epoch:=floor(extract(epoch from clock_timestamp()))::bigint::text;
  if v_fid !~ '^[0-9]{5,20}$' or v_kid !~ '^[0-9]{1,10}$' or v_code !~ '^[A-Za-z0-9_-]{6,32}$' then
   update redemption.queue set state='dead',last_status='INVALID_INPUT',
    last_error='Invalid player, kingdom, or gift-code format',lease_owner=null,lease_until=null,updated_at=now()
    where id=v_item.id and lease_owner=v_worker;
   v_failed:=v_failed+1;
   continue;
  end if;
  -- Same sorted signing payload and public salt as internal/kingshot/redeem.ts.
  v_payload:='cdk='||v_code||'&fid='||v_fid||'&kid='||v_kid||'&time='||v_epoch;
  v_sign:=md5(v_payload||'mN4!pQs6JrYwV9');
  v_body:='fid='||v_fid||'&cdk='||v_code||'&kid='||v_kid||'&time='||v_epoch||'&sign='||v_sign;
  begin
   select * into v_http from extensions.http(ROW(
    'POST'::extensions.http_method,
    'https://kingshot-giftcode.centurygame.com/api/gift_code',
    ARRAY[
     extensions.http_header('accept','application/json, text/plain, */*'),
     extensions.http_header('accept-language','en-US,en;q=0.9'),
     extensions.http_header('origin','https://kingshot-giftcode.centurygame.com'),
     extensions.http_header('referer','https://kingshot-giftcode.centurygame.com/'),
     extensions.http_header('user-agent','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
    ]::extensions.http_header[],
    'application/x-www-form-urlencoded',v_body
   )::extensions.http_request);
   v_json:=null;
   begin v_json:=v_http.content::jsonb; exception when others then v_json:=null; end;
   v_status:=upper(regexp_replace(trim(coalesce(v_json->>'msg','UNKNOWN ERROR')),'[._-]+',' ','g'));
   v_err:=case when coalesce(v_json->>'err_code','') ~ '^[0-9]+$' then (v_json->>'err_code')::integer else null end;
   if v_err=40014 or v_status in ('CDK NOT FOUND','GIFT CODE NOT FOUND','CODE NOT FOUND','INVALID CODE','INVALID GIFT CODE') then v_status:='CDK_NOT_FOUND'; end if;
   if v_err=40005 and v_status='USED' then v_status:='USAGE_LIMIT'; end if;
   if v_err=40019 or v_status='TOO FREQUENT' or v_http.status=429 then v_status:='TIMEOUT_RETRY'; end if;
   if v_err=40008 and v_status like '%RECEIVED%' then v_status:='RECEIVED'; end if;
   if v_err=40011 and v_status like '%SAME TYPE%' then v_status:='SAME TYPE EXCHANGE'; end if;
   if v_err=40007 or v_status='TIME ERROR' then v_status:='TIME_ERROR'; end if;
   if v_status in ('NOT LOGIN','LOGIN EXPIRED MID PROCESS') then v_status:='LOGIN_EXPIRED_MID_PROCESS'; end if;
   if v_status='ROLE NOT EXIST' or (v_err=40001 and v_status like '%NOT EXIST%') then v_status:='ROLE_NOT_EXIST'; end if;
   if v_status='STATE MISMATCH' then v_status:='STATE_MISMATCH'; end if;
   if v_status='SIGN ERROR' then v_status:='SIGN_ERROR'; end if;
   if v_status='TIMEOUT_RETRY' then
    update redemption.queue set state='completed',last_status=v_status,last_error='Upstream asked for retry',
     result=jsonb_build_object('status',v_status,'err_code',v_err,'message',coalesce(v_json->>'msg','Too frequent'),'http_status',v_http.status),
     lease_owner=null,lease_until=null,updated_at=now() where id=v_item.id and lease_owner=v_worker;
    insert into redemption.journal(player_id,gift_code,attempt_no,state,upstream_status,err_code,message,finished_at)
     values(v_item.player_id,v_item.gift_code,v_item.attempts,'recorded',v_status,v_err,'Upstream asked for retry',now())
     on conflict(player_id,gift_code,attempt_no) do update set state='recorded',upstream_status=excluded.upstream_status,err_code=excluded.err_code,message=excluded.message,finished_at=now();
    v_done:=v_done+1;
   elsif v_http.status<200 or v_http.status>=300 or v_json is null or v_status not in
    ('SUCCESS','RECEIVED','SAME TYPE EXCHANGE','TIME_ERROR','CDK_NOT_FOUND','USAGE_LIMIT','ROLE_NOT_EXIST','STATE_MISMATCH','SIGN_ERROR','LOGIN_EXPIRED_MID_PROCESS') then
    update redemption.queue set state='uncertain',last_status='UPSTREAM_UNCERTAIN',last_error='Unclassified upstream response; outcome requires reconciliation',
     result=jsonb_build_object('http_status',v_http.status,'response_text',left(coalesce(v_http.content,''),500)),
     lease_owner=null,lease_until=null,updated_at=now() where id=v_item.id and lease_owner=v_worker;
    insert into redemption.journal(player_id,gift_code,attempt_no,state,upstream_status,message,finished_at)
     values(v_item.player_id,v_item.gift_code,v_item.attempts,'uncertain','UPSTREAM_UNCERTAIN','Unclassified upstream response; manual reconciliation required',now())
     on conflict(player_id,gift_code,attempt_no) do update set state='uncertain',upstream_status=excluded.upstream_status,message=excluded.message,finished_at=now();
    v_uncertain:=v_uncertain+1;
   else
    update redemption.queue set state='completed',last_status=left(v_status,64),
     last_error=case when v_status in ('SUCCESS','RECEIVED','SAME TYPE EXCHANGE') then null else left(coalesce(v_json->>'msg','Upstream rejected request'),500) end,
     result=jsonb_build_object('status',v_status,'err_code',v_err,'message',coalesce(v_json->>'msg',''),'http_status',v_http.status,'response',coalesce(v_json,'{}'::jsonb)),
     lease_owner=null,lease_until=null,updated_at=now() where id=v_item.id and lease_owner=v_worker;
    insert into redemption.journal(player_id,gift_code,attempt_no,state,upstream_status,err_code,message,finished_at)
     values(v_item.player_id,v_item.gift_code,v_item.attempts,'recorded',v_status,v_err,left(coalesce(v_json->>'msg',''),240),now())
     on conflict(player_id,gift_code,attempt_no) do update set state='recorded',upstream_status=excluded.upstream_status,err_code=excluded.err_code,message=excluded.message,finished_at=now();
    v_done:=v_done+1;
   end if;
  exception when others then
   update redemption.queue set state='uncertain',last_status='EXECUTOR_EXCEPTION',last_error=left(sqlerrm,500),
    result=jsonb_build_object('error','Executor exception; outcome may be unknown'),
    lease_owner=null,lease_until=null,updated_at=now() where id=v_item.id and lease_owner=v_worker;
   insert into redemption.journal(player_id,gift_code,attempt_no,state,upstream_status,message,finished_at)
    values(v_item.player_id,v_item.gift_code,v_item.attempts,'uncertain','EXECUTOR_EXCEPTION','Executor exception; manual reconciliation required',now())
    on conflict(player_id,gift_code,attempt_no) do update set state='uncertain',upstream_status=excluded.upstream_status,message=excluded.message,finished_at=now();
   v_uncertain:=v_uncertain+1;
  end;
  perform pg_sleep(0.1);
 end loop;
 return jsonb_build_object('claimed',v_done+v_uncertain+v_failed,'completed',v_done,'uncertain',v_uncertain,'invalid',v_failed,'batch_limit',least(p_limit,100));
end $$;

create or replace function public.redemption_get_reconciliation_batch(p_limit integer default 100)
returns table(id bigint,player_id text,gift_code text,kingdom_id text,state text,last_status text,last_error text,result jsonb,attempts integer)
language sql security definer set search_path=pg_catalog,public,redemption as $$
 select q.id,q.player_id,q.gift_code,q.kingdom_id,q.state,q.last_status,q.last_error,q.result,q.attempts
 from redemption.queue q where q.state in ('completed','uncertain') and q.reconciled_at is null
 order by q.id limit greatest(1,least(coalesce(p_limit,100),100))
$$;
create or replace function public.redemption_mark_reconciled(p_id bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,redemption as $$
begin
 update redemption.queue set reconciled_at=now(),updated_at=now() where id=p_id and state in ('completed','uncertain') and reconciled_at is null;
 return found;
end $$;
create or replace function public.redemption_get_item_state(p_player_id text,p_gift_code text)
returns table(id bigint,state text,last_status text,result jsonb)
language sql security definer set search_path=pg_catalog,public,redemption as $$
 select q.id,q.state,q.last_status,q.result from redemption.queue q
 where q.player_id=p_player_id and upper(q.gift_code)=upper(p_gift_code) order by q.id desc limit 1
$$;

revoke all on function public.redemption_enqueue_batch(jsonb) from public,anon,authenticated;
revoke all on function public.redemption_execute_batch(integer) from public,anon,authenticated;
revoke all on function public.redemption_get_reconciliation_batch(integer) from public,anon,authenticated;
revoke all on function public.redemption_mark_reconciled(bigint) from public,anon,authenticated;
revoke all on function public.redemption_get_item_state(text,text) from public,anon,authenticated;
grant execute on function public.redemption_enqueue_batch(jsonb) to service_role;
grant execute on function public.redemption_execute_batch(integer) to service_role;
grant execute on function public.redemption_get_reconciliation_batch(integer) to service_role;
grant execute on function public.redemption_mark_reconciled(bigint) to service_role;
grant execute on function public.redemption_get_item_state(text,text) to service_role;

do $$
begin
 if not exists(select 1 from cron.job where jobname='secondary-kingshot-redemption-executor') then
  perform cron.schedule('secondary-kingshot-redemption-executor','* * * * *','select public.redemption_execute_batch(100);');
 end if;
end $$;

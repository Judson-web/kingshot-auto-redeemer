-- Secondary Supabase database-native Kingshot executor.
-- Cloudflare only hands off and reconciles; it never calls the upstream redemption API.
alter table redemption.queue add column if not exists reconciled_at timestamptz;
create index if not exists redemption_queue_reconcile_idx on redemption.queue(state,reconciled_at,id);

create or replace function public.redemption_execute_batch(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,redemption,extensions
as $$
declare
 v_worker text := 'supabase-db-' || gen_random_uuid()::text;
 v_item redemption.queue%rowtype;
 v_http record;
 v_payload text;
 v_sign text;
 v_json jsonb;
 v_status text;
 v_err integer;
 v_done integer := 0;
 v_uncertain integer := 0;
 v_failed integer := 0;
 v_fid text;
 v_code text;
 v_kid text;
 v_epoch text;
begin
 if p_limit is null or p_limit < 1 then raise exception 'p_limit must be between 1 and 100'; end if;
 for v_item in select * from public.redemption_claim_batch(v_worker,0,1,least(p_limit,100),180)
 loop
  v_fid := regexp_replace(v_item.player_id,'[^0-9]','','g');
  v_code := upper(trim(v_item.gift_code));
  v_kid := regexp_replace(coalesce(v_item.kingdom_id,''),'[^0-9]','','g');
  v_epoch := floor(extract(epoch from clock_timestamp()))::bigint::text;
  if v_fid !~ '^[0-9]{5,20}$' or v_kid !~ '^[0-9]{1,10}$' or v_code !~ '^[A-Za-z0-9_-]{6,32}$' then
   update redemption.queue set state='dead',last_status='INVALID_INPUT',last_error='Invalid player, kingdom, or gift-code format',lease_owner=null,lease_until=null,updated_at=now() where id=v_item.id and lease_owner=v_worker;
   v_failed := v_failed+1; continue;
  end if;
  -- Exact internal/kingshot/redeem.ts signature: sorted cdk,fid,kid,time + salt.
  v_payload := 'cdk='||v_code||'&fid='||v_fid||'&kid='||v_kid||'&time='||v_epoch;
  v_sign := md5(v_payload || 'mN4!pQs6JrYwV9');
  begin
   select * into v_http from extensions.http_post(
    'https://kingshot-giftcode.centurygame.com/api/gift_code',
    'fid='||v_fid||'&cdk='||v_code||'&kid='||v_kid||'&time='||v_epoch||'&sign='||v_sign,
    'application/x-www-form-urlencoded'
   );
   v_json := null;
   begin v_json := v_http.content::jsonb; exception when others then v_json := null; end;
   v_status := upper(coalesce(v_json->>'msg','UNKNOWN ERROR'));
   v_err := case when coalesce(v_json->>'err_code','') ~ '^[0-9]+$' then (v_json->>'err_code')::integer else null end;
   if v_http.status=429 or v_status='TOO FREQUENT' or v_err=40019 then
    v_status := 'TIMEOUT_RETRY';
    update redemption.queue set state='completed',last_status=v_status,last_error='Upstream asked for a retry',
     result=jsonb_build_object('status',v_status,'err_code',v_err,'message',coalesce(v_json->>'msg','Too frequent'),'http_status',v_http.status),
     lease_owner=null,lease_until=null,updated_at=now() where id=v_item.id and lease_owner=v_worker;
    insert into redemption.journal(player_id,gift_code,attempt_no,state,upstream_status,err_code,message,finished_at)
     values(v_item.player_id,v_item.gift_code,v_item.attempts,'recorded',v_status,v_err,'Upstream asked for a retry',now())
     on conflict(player_id,gift_code,attempt_no) do update set state='recorded',upstream_status=excluded.upstream_status,err_code=excluded.err_code,message=excluded.message,finished_at=now();
    v_done := v_done+1;
   elsif v_http.status in (502,503,504) or v_json is null then
    update redemption.queue set state='uncertain',last_status='UPSTREAM_UNCERTAIN',last_error='Upstream HTTP '||coalesce(v_http.status::text,'unknown')||' or non-JSON response',
     result=jsonb_build_object('http_status',v_http.status,'response_text',left(coalesce(v_http.content,''),500)),
     lease_owner=null,lease_until=null,updated_at=now() where id=v_item.id and lease_owner=v_worker;
    insert into redemption.journal(player_id,gift_code,attempt_no,state,upstream_status,message,finished_at)
     values(v_item.player_id,v_item.gift_code,v_item.attempts,'uncertain','UPSTREAM_UNCERTAIN','Upstream response could not be safely classified',now())
     on conflict(player_id,gift_code,attempt_no) do update set state='uncertain',upstream_status=excluded.upstream_status,message=excluded.message,finished_at=now();
    v_uncertain := v_uncertain+1;
   else
    update redemption.queue set state='completed',last_status=left(v_status,64),last_error=case when v_status in ('SUCCESS','RECEIVED','SAME TYPE EXCHANGE') then null else left(coalesce(v_json->>'msg','Upstream rejected request'),500) end,
     result=jsonb_build_object('status',v_status,'err_code',v_err,'message',coalesce(v_json->>'msg',''),'http_status',v_http.status,'response',coalesce(v_json,'{}'::jsonb)),
     lease_owner=null,lease_until=null,updated_at=now() where id=v_item.id and lease_owner=v_worker;
    insert into redemption.journal(player_id,gift_code,attempt_no,state,upstream_status,err_code,message,finished_at)
     values(v_item.player_id,v_item.gift_code,v_item.attempts,'recorded',v_status,v_err,left(coalesce(v_json->>'msg',''),240),now())
     on conflict(player_id,gift_code,attempt_no) do update set state='recorded',upstream_status=excluded.upstream_status,err_code=excluded.err_code,message=excluded.message,finished_at=now();
    v_done := v_done+1;
   end if;
  exception when others then
   update redemption.queue set state='uncertain',last_status='EXECUTOR_EXCEPTION',last_error=left(sqlerrm,500),result=jsonb_build_object('error','Executor exception; outcome may be unknown'),lease_owner=null,lease_until=null,updated_at=now() where id=v_item.id and lease_owner=v_worker;
   insert into redemption.journal(player_id,gift_code,attempt_no,state,upstream_status,message,finished_at)
    values(v_item.player_id,v_item.gift_code,v_item.attempts,'uncertain','EXECUTOR_EXCEPTION','Executor exception; manual reconciliation required',now())
    on conflict(player_id,gift_code,attempt_no) do update set state='uncertain',upstream_status=excluded.upstream_status,message=excluded.message,finished_at=now();
   v_uncertain := v_uncertain+1;
  end;
  perform pg_sleep(0.1);
 end loop;
 return jsonb_build_object('claimed',v_done+v_uncertain+v_failed,'completed',v_done,'uncertain',v_uncertain,'invalid',v_failed,'batch_limit',least(p_limit,100));
end $$;
revoke all on function public.redemption_execute_batch(integer) from public,anon,authenticated;
grant execute on function public.redemption_execute_batch(integer) to service_role;

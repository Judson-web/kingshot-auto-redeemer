-- Batch-persist conclusive verification results from the automatic redemption workers.
-- A successful redemption may promote any prior status; negative results only
-- replace pending/indeterminate states so weak evidence cannot downgrade a code.
create or replace function public.set_kingshot_gift_codes_validation(
 p_codes text[],
 p_status text,
 p_player_id text default null,
 p_message text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
 v_status text:=lower(trim(coalesce(p_status,'')));
 v_codes text[];
 v_updated integer:=0;
begin
 if v_status not in ('verified','invalid','expired','usage_limit') then
  raise exception 'Invalid gift-code validation status';
 end if;

 select coalesce(array_agg(distinct upper(trim(code))),array[]::text[])
 into v_codes
 from unnest(coalesce(p_codes,array[]::text[])) as input(code)
 where trim(coalesce(code,''))<>'';

 if cardinality(v_codes)=0 then return 0; end if;
 if cardinality(v_codes)>100 then raise exception 'Too many gift codes in one validation batch'; end if;

 update public.kingshot_gift_codes
 set validation_status=v_status,
     validated_at=now(),
     validation_player_id=coalesce(nullif(trim(p_player_id),''),validation_player_id),
     validation_message=left(coalesce(p_message,''),240),
     active=case
       when suppressed then false
       when v_status='verified' and (expires_at is null or expires_at>now()) then true
       else false
     end
 where upper(code)=any(v_codes)
   and (
     v_status='verified'
     or validation_status in ('pending','indeterminate')
   );

 get diagnostics v_updated=row_count;
 return v_updated;
end
$function$;

revoke execute on function public.set_kingshot_gift_codes_validation(text[],text,text,text) from public,anon,authenticated;
grant execute on function public.set_kingshot_gift_codes_validation(text[],text,text,text) to service_role;

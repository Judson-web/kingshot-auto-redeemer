-- Persist player-based validation as an additive gate for discovered gift codes.
alter table public.kingshot_gift_codes add column if not exists validation_status text not null default 'verified';
alter table public.kingshot_gift_codes add column if not exists validated_at timestamptz;
alter table public.kingshot_gift_codes add column if not exists validation_player_id text;
alter table public.kingshot_gift_codes add column if not exists validation_message text;
alter table public.kingshot_gift_codes drop constraint if exists kingshot_gift_codes_validation_status_check;
alter table public.kingshot_gift_codes add constraint kingshot_gift_codes_validation_status_check check(validation_status in('pending','verified','invalid','expired','usage_limit','indeterminate'));
update public.kingshot_gift_codes set validation_status='verified' where validation_status is null or validation_status='';
create index if not exists kingshot_gift_codes_validation_status_idx on public.kingshot_gift_codes(validation_status,active);
create or replace function public.upsert_kingshot_gift_code(p_code text,p_source_date date default null,p_expires_at timestamptz default null)
returns public.kingshot_gift_codes language plpgsql security definer set search_path to public as $function$
declare v public.kingshot_gift_codes; v_code text:=trim(p_code);
begin
 if v_code is null or length(v_code)<6 or length(v_code)>32 or v_code !~ '^[A-Za-z0-9_-]+$' or v_code ~* '^u00[0-9a-f]+'
 or upper(v_code) in('ACTIVE','EXPIRED','CONTINUE','COPYCODE','SIGNINTOREDEEM','SHARELINK','GIFTCODES','REDEEMGIFTCODE','GIFTCODE','LOADING','COMMUNITY','FEATURES','LATEST','CURRENT','POPULAR','PROFILE','PLAYER','KINGDOM','SERVER','MESSAGE','SETTINGS','HEIGHT','GUIDES','MASTERY','OPERATINGSYSTEM','QUESTION','ANSWER','BREADCRUMBLIST','DIRECTLY','HIDDEN','BEFORE','ACCOUNT','EXACTLY','TOGETHER','OPENING','RESULT','PENDING','SCREEN','ACCOUNTS','CAMPAIGN','CONTENT','SCHEMA','CLASSNAME','CHILDREN','FOREGROUND','LEADING','HEADING','MASTERS','HEROES','EVENTS','CHECKED','REWARDS','VERIFIED','IMPORT','COMMON','RECHECK','COMPLETE','UPGRADE','ITEMLISTELEMENT','BOTTOM','ARTICLE','INLINE','MARGIN','BACKGROUND','FIGURE','BUTTONS','BORDER','WEIGHT','PADDING','ABSOLUTE','DISPLAY','BUILDINGS','SHARED','WEBSITE','ONCLICK','DEFAULT','CLIPBOARD','COPIED','MINUTE','STATIC','QUALITY','MISTAKES','PREVENT','ASSETS')
 then raise exception 'Rejected invalid Kingshot gift code'; end if;
 insert into public.kingshot_gift_codes(code,source_date,last_seen_at,active,expires_at,validation_status) values(v_code,p_source_date,now(),false,p_expires_at,'pending')
 on conflict(code) do update set source_date=coalesce(excluded.source_date,kingshot_gift_codes.source_date),last_seen_at=now(),expires_at=coalesce(excluded.expires_at,kingshot_gift_codes.expires_at),
 active=case when kingshot_gift_codes.suppressed then false when coalesce(excluded.expires_at,kingshot_gift_codes.expires_at) is not null and coalesce(excluded.expires_at,kingshot_gift_codes.expires_at)<=now() then false when kingshot_gift_codes.validation_status='verified' then true else false end
 returning * into v; return v;
end $function$;
create or replace function public.upsert_kingshot_gift_code(p_code text,p_source_date date default null)
returns public.kingshot_gift_codes language sql security definer set search_path to public as $function$
 select public.upsert_kingshot_gift_code(p_code,p_source_date,null::timestamptz);
$function$;
create or replace function public.set_kingshot_gift_code_validation(p_code text,p_status text,p_player_id text default null,p_message text default null)
returns public.kingshot_gift_codes language plpgsql security definer set search_path to public as $function$
declare v public.kingshot_gift_codes; s text:=lower(trim(p_status));
begin
 if s not in('pending','verified','invalid','expired','usage_limit','indeterminate') then raise exception 'Invalid gift-code validation status'; end if;
 update public.kingshot_gift_codes set validation_status=s,validated_at=case when s in('verified','invalid','expired','usage_limit') then now() else validated_at end,
 validation_player_id=coalesce(nullif(trim(p_player_id),''),validation_player_id),validation_message=left(coalesce(p_message,''),240),
 active=case when suppressed then false when s='verified' and(expires_at is null or expires_at>now()) then true else false end
 where upper(code)=upper(trim(p_code)) returning * into v;
 if not found then raise exception 'Gift code not found'; end if; return v;
end $function$;
revoke execute on function public.upsert_kingshot_gift_code(text,date,timestamptz) from public,anon,authenticated;
revoke execute on function public.upsert_kingshot_gift_code(text,date) from public,anon,authenticated;
revoke execute on function public.set_kingshot_gift_code_validation(text,text,text,text) from public,anon,authenticated;
grant execute on function public.upsert_kingshot_gift_code(text,date,timestamptz) to service_role;
grant execute on function public.upsert_kingshot_gift_code(text,date) to service_role;
grant execute on function public.set_kingshot_gift_code_validation(text,text,text,text) to service_role;
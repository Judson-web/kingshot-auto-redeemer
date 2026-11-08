insert into public.kingshot_gift_codes(code,active,suppressed,validation_status,expires_at) values
 ('new-code',false,false,'pending',now()+interval '7 days'),
 ('suppressed-code',false,true,'pending',now()+interval '7 days'),
 ('negative-code',false,false,'pending',null),
 ('already-verified',true,false,'verified',null),
 ('usage-code',false,false,'pending',null),
 ('expired-date',false,false,'pending',now()-interval '1 day');

set role service_role;
select public.set_kingshot_gift_codes_validation(
 array['NEW-CODE','suppressed-code','new-code'],
 'verified',
 null,
 'test successful redemption'
);
select public.set_kingshot_gift_codes_validation(array['negative-code'],'invalid',null,'not found');
select public.set_kingshot_gift_codes_validation(array['already-verified'],'invalid',null,'must not downgrade');
select public.set_kingshot_gift_codes_validation(array['usage-code'],'usage_limit',null,'limit reached');
select public.set_kingshot_gift_codes_validation(array['expired-date'],'verified',null,'accepted but expired metadata');

reset role;

do $$
begin
 if not exists(select 1 from public.kingshot_gift_codes where code='new-code' and validation_status='verified' and active=true) then
  raise exception 'verified active code was not promoted';
 end if;
 if not exists(select 1 from public.kingshot_gift_codes where code='suppressed-code' and validation_status='verified' and active=false) then
  raise exception 'suppression was not preserved';
 end if;
 if not exists(select 1 from public.kingshot_gift_codes where code='negative-code' and validation_status='invalid' and active=false) then
  raise exception 'invalid code was not blocked';
 end if;
 if not exists(select 1 from public.kingshot_gift_codes where code='already-verified' and validation_status='verified' and active=true) then
  raise exception 'negative evidence downgraded a verified code';
 end if;
 if not exists(select 1 from public.kingshot_gift_codes where code='usage-code' and validation_status='usage_limit' and active=false) then
  raise exception 'usage-limit state was not persisted';
 end if;
 if not exists(select 1 from public.kingshot_gift_codes where code='expired-date' and validation_status='verified' and active=false) then
  raise exception 'expired metadata did not keep a verified code inactive';
 end if;
 if has_function_privilege('anon','public.set_kingshot_gift_codes_validation(text[],text,text,text)','EXECUTE') then
  raise exception 'anon must not execute the validation RPC';
 end if;
 if has_function_privilege('authenticated','public.set_kingshot_gift_codes_validation(text[],text,text,text)','EXECUTE') then
  raise exception 'authenticated must not execute the validation RPC';
 end if;
 if not has_function_privilege('service_role','public.set_kingshot_gift_codes_validation(text[],text,text,text)','EXECUTE') then
  raise exception 'service_role must execute the validation RPC';
 end if;
end
$$;

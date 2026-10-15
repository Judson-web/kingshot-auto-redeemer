alter table private.kingshot_admin_sessions alter column access_key_id drop not null;
create or replace function public.kingshot_admin_create_discord_session(p_token_hash text,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,private,auth as $$
declare v_email text; v_discord_id text;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return false; end if;
 select u.email,coalesce(i.identity_data->>'provider_id',i.identity_data->>'sub',i.identity_data->>'id',i.identity_data->>'user_id',u.raw_user_meta_data->>'provider_id',u.raw_user_meta_data->>'sub',u.raw_user_meta_data->>'id')
 into v_email,v_discord_id from auth.users u join auth.identities i on i.user_id=u.id and i.provider='discord' where u.id=p_user_id limit 1;
 if v_email is null or v_discord_id is distinct from '871756466900598815' then return false; end if;
 delete from private.kingshot_admin_sessions where expires_at<now();
 insert into private.kingshot_admin_sessions(token_hash,expires_at,access_key_id) values(p_token_hash,now()+interval '2 minutes',null)
 on conflict(token_hash) do update set expires_at=excluded.expires_at,access_key_id=null;
 return true;
end $$;
create or replace function public.kingshot_admin_audit(p_token_hash text,p_action text,p_target_type text default null,p_target_id text default null,p_details jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path=public,private as $$
declare v_actor text;
begin
 select case when s.access_key_id is null then 'discord-owner' else 'access-key:'||coalesce(k.label,'admin') end into v_actor
 from private.kingshot_admin_sessions s left join private.kingshot_admin_access_keys k on k.id=s.access_key_id
 where s.token_hash=p_token_hash and s.expires_at>now() limit 1;
 if v_actor is null then raise exception 'Unauthorized'; end if;
 insert into public.kingshot_admin_audit_log(actor,action,target_type,target_id,details)
 values(v_actor,left(p_action,120),left(p_target_type,80),left(p_target_id,200),coalesce(p_details,'{}'::jsonb));
 return true;
end $$;
revoke all on function public.kingshot_admin_create_discord_session(text,uuid) from public,anon,authenticated;
grant execute on function public.kingshot_admin_create_discord_session(text,uuid) to service_role;
revoke all on function public.kingshot_admin_create_session_with_key(text,text) from public,anon,authenticated;
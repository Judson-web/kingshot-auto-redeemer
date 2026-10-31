-- The worker calls this RPC with the service_role key. SECURITY INVOKER is sufficient
-- because service_role has explicit table privileges and avoids a privileged definer.
alter function public.claim_due_discord_announcements(integer) security invoker;
revoke all on function public.claim_due_discord_announcements(integer) from public, anon, authenticated;
grant execute on function public.claim_due_discord_announcements(integer) to service_role;

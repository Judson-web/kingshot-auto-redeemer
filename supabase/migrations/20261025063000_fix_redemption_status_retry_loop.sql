-- Prevent repeated per-player retries when upstream eligibility errors are persisted
-- using a different spelling (for example STOVE_LV ERROR vs STOVE LV ERROR).
CREATE OR REPLACE FUNCTION public.claim_kingshot_redemption(p_player_id text, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v public.kingshot_redemptions;
begin
  insert into public.kingshot_redemptions(player_id,gift_code,status,message,attempted_at)
  values(p_player_id,p_code,'PROCESSING','Redemption attempt claimed by worker.',now())
  on conflict(player_id,gift_code) do update
    set status='PROCESSING',
        message='Redemption attempt reclaimed by worker.',
        attempted_at=now()
    where upper(replace(coalesce(public.kingshot_redemptions.status,''), '_', ' ')) not in (
      'SUCCESS',
      'RECEIVED',
      'SAME TYPE EXCHANGE',
      'TIME ERROR',
      'CDK NOT FOUND',
      'USAGE LIMIT',
      'STOVE LV ERROR',
      'USER INFO ERROR',
      'RECHARGE MONEY ERROR'
    )
    and (
      public.kingshot_redemptions.status <> 'PROCESSING'
      or public.kingshot_redemptions.attempted_at < now()-interval '20 minutes'
    )
  returning * into v;
  return v.id is not null;
end
$function$;

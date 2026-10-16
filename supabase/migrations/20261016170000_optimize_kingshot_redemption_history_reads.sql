-- Support the bulk history RPC's player filter and newest-first ordering.
-- The existing unique (player_id, gift_code) index cannot efficiently satisfy
-- ORDER BY attempted_at across all codes for a player.
create index if not exists kingshot_redemptions_player_attempted_idx
  on public.kingshot_redemptions (player_id, attempted_at desc);

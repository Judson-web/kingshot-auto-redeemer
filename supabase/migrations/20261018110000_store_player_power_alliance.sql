-- Persist the player profile fields displayed throughout the application.
alter table public.kingshot_autoredeem
  add column if not exists player_power numeric,
  add column if not exists alliance_name text,
  add column if not exists alliance_tag text;

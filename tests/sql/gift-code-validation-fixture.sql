-- Minimal disposable table matching the columns used by the validation RPC.
create table public.kingshot_gift_codes (
  code text primary key,
  active boolean not null default false,
  suppressed boolean not null default false,
  expires_at timestamptz,
  validation_status text not null default 'pending',
  validated_at timestamptz,
  validation_player_id text,
  validation_message text
);

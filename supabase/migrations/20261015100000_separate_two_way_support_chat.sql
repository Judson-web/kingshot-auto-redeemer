-- Separate two-way support conversations from Player ID registration-removal tickets.
create table if not exists public.kingshot_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  access_token_hash text not null check (access_token_hash ~ '^[0-9a-f]{64}$'),
  player_id text check (player_id is null or player_id ~ '^[0-9]{5,20}$'),
  subject text not null default 'Support conversation' check (char_length(subject) between 1 and 120),
  status text not null default 'open' check (status in ('open','waiting','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists kingshot_chat_conversations_last_message_idx
  on public.kingshot_chat_conversations(last_message_at desc);
create table if not exists public.kingshot_chat_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.kingshot_chat_conversations(id) on delete cascade,
  sender text not null check (sender in ('user','admin')),
  body text not null check (char_length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index if not exists kingshot_chat_messages_conversation_idx
  on public.kingshot_chat_messages(conversation_id,created_at asc);
alter table public.kingshot_chat_conversations enable row level security;
alter table public.kingshot_chat_messages enable row level security;
revoke all on public.kingshot_chat_conversations from public,anon,authenticated;
revoke all on public.kingshot_chat_messages from public,anon,authenticated;
grant all on public.kingshot_chat_conversations to service_role;
grant all on public.kingshot_chat_messages to service_role;

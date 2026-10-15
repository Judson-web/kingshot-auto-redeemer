alter table public.kingshot_chat_conversations add column if not exists support_ticket_id text;
create index if not exists kingshot_chat_conversations_support_ticket_id_idx on public.kingshot_chat_conversations (support_ticket_id) where support_ticket_id is not null;

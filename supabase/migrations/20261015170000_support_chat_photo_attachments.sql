alter table public.kingshot_chat_messages add column if not exists attachment_path text, add column if not exists attachment_name text, add column if not exists attachment_type text;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('kingshot-support-private','kingshot-support-private',false,2097152,array['image/jpeg','image/png','image/webp','image/gif']) on conflict (id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];
revoke all on storage.objects from anon, authenticated;

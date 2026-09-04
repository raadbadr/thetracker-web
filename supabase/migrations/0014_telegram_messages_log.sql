-- سجل كل رسالة تصل البوت (طلب المهندس رعد: يريد أن يرى ماذا يقول المستخدم للبوت).
-- الكتابة من الـ Worker وحده عبر دالة محمية بالسر، والقراءة لمدير المنصة فقط.
create table if not exists public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  username text,
  first_name text,
  body text,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null default 'none' check (action in ('none','linked','bad_code')),
  created_at timestamptz not null default now()
);
create index if not exists telegram_messages_created_idx on public.telegram_messages (created_at desc);
alter table public.telegram_messages enable row level security;
drop policy if exists telegram_messages_read on public.telegram_messages;
create policy telegram_messages_read on public.telegram_messages for select using (public.is_platform_admin());

-- تعيد صاحب المحادثة (إن كانت مربوطة) ليعرف الـ Worker كيف يرد على الرسالة
drop function if exists public.log_telegram_message(text, text, text, text, text, uuid, text);
create function public.log_telegram_message(
  p_secret text, p_chat_id text, p_username text, p_first_name text, p_body text, p_user_id uuid, p_action text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := p_user_id;
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  -- رسالة من محادثة مربوطة سابقاً: انسبها لصاحبها
  if v_user is null then
    select user_id into v_user from public.channel_links
    where channel = 'telegram' and external_id = p_chat_id and verified_at is not null
    limit 1;
  end if;
  insert into public.telegram_messages (chat_id, username, first_name, body, user_id, action)
  values (p_chat_id, p_username, p_first_name, left(p_body, 4000), v_user, coalesce(p_action, 'none'));
  return v_user;
end $$;
revoke all on function public.log_telegram_message(text, text, text, text, text, uuid, text) from public;
grant execute on function public.log_telegram_message(text, text, text, text, text, uuid, text) to anon, service_role;

-- ذاكرة المحادثة للوكيل على تيليغرام: آخر الرسائل (من المستخدم ومن البوت) لدردشة واحدة
create or replace function public.telegram_history(p_secret text, p_chat_id text, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('role', case when m.action = 'reply' then 'assistant' else 'user' end, 'body', m.body, 'at', m.created_at) order by m.created_at asc), '[]'::jsonb)
  into result
  from (select body, action, created_at from public.telegram_messages
        where chat_id = p_chat_id and coalesce(body,'') <> '' and body not like '/start%'
        order by created_at desc limit greatest(1, least(coalesce(p_limit, 10), 30))) m;
  return result;
end $$;
revoke all on function public.telegram_history(text, text, integer) from public;
grant execute on function public.telegram_history(text, text, integer) to anon, service_role;

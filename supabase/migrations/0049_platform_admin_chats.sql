-- محادثات تيليغرام لمديري المنصة: يصلهم تنبيه فوري عند ربط عضو جديد أو حين يكتب للبوت شخص غير مرتبط
create or replace function public.platform_admin_chats(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', l.user_id, 'chat_id', l.external_id, 'lang', coalesce(p.lang,'ar'))), '[]'::jsonb) into result
  from public.channel_links l join public.profiles p on p.id = l.user_id
  where l.channel = 'telegram' and l.verified_at is not null and l.external_id is not null and p.is_platform_admin = true;
  return result;
end $$;
revoke all on function public.platform_admin_chats(text) from public;
grant execute on function public.platform_admin_chats(text) to anon, service_role;

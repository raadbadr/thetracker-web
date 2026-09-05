-- من هو هذا المستخدم على تيليغرام؟ يستعمله خادم MCP كي يعمل الوكيل باسم العضو الذي يخاطبه وبصلاحياته (لا باسم صاحب المفتاح دائما)
create or replace function public.channel_user_lookup(p_secret text, p_channel text, p_external_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_name text;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select l.user_id into v_user from public.channel_links l
  where l.channel = p_channel and l.external_id = p_external_id and l.verified_at is not null
  order by l.verified_at desc limit 1;
  if v_user is null then return null; end if;
  select coalesce(p.full_name, p.email) into v_name from public.profiles p where p.id = v_user;
  return jsonb_build_object('user_id', v_user, 'name', v_name);
end $$;
revoke all on function public.channel_user_lookup(text, text, text) from public;
grant execute on function public.channel_user_lookup(text, text, text) to anon, service_role;

-- هدف الإرسال يعيد أيضاً اسم المستخدم واسم شركته، ليرحّب به البوت باسمه عند ربط
-- القناة (طلب المهندس رعد). الشركة: التي يملكها، وإلا أول عضوية فعّالة.
create or replace function public.notify_target(p_secret text, p_user_id uuid, p_channel text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'email', (select email from public.profiles where id = p_user_id),
    'full_name', (select full_name from public.profiles where id = p_user_id),
    'lang', coalesce((select lang from public.profiles where id = p_user_id), 'ar'),
    'org_name', (select o.name from public.organizations o
                 join public.org_members m on m.org_id = o.id
                 where m.user_id = p_user_id and m.status = 'active'
                 order by (m.role = 'owner') desc, m.created_at asc
                 limit 1),
    'external_id', (select external_id from public.channel_links
                    where user_id = p_user_id and channel = p_channel and verified_at is not null)
  );
end $$;

-- ثغرة صلاحيات: profiles_update تسمح لأي مستخدم بتعديل صفه هو، ولا قيد على
-- عمود is_platform_admin، فيستطيع أي مستخدم ترقية نفسه بطلب واحد من المتصفح.
-- المشغل يمنع تغيير هذا العمود إلا من دالة SECURITY DEFINER (تعمل بصلاحية
-- postgres)، فيبقى التعديل حصرا عبر platform_admin_set أدناه.
create or replace function public.guard_platform_admin_column()
returns trigger language plpgsql as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin and current_user <> 'postgres' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_platform_admin on public.profiles;
create trigger guard_platform_admin before update on public.profiles
  for each row execute function public.guard_platform_admin_column();

-- إدارة مديري المنصة: يراها ويعدلها من هو مدير منصة بالفعل فقط.
create or replace function public.platform_admins_list()
returns table (id uuid, full_name text, email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.created_at
  from public.profiles p
  where p.is_platform_admin = true and public.is_platform_admin()
  order by p.created_at asc;
$$;
revoke all on function public.platform_admins_list() from public, anon;
grant execute on function public.platform_admins_list() to authenticated;

create or replace function public.platform_admin_set(p_email text, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_count int;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select id into v_id from public.profiles where lower(email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'NO_USER: لا يوجد مستخدم مسجل بهذا البريد' using errcode = 'P0001';
  end if;
  if not p_admin then
    if v_id = auth.uid() then
      raise exception 'CANNOT_SELF_REMOVE: لا يمكنك إزالة صلاحيتك عن نفسك' using errcode = 'P0001';
    end if;
    select count(*) into v_count from public.profiles where is_platform_admin = true;
    if v_count <= 1 then
      raise exception 'LAST_ADMIN: لا يمكن ترك المنصة بلا مدير' using errcode = 'P0001';
    end if;
  end if;
  update public.profiles set is_platform_admin = p_admin where id = v_id;
end $$;
revoke all on function public.platform_admin_set(text, boolean) from public, anon;
grant execute on function public.platform_admin_set(text, boolean) to authenticated;

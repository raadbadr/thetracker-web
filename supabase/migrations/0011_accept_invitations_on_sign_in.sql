-- الدعوات كانت تُقبل فقط داخل مشغّل إنشاء المستخدم (on_auth_user_created)، فمن
-- كان مسجّلاً في المنصة قبل دعوته لا يُنشأ له صف جديد في auth.users، فتبقى دعوته
-- معلقة إلى الأبد ولا تصل إليه. الحل: قبول الدعوات عند كل دخول للتطبيق.

-- منطق القبول في مكان واحد: يُدخل العضوية، ويختم الدعوة، ويعيد الشركات المنضم
-- إليها الآن ليخبر التطبيق المستخدم بها. حد الأعضاء في الباقة يبقى مفروضاً:
-- إن كانت الشركة ممتلئة تبقى الدعوة معلقة ولا يفشل الدخول.
create or replace function public.accept_invitations_for(u uuid)
returns table (joined_org_id uuid, joined_org_name text, joined_role text)
language plpgsql security definer set search_path = public as $$
declare
  mail text;
  inv record;
  ok boolean;
begin
  if u is null then return; end if;
  select lower(email) into mail from auth.users where id = u;
  if mail is null or mail = '' then return; end if;

  for inv in
    select i.id as inv_id, i.org_id as inv_org, i.role as inv_role, i.invited_by as inv_by
    from public.invitations i
    where lower(i.email) = mail and i.accepted_at is null
    order by i.created_at
  loop
    ok := true;
    begin
      insert into public.org_members (org_id, user_id, role, status, invited_email, invited_by)
      values (inv.inv_org, u, inv.inv_role, 'active', mail, inv.inv_by)
      on conflict (org_id, user_id) do nothing;
    exception when others then
      ok := false;
    end;
    if ok then
      update public.invitations set accepted_at = now() where id = inv.inv_id;
      return query
        select o.id, o.name, inv.inv_role from public.organizations o where o.id = inv.inv_org;
    end if;
  end loop;
end $$;

revoke all on function public.accept_invitations_for(uuid) from public, anon, authenticated;

-- ما يناديه المتصفح: لا يقبل إلا دعوات صاحب الجلسة نفسه.
create or replace function public.accept_my_invitations()
returns table (joined_org_id uuid, joined_org_name text, joined_role text)
language sql security definer set search_path = public as $$
  select * from public.accept_invitations_for(auth.uid());
$$;

revoke all on function public.accept_my_invitations() from public, anon;
grant execute on function public.accept_my_invitations() to authenticated;

-- المستخدم الجديد يمر على المنطق نفسه، وفشل الانضمام (باقة ممتلئة مثلاً) لم يعد
-- يُسقط عملية التسجيل كلها.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email, ''), '@', 1)),
    new.email,
    new.phone
  )
  on conflict (id) do update set email = excluded.email, phone = coalesce(excluded.phone, public.profiles.phone);
  perform public.accept_invitations_for(new.id);
  return new;
end $$;

-- الدعوات المعلقة لمستخدمين مسجّلين أصلاً تُقبل دفعة واحدة.
select public.accept_invitations_for(u.id)
from auth.users u
where exists (
  select 1 from public.invitations i
  where lower(i.email) = lower(u.email) and i.accepted_at is null
);

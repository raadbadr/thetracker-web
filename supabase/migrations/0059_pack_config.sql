-- حسم حزمة الواجهة وإرسالها للمتصفح. دوال جديدة فقط: my_services وcreate_org_registered لا تمسان.

-- الحزمة صفة الحساب: ما اختير للحساب، ثم افتراض مالكه، ثم الافتراضية.
-- لا حساب قائم تتغير واجهته من تلقاء نفسها؛ التغيير باختيار صريح وحده.
create or replace function public.pack_for(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.ui_pack from public.org_profiles p
       join public.ui_packs u on u.key = p.ui_pack and u.active
      where p.org_id = p_org),
    (select u.key from public.organizations o
       join public.profiles pr on pr.id = o.owner_id
       join public.ui_packs u on u.key = pr.ui_pack and u.active
      where o.id = p_org),
    (select key from public.ui_packs where active and is_default order by sort_order limit 1)
  )
$$;
revoke all on function public.pack_for(uuid) from public;
grant execute on function public.pack_for(uuid) to authenticated;

-- كل ما ترسم به الواجهة نفسها: اسم الحزمة وتسمياتها وخدماتها بترتيبها
create or replace function public.my_pack_config(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with k as (select public.pack_for(p_org) as key)
  select case when (select key from k) is null then null else jsonb_build_object(
    'pack',       (select key from k),
    'names',      (select names  from public.ui_packs where key = (select key from k)),
    'labels',     (select labels from public.ui_packs where key = (select key from k)),
    'is_default', (select is_default from public.ui_packs where key = (select key from k)),
    'services',   coalesce((select jsonb_agg(jsonb_build_object('service', s.service, 'sort', s.sort_order, 'label', s.label)
                                             order by s.sort_order, s.service)
                            from public.pack_services s where s.pack_key = (select key from k)), '[]'::jsonb)
  ) end
  where exists (select 1 from public.org_members m
                 where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active')
$$;
revoke all on function public.my_pack_config(uuid) from public;
grant execute on function public.my_pack_config(uuid) to authenticated;

-- الحزم المعروضة للاختيار عند إنشاء حساب أو في إعداداته
create or replace function public.list_ui_packs()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', key, 'names', names, 'hints', hints, 'icon', icon,
    'entity_default', entity_default, 'entity_choices', entity_choices, 'is_default', is_default
  ) order by sort_order, key), '[]'::jsonb)
  from public.ui_packs where active
$$;
revoke all on function public.list_ui_packs() from public;
grant execute on function public.list_ui_packs() to authenticated;

-- تغيير واجهة الحساب: المالك أو المدير وحدهما، والحساب الفردي يبقى على حزمة الشخص
create or replace function public.set_org_pack(p_org uuid, p_pack text)
returns text language plpgsql security definer set search_path = public as $$
declare v_role text; v_entity text;
begin
  select role into v_role from public.org_members
   where org_id = p_org and user_id = auth.uid() and status = 'active';
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_pack is not null and not exists (select 1 from public.ui_packs where key = p_pack and active) then
    raise exception 'unknown pack' using errcode = '22023';
  end if;
  select entity_type into v_entity from public.org_profiles where org_id = p_org;
  insert into public.org_profiles (org_id, ui_pack) values (p_org, p_pack)
    on conflict (org_id) do update set ui_pack = excluded.ui_pack;
  update public.profiles set ui_pack = p_pack where id = auth.uid() and p_pack is not null;
  return public.pack_for(p_org);
end $$;
revoke all on function public.set_org_pack(uuid, text) from public;
grant execute on function public.set_org_pack(uuid, text) to authenticated;

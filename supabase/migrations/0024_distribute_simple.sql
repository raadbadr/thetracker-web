-- توزيع المهام بضغطة واحدة (طلب المهندس رعد: "طريقة أسهل"): اختيار اسم العضو على العنصر
-- يجعله المنفّذ المسؤول (R) ومكلَّفاً به (assignee)، ومن وزّع يصبح المعتمد (A) تلقائياً
-- إن لم يكن للعنصر معتمد. الضغطة الثانية تجعله مسانداً (S)، والثالثة تزيله.
create or replace function public.distribute_item(p_item uuid, p_user uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_actor uuid := auth.uid();
begin
  select org_id into v_org from public.items where id = p_item;
  if v_org is null or v_actor is null or v_org not in (select public.current_org_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_members where org_id = v_org and user_id = p_user and status = 'active') then
    raise exception 'not a member' using errcode = 'P0001';
  end if;
  if p_mode = 'R' then
    delete from public.item_roles where item_id = p_item and role = 'R' and user_id <> p_user;
    insert into public.item_roles (org_id, item_id, user_id, role, set_by) values (v_org, p_item, p_user, 'R', v_actor)
    on conflict (item_id, user_id) do update set role = 'R', set_by = v_actor, updated_at = now();
    update public.items set assignee_id = p_user where id = p_item;
    if not exists (select 1 from public.item_roles where item_id = p_item and role = 'A') and v_actor <> p_user then
      insert into public.item_roles (org_id, item_id, user_id, role, set_by) values (v_org, p_item, v_actor, 'A', v_actor)
      on conflict (item_id, user_id) do update set role = 'A', set_by = v_actor, updated_at = now();
    end if;
  elsif p_mode = 'S' then
    insert into public.item_roles (org_id, item_id, user_id, role, set_by) values (v_org, p_item, p_user, 'S', v_actor)
    on conflict (item_id, user_id) do update set role = 'S', set_by = v_actor, updated_at = now();
    update public.items set assignee_id = null where id = p_item and assignee_id = p_user;
  else
    delete from public.item_roles where item_id = p_item and user_id = p_user;
    update public.items set assignee_id = null where id = p_item and assignee_id = p_user;
  end if;
  return jsonb_build_object('item_id', p_item, 'roles', (select coalesce(jsonb_object_agg(user_id, role), '{}'::jsonb) from public.item_roles where item_id = p_item));
end $$;
revoke all on function public.distribute_item(uuid, uuid, text) from public;
grant execute on function public.distribute_item(uuid, uuid, text) to authenticated;

-- إسناد من البوت يضبط الأدوار نفسها: المُسنَد إليه R، والمُسنِد A إن لم يوجد
create or replace function public.telegram_assign(p_secret text, p_user_id uuid, p_query text, p_member text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q text; mq text; v_item uuid; v_org uuid; v_title text; v_num text; c int; v_member uuid; v_member_name text; v_chat text; v_lang text;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  q := '%' || trim(coalesce(p_query, '')) || '%'; mq := '%' || trim(coalesce(p_member, '')) || '%';
  select count(*) into c from public.items i where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
    and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q);
  if c = 0 then return jsonb_build_object('status', 'not_found'); end if;
  if c > 1 then return jsonb_build_object('status', 'ambiguous'); end if;
  select i.id, i.org_id, i.title, i.item_number into v_item, v_org, v_title, v_num from public.items i where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
    and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q) limit 1;
  select p.id, p.full_name, p.lang into v_member, v_member_name, v_lang from public.profiles p
  join public.org_members m on m.user_id = p.id and m.status = 'active'
  where m.org_id = v_org and (p.full_name ilike mq or p.email ilike mq)
  order by (p.email ilike mq) desc limit 1;
  if v_member is null then return jsonb_build_object('status', 'no_member'); end if;
  update public.items set assignee_id = v_member where id = v_item;
  delete from public.item_roles where item_id = v_item and role = 'R' and user_id <> v_member;
  insert into public.item_roles (org_id, item_id, user_id, role, set_by) values (v_org, v_item, v_member, 'R', p_user_id)
  on conflict (item_id, user_id) do update set role = 'R', set_by = p_user_id, updated_at = now();
  if not exists (select 1 from public.item_roles where item_id = v_item and role = 'A') and p_user_id <> v_member then
    insert into public.item_roles (org_id, item_id, user_id, role, set_by) values (v_org, v_item, p_user_id, 'A', p_user_id)
    on conflict (item_id, user_id) do update set role = 'A', set_by = p_user_id, updated_at = now();
  end if;
  select external_id into v_chat from public.channel_links where user_id = v_member and channel = 'telegram' and verified_at is not null;
  return jsonb_build_object('status', 'assigned', 'id', v_item, 'title', v_title, 'item_number', v_num,
                            'member_name', v_member_name, 'member_chat', v_chat, 'member_lang', coalesce(v_lang, 'ar'));
end $$;

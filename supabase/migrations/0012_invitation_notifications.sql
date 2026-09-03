-- الدعوة لم تكن تُصدر أي تنبيه: الجرس يقرأ notifications بقناة inapp، ولا أحد
-- يكتب فيها عند الدعوة. الآن يُخطر الطرفان: المدعو لحظة دعوته، والداعي وبقية
-- المشرفين لحظة انضمامه.

-- تنبيهات الدعوة لا ترتبط بعنصر، فالعمود صار اختيارياً.
alter table public.notifications alter column item_id drop not null;

-- المدعو يقرأ تنبيهه قبل أن يصير عضواً في الشركة.
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select using (user_id = auth.uid() or org_id in (select public.current_org_ids()));

-- كتابة تنبيه داخل التطبيق من مكان واحد.
create or replace function public.notify_inapp(p_org uuid, p_user uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_org is null or p_user is null then return; end if;
  insert into public.notifications (org_id, user_id, channel, scheduled_at, sent_at, status, payload)
  values (p_org, p_user, 'inapp', now(), now(), 'sent', p_payload);
exception when others then
  return; -- التنبيه لا يُسقط العملية الأصلية أبداً
end $$;
revoke all on function public.notify_inapp(uuid, uuid, jsonb) from public, anon, authenticated;

-- عند إنشاء الدعوة: إن كان البريد لمستخدم مسجّل وصله التنبيه فوراً.
create or replace function public.notify_invitation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  invitee uuid;
  oname text;
  actor text;
begin
  select id into invitee from auth.users where lower(email) = lower(new.email) limit 1;
  if invitee is null then return new; end if;
  select name into oname from public.organizations where id = new.org_id;
  select coalesce(p.full_name, p.email) into actor from public.profiles p where p.id = new.invited_by;
  perform public.notify_inapp(new.org_id, invitee, jsonb_build_object(
    'kind', 'invite',
    'title', 'دعوة للانضمام إلى شركة ' || coalesce(oname, ''),
    'org_id', new.org_id,
    'org_name', oname,
    'actor', actor,
    'member_role', new.role
  ));
  return new;
end $$;

drop trigger if exists on_invitation_created on public.invitations;
create trigger on_invitation_created after insert on public.invitations
  for each row execute function public.notify_invitation();

-- عند الانضمام: يُخطر المالك والمشرفون، ويُخطر المنضم بشركته الجديدة.
create or replace function public.accept_invitations_for(u uuid)
returns table (joined_org_id uuid, joined_org_name text, joined_role text)
language plpgsql security definer set search_path = public as $$
declare
  mail text;
  who text;
  inv record;
  oname text;
  boss record;
  ok boolean;
begin
  if u is null then return; end if;
  select lower(email) into mail from auth.users where id = u;
  if mail is null or mail = '' then return; end if;
  select coalesce(p.full_name, p.email, mail) into who from public.profiles p where p.id = u;

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
      select name into oname from public.organizations where id = inv.inv_org;

      perform public.notify_inapp(inv.inv_org, u, jsonb_build_object(
        'kind', 'joined', 'title', 'انضممت إلى شركة ' || coalesce(oname, ''),
        'org_id', inv.inv_org, 'org_name', oname, 'member_role', inv.inv_role));

      for boss in
        select m.user_id from public.org_members m
        where m.org_id = inv.inv_org and m.role in ('owner', 'admin') and m.user_id <> u
      loop
        perform public.notify_inapp(inv.inv_org, boss.user_id, jsonb_build_object(
          'kind', 'member_joined', 'title', coalesce(who, mail) || ' انضم إلى شركة ' || coalesce(oname, ''),
          'org_id', inv.inv_org, 'org_name', oname, 'actor', coalesce(who, mail), 'member_role', inv.inv_role));
      end loop;

      return query
        select o.id, o.name, inv.inv_role from public.organizations o where o.id = inv.inv_org;
    end if;
  end loop;
end $$;
revoke all on function public.accept_invitations_for(uuid) from public, anon, authenticated;

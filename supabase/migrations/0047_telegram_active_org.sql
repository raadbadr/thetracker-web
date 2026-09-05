-- الشركة النشطة في محادثة تيليغرام: من له أكثر من شركة يختار مرة واحدة، وكل أدوات البوت تعمل عليها
alter table public.channel_links add column if not exists active_org_id uuid references public.organizations(id) on delete set null;

create or replace function public.telegram_user_orgs(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select m.org_id from public.org_members m
  where m.user_id = p_user_id and m.status = 'active'
    and (
      not exists (select 1 from public.channel_links l join public.org_members m2 on m2.org_id = l.active_org_id and m2.user_id = p_user_id and m2.status = 'active'
                  where l.user_id = p_user_id and l.channel = 'telegram' and l.verified_at is not null and l.active_org_id is not null)
      or m.org_id = (select l.active_org_id from public.channel_links l where l.user_id = p_user_id and l.channel = 'telegram' and l.verified_at is not null and l.active_org_id is not null order by l.verified_at desc limit 1)
    )
$$;

create or replace function public.telegram_org_choices(p_secret text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role,
           'active', (o.id = (select l.active_org_id from public.channel_links l where l.user_id = p_user_id and l.channel = 'telegram' and l.verified_at is not null order by l.verified_at desc limit 1)))
         order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, o.created_at), '[]'::jsonb)
  into result
  from public.org_members m join public.organizations o on o.id = m.org_id
  where m.user_id = p_user_id and m.status = 'active';
  return result;
end $$;
revoke all on function public.telegram_org_choices(text, uuid) from public;
grant execute on function public.telegram_org_choices(text, uuid) to anon, service_role;

create or replace function public.telegram_set_org(p_secret text, p_user_id uuid, p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select o.name into v_name from public.org_members m join public.organizations o on o.id = m.org_id
  where m.user_id = p_user_id and m.org_id = p_org and m.status = 'active';
  if v_name is null then return jsonb_build_object('status', 'not_member'); end if;
  update public.channel_links set active_org_id = p_org where user_id = p_user_id and channel = 'telegram' and verified_at is not null;
  return jsonb_build_object('status', 'ok', 'name', v_name);
end $$;
revoke all on function public.telegram_set_org(text, uuid, uuid) from public;
grant execute on function public.telegram_set_org(text, uuid, uuid) to anon, service_role;

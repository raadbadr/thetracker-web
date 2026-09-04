-- رسالة الفريق كله تصل جرس كل عضو، وفتح الدردشة يُعلّمها مقروءة.
create or replace function public.notify_team_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text;
  oname text;
  m record;
begin
  select coalesce(p.full_name, p.email) into who from public.profiles p where p.id = new.author_id;
  select name into oname from public.organizations where id = new.org_id;
  if new.to_user_id is null then
    for m in select user_id from public.org_members where org_id = new.org_id and status = 'active' and user_id <> new.author_id loop
      perform public.notify_inapp(new.org_id, m.user_id, jsonb_build_object(
        'kind', 'team_room', 'title', coalesce(who, '') || ': ' || left(new.body, 120),
        'org_id', new.org_id, 'org_name', oname, 'actor', who, 'author_id', new.author_id,
        'excerpt', left(new.body, 120)));
    end loop;
    return new;
  end if;
  if new.to_user_id = new.author_id then return new; end if;
  perform public.notify_inapp(new.org_id, new.to_user_id, jsonb_build_object(
    'kind', 'team_message', 'title', coalesce(who, '') || ' أرسل إليك رسالة',
    'org_id', new.org_id, 'org_name', oname, 'actor', who, 'author_id', new.author_id,
    'excerpt', left(new.body, 120), 'item_id', new.item_id));
  return new;
end $$;

create or replace function public.mark_chat_read(peer uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null
    and ((peer is null and payload->>'kind' = 'team_room')
      or (peer is not null and payload->>'kind' = 'team_message' and payload->>'author_id' = peer::text));
  get diagnostics n = row_count;
  return n;
end $$;

-- الدردشة صارت شاشة كاملة: المحادثة الثنائية خاصة بطرفيها، والقراءة حية عبر Realtime.

drop policy if exists team_messages_read on public.team_messages;
create policy team_messages_read on public.team_messages
  for select using (
    org_id in (select public.current_org_ids())
    and (to_user_id is null or to_user_id = auth.uid() or author_id = auth.uid())
  );

alter table public.team_messages replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_messages'
    ) then
      alter publication supabase_realtime add table public.team_messages;
    end if;
  end if;
end $$;

-- من يفتح محادثته لا يبقى عنده تنبيه غير مقروء عنها.
create or replace function public.mark_chat_read(peer uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null
    and payload->>'kind' = 'team_message'
    and (peer is null or payload->>'author_id' = peer::text);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- التنبيه يحمل معرّف كاتبه ليُربط بالمحادثة الصحيحة.
create or replace function public.notify_team_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text;
  oname text;
begin
  if new.to_user_id is null or new.to_user_id = new.author_id then return new; end if;
  select coalesce(p.full_name, p.email) into who from public.profiles p where p.id = new.author_id;
  select name into oname from public.organizations where id = new.org_id;
  perform public.notify_inapp(new.org_id, new.to_user_id, jsonb_build_object(
    'kind', 'team_message',
    'title', coalesce(who, '') || ' أرسل إليك رسالة',
    'org_id', new.org_id, 'org_name', oname, 'actor', who,
    'author_id', new.author_id,
    'excerpt', left(new.body, 120), 'item_id', new.item_id));
  return new;
end $$;

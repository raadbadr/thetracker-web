-- صفحة الفريق صارت مكان العمل: توزيع الأعمال، والتواصل، وتوجيه المهمات.
-- الرسالة الموجهة إلى عضو تصل جرسه، ومن يُسند إليه عمل يعرف به فوراً.

create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid references auth.users(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists team_messages_org_idx on public.team_messages (org_id, created_at desc);

alter table public.team_messages enable row level security;

drop policy if exists team_messages_read on public.team_messages;
create policy team_messages_read on public.team_messages
  for select using (org_id in (select public.current_org_ids()));

drop policy if exists team_messages_insert on public.team_messages;
create policy team_messages_insert on public.team_messages
  for insert with check (org_id in (select public.current_org_ids()) and author_id = auth.uid());

drop policy if exists team_messages_delete on public.team_messages;
create policy team_messages_delete on public.team_messages
  for delete using (author_id = auth.uid() or public.is_org_admin(org_id));

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
    'excerpt', left(new.body, 120), 'item_id', new.item_id));
  return new;
end $$;

drop trigger if exists on_team_message on public.team_messages;
create trigger on_team_message after insert on public.team_messages
  for each row execute function public.notify_team_message();

create or replace function public.notify_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text;
  oname text;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  if new.assignee_id = auth.uid() then return new; end if;
  select coalesce(p.full_name, p.email) into actor from public.profiles p where p.id = auth.uid();
  select name into oname from public.organizations where id = new.org_id;
  perform public.notify_inapp(new.org_id, new.assignee_id, jsonb_build_object(
    'kind', 'assigned',
    'title', 'أُسندت إليك: ' || coalesce(new.title, ''),
    'org_id', new.org_id, 'org_name', oname, 'actor', actor,
    'item_id', new.id, 'item_number', new.item_number, 'item_title', new.title, 'due_at', new.due_at));
  return new;
end $$;

drop trigger if exists on_item_assigned on public.items;
create trigger on_item_assigned after insert or update of assignee_id on public.items
  for each row execute function public.notify_assignment();

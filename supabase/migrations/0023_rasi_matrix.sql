-- مصفوفة RASI للفريق (طلب المهندس رعد): لكل عنصر (قضية/مخالفة/مهمة) أدوار الأعضاء:
-- R منفّذ مسؤول، A معتمد ومساءل (واحد لكل عنصر)، S مساند، I مُبلَّغ.
-- يقرؤها أعضاء الشركة، ويحرّرها أعضاؤها، ومن يُسند إليه دور يعرف من جرس التنبيهات.

create table if not exists public.item_roles (
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('R','A','S','I')),
  set_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index if not exists item_roles_org_idx on public.item_roles (org_id);
-- معتمد واحد (A) لكل عنصر
create unique index if not exists item_roles_one_accountable on public.item_roles (item_id) where role = 'A';

alter table public.item_roles enable row level security;
drop policy if exists item_roles_read on public.item_roles;
create policy item_roles_read on public.item_roles for select using (org_id in (select public.current_org_ids()));
drop policy if exists item_roles_write on public.item_roles;
create policy item_roles_write on public.item_roles for insert with check (org_id in (select public.current_org_ids()));
drop policy if exists item_roles_update on public.item_roles;
create policy item_roles_update on public.item_roles for update using (org_id in (select public.current_org_ids())) with check (org_id in (select public.current_org_ids()));
drop policy if exists item_roles_delete on public.item_roles;
create policy item_roles_delete on public.item_roles for delete using (org_id in (select public.current_org_ids()));

-- إسناد دور = تنبيه داخل المنصة لصاحبه (كما يحدث عند الإسناد)
create or replace function public.notify_item_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text; oname text; ititle text; inum text; rname text;
begin
  if tg_op = 'UPDATE' and new.role = old.role and new.user_id = old.user_id then return new; end if;
  if new.user_id = auth.uid() then return new; end if;
  select coalesce(p.full_name, p.email) into actor from public.profiles p where p.id = auth.uid();
  select name into oname from public.organizations where id = new.org_id;
  select title, item_number into ititle, inum from public.items where id = new.item_id;
  rname := case new.role when 'R' then 'المنفّذ المسؤول (R)' when 'A' then 'المعتمد (A)' when 'S' then 'المساند (S)' else 'المُبلَّغ (I)' end;
  perform public.notify_inapp(new.org_id, new.user_id, jsonb_build_object(
    'kind', 'role',
    'title', 'دورك في «' || coalesce(ititle, '') || '»: ' || rname,
    'org_id', new.org_id, 'org_name', oname, 'actor', actor,
    'item_id', new.item_id, 'item_number', inum, 'item_title', ititle, 'role', new.role));
  return new;
end $$;
drop trigger if exists on_item_role on public.item_roles;
create trigger on_item_role after insert or update of role, user_id on public.item_roles
  for each row execute function public.notify_item_role();

-- أدوار عنصر في نص واحد للبوت والتقارير: "R: أحمد · A: رعد"
create or replace function public.item_roles_text(p_item uuid)
returns text language sql stable security definer set search_path = public as $$
  select string_agg(r.role || ': ' || coalesce(p.full_name, p.email, ''), ' · ' order by array_position(array['A','R','S','I'], r.role))
  from public.item_roles r left join public.profiles p on p.id = r.user_id where r.item_id = p_item
$$;
revoke all on function public.item_roles_text(uuid) from public;
grant execute on function public.item_roles_text(uuid) to anon, authenticated, service_role;

-- نتائج بحث البوت تعرض الأدوار أيضاً
create or replace function public.telegram_search(p_secret text, p_user_id uuid, p_query text, p_limit int default 8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q text; result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  q := '%' || trim(coalesce(p_query, '')) || '%';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'item_number', i.item_number, 'title', i.title, 'due_at', i.due_at, 'status', i.status,
    'client_name', i.client_name, 'case_number', i.case_number, 'amount', i.amount,
    'violation_number', i.data->>'violation_number', 'tracker_name', t.name,
    'attachments', (select count(*) from public.attachments a where a.item_id = i.id),
    'roles', public.item_roles_text(i.id)
  ) order by (i.status = 'open') desc, i.due_at asc nulls last), '[]'::jsonb) into result
  from (
    select i.* from public.items i
    where i.org_id in (select public.telegram_user_orgs(p_user_id))
      and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q)
    order by (i.status = 'open') desc, i.due_at asc nulls last
    limit greatest(1, least(coalesce(p_limit, 8), 20))
  ) i left join public.trackers t on t.id = i.tracker_id;
  return result;
end $$;

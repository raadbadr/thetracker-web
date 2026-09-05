-- «قضايا» / «مخالفات» / «مهام» / «مستندات» بكلمة واحدة: عناصر المستخدم بحسب النوع والحالة (يستعمله وكيل تيليغرام وخادم MCP)
create or replace function public.telegram_items_by_kind(p_secret text, p_user_id uuid, p_kind text default 'all', p_status text default 'open', p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; k text := lower(coalesce(p_kind,'all')); st text := lower(coalesce(p_status,'open'));
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'item_number', x.item_number, 'title', x.title, 'status', x.status, 'due_at', x.due_at,
      'client_name', x.client_name, 'case_number', x.case_number, 'amount', x.amount, 'category', x.category, 'tracker_name', x.tracker_name)
      order by (x.status = 'open') desc, x.due_at asc nulls last, x.created_at desc), '[]'::jsonb)
  into result
  from (
    select i.id, i.item_number, i.title, i.status, i.due_at, i.client_name, i.case_number, i.amount, i.category, i.created_at, t.name as tracker_name
    from public.items i left join public.trackers t on t.id = i.tracker_id
    where i.org_id in (select public.telegram_user_orgs(p_user_id))
      and (st = 'all' or (st = 'open' and i.status = 'open') or (st = 'done' and i.status <> 'open'))
      and (k = 'all'
        or (k = 'case' and (coalesce(t.name,'') ilike '%قض%' or coalesce(t.name,'') ilike '%case%' or coalesce(i.category,'') ilike '%قض%' or i.case_number is not null))
        or (k = 'violation' and (coalesce(t.name,'') ilike '%مخالف%' or coalesce(t.name,'') ilike '%violation%' or coalesce(i.category,'') ilike '%مخالف%'))
        or (k = 'task' and (coalesce(t.name,'') ilike '%مهام%' or coalesce(t.name,'') ilike '%task%' or coalesce(i.category,'') ilike '%مهم%'))
        or (k = 'document' and (coalesce(t.name,'') ilike '%مستند%' or coalesce(t.name,'') ilike '%document%' or i.data ? 'document_kind')))
    order by (i.status = 'open') desc, i.due_at asc nulls last, i.created_at desc
    limit greatest(1, least(coalesce(p_limit, 10), 30))
  ) x;
  return result;
end $$;
revoke all on function public.telegram_items_by_kind(text, uuid, text, text, integer) from public;
grant execute on function public.telegram_items_by_kind(text, uuid, text, text, integer) to anon, service_role;

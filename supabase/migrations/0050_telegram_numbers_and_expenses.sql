-- ============================================================
-- 0050 — البوت يطبع رقم الورقة لا الرقم القياسي، ويعرف المصاريف
--   telegram_items      : أضيفت kind, document_kind, doc_number, issue_date, violation_number
--                         (نفس أسماء telegram_items_by_kind) وبلا item_number إطلاقا
--   telegram_expenses   : إجمالي المصاريف وعددها وأعلى بنودها وآخرها للفترة
-- ============================================================

create or replace function public.telegram_items(p_secret text, p_user_id uuid, p_mode text, p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', x.title, 'due_at', x.due_at, 'tracker_name', x.tracker_name, 'org_name', x.org_name,
           'client_name', x.client_name, 'case_number', x.case_number,
           'kind', public.item_kind(x.category, x.case_number, x.data, x.parent_id),
           'document_kind', x.data->>'document_kind',
           'doc_number', coalesce(x.data->>'number', x.data->'details'->>'cr_number', x.data->'details'->>'vat_number'),
           'issue_date', coalesce(x.data->'details'->>'issue_date', x.data->'details'->>'certificate_date', x.data->>'issue_date'),
           'violation_number', x.data->>'violation_number') order by x.due_at asc), '[]'::jsonb)
  into result
  from (
    select i.title, i.due_at, i.client_name, i.case_number, i.category, i.data, i.parent_id,
           t.name as tracker_name, o.name as org_name
    from public.items i
    left join public.trackers t on t.id = i.tracker_id
    left join public.organizations o on o.id = i.org_id
    where i.org_id in (select public.telegram_user_orgs(p_user_id))
      and i.status = 'open' and i.due_at is not null
      and ((p_mode = 'overdue' and i.due_at < now()) or (p_mode <> 'overdue' and i.due_at >= now()))
    order by i.due_at asc
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  ) x;
  return result;
end $$;

-- المصاريف عناصر في items: data->>'kind' = 'expense' أو تصنيفها كلمة مصروف/مصاريف/expense.
-- الفترة: month (افتراضي) أو week أو year أو all، وبالعربية اسبوع/سنة/الكل.
create or replace function public.telegram_expenses(p_secret text, p_user_id uuid, p_period text default 'month')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_from timestamptz; v_to timestamptz; p text := lower(coalesce(p_period, 'month')); result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;

  v_to := now();
  if p in ('week', 'اسبوع', 'أسبوع') then v_from := date_trunc('week', now());
  elsif p in ('year', 'سنة', 'السنة') then v_from := date_trunc('year', now());
  elsif p in ('all', 'الكل') then v_from := null;
  else p := 'month'; v_from := date_trunc('month', now());
  end if;

  with rows as (
    select i.title, coalesce(i.amount, 0) as amount,
           coalesce(i.due_at, i.created_at) as at,
           coalesce(nullif(i.category, ''), 'بلا بند') as category
    from public.items i
    where i.org_id in (select public.telegram_user_orgs(p_user_id))
      and i.status <> 'cancelled'
      and (coalesce(i.data->>'kind', '') = 'expense'
           or i.category ~* 'مصروف|مصاريف|expense|depense|dépense|اخراجات')
      and (v_from is null or coalesce(i.due_at, i.created_at) >= v_from)
      and coalesce(i.due_at, i.created_at) <= v_to
  )
  select jsonb_build_object(
    'status', 'ok', 'period', p, 'period_start', v_from, 'period_end', v_to, 'currency', 'SAR',
    'total', coalesce((select round(sum(amount)::numeric, 2) from rows), 0),
    'count', (select count(*) from rows),
    'by_category', coalesce((select jsonb_agg(c) from (
        select jsonb_build_object('name', category, 'total', round(sum(amount)::numeric, 2), 'count', count(*)) as c
        from rows group by category order by sum(amount) desc limit 5) t), '[]'::jsonb),
    'latest', coalesce((select jsonb_agg(l) from (
        select jsonb_build_object('title', title, 'amount', round(amount::numeric, 2), 'date', at, 'category', category) as l
        from rows order by at desc limit 5) t2), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke all on function public.telegram_expenses(text, uuid, text) from public;
grant execute on function public.telegram_expenses(text, uuid, text) to service_role, authenticated, anon;

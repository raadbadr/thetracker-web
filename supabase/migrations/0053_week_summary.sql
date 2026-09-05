-- ============================================================
-- 0053 — ملخص الأسبوع من القاعدة لا من الصفوف المحملة
-- بطاقة «ملخص الأسبوع» كانت تحسب من 500 صف محملة مرتبة بالاستحقاق،
-- فتنقص أرقامها عند المنشآت الكبيرة. الدالة تُستدعى من المتصفح بجلسة
-- المستخدم (لا سر Worker)، وتتحقق أنه عضو نشط في الشركة قبل أي رقم.
-- الأسبوع يبدأ الأحد 00:00 بتوقيت الرياض.
-- ============================================================

create or replace function public.week_summary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_this_start timestamptz; v_last_start timestamptz; v_next_start timestamptz; result jsonb;
begin
  if not exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_this_start := (date_trunc('day', now() at time zone 'Asia/Riyadh')
                   - make_interval(days => extract(dow from now() at time zone 'Asia/Riyadh')::int))
                  at time zone 'Asia/Riyadh';
  v_last_start := v_this_start - interval '7 days';
  v_next_start := v_this_start + interval '7 days';

  select jsonb_build_object(
    'week_start', v_this_start,
    'last_week_start', v_last_start,
    'done_this_week',  count(*) filter (where i.status = 'done' and i.updated_at >= v_this_start and i.updated_at < v_next_start),
    'added_this_week', count(*) filter (where i.created_at >= v_this_start and i.created_at < v_next_start),
    'late_this_week',  count(*) filter (where i.status <> 'done' and i.due_at >= v_this_start and i.due_at < v_next_start and i.due_at < now()),
    'done_last_week',  count(*) filter (where i.status = 'done' and i.updated_at >= v_last_start and i.updated_at < v_this_start),
    'added_last_week', count(*) filter (where i.created_at >= v_last_start and i.created_at < v_this_start),
    'late_last_week',  count(*) filter (where i.status <> 'done' and i.due_at >= v_last_start and i.due_at < v_this_start)
  )
  into result
  from public.items i
  where i.org_id = p_org;

  return result;
end $$;

revoke all on function public.week_summary(uuid) from public, anon;
grant execute on function public.week_summary(uuid) to authenticated, service_role;

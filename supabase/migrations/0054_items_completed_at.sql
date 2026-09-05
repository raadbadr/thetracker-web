-- ============================================================
-- 0054 — لحظة الإنجاز تُختم في العنصر نفسه
-- updated_at يتغير بأي تعديل، فكان «منجز هذا الأسبوع» يعني «لُمس هذا
-- الأسبوع». الآن completed_at تُملأ عند الانتقال إلى done وتُصفّر عند
-- إعادة الفتح (كما حدث حين أُعيدت مخالفة أقفلها البوت بالخطأ).
-- ============================================================

alter table public.items add column if not exists completed_at timestamptz;
comment on column public.items.completed_at is 'لحظة انتقال العنصر إلى منجز؛ تُصفّر إذا أُعيد فتحه';

create or replace function public.stamp_completed_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;

revoke all on function public.stamp_completed_at() from public, anon, authenticated;

drop trigger if exists items_stamp_completed_at on public.items;
create trigger items_stamp_completed_at
  before insert or update of status on public.items
  for each row execute function public.stamp_completed_at();

update public.items set completed_at = updated_at
where status = 'done' and completed_at is null;

-- ملخص الأسبوع يعتمد لحظة الإنجاز، وأسماء حقوله لا تتغير
create or replace function public.week_summary(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
    'done_this_week',  count(*) filter (where i.status = 'done' and i.completed_at >= v_this_start and i.completed_at < v_next_start),
    'added_this_week', count(*) filter (where i.created_at >= v_this_start and i.created_at < v_next_start),
    'late_this_week',  count(*) filter (where i.status <> 'done' and i.due_at >= v_this_start and i.due_at < v_next_start and i.due_at < now()),
    'done_last_week',  count(*) filter (where i.status = 'done' and i.completed_at >= v_last_start and i.completed_at < v_this_start),
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

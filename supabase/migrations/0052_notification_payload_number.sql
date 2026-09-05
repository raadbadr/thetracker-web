-- ============================================================
-- 0052 — حمولة التنبيه تحمل رقم الورقة نفسه
-- الجرس في الواجهة يعرض number إن وجد (رقم السجل أو الشهادة أو الدعوى
-- أو المخالفة) بدل الرقم القياسي، فتُشتق بنفس اشتقاق 0051.
-- ============================================================

create or replace function public.generate_due_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare k int := 0; n int := 0; m int := 0;
begin
  -- (0) عنصر له مهلته الخاصة: تعلو على قواعد السجل، وقنواته قناة القاعدة إن وُجدت + داخل الموقع
  insert into public.notifications (org_id, item_id, user_id, channel, scheduled_at, payload, status, sent_at)
  select i.org_id, i.id, mem.user_id, ch, i.due_at - i.remind_before,
         jsonb_build_object('title', i.title, 'due_at', i.due_at, 'tracker_id', i.tracker_id, 'item_number', i.item_number,
           'number', coalesce(i.data->>'number', i.data->'details'->>'cr_number', i.data->'details'->>'vat_number', i.case_number, i.data->>'violation_number')),
         case when ch = 'inapp' then 'sent' else 'pending' end,
         case when ch = 'inapp' then now() else null end
  from public.items i
  cross join lateral unnest(
    coalesce((select r.channels from public.reminder_rules r
              where r.org_id = i.org_id and (r.item_id = i.id or (r.item_id is null and r.tracker_id = i.tracker_id))
              order by (r.item_id is not null) desc limit 1), '{}'::text[]) || array['inapp']) as ch
  join public.org_members mem on mem.org_id = i.org_id and mem.status = 'active'
       and (i.assignee_id is null or mem.user_id = i.assignee_id)
  where i.status = 'open' and i.due_at is not null and i.remind_before is not null
    and i.due_at - i.remind_before <= now() + interval '5 minutes'
    and i.due_at > now() - interval '1 day'
    and not exists (select 1 from public.notifications x
                    where x.item_id = i.id and x.user_id = mem.user_id and x.channel = ch)
  on conflict do nothing;
  get diagnostics k = row_count;

  -- (1) قنوات قواعد التذكير كما كانت + نسخة داخل الموقع
  insert into public.notifications (org_id, item_id, user_id, channel, scheduled_at, payload, status, sent_at)
  select i.org_id, i.id, mem.user_id, ch, i.due_at - make_interval(mins => r.offset_minutes),
         jsonb_build_object('title', i.title, 'due_at', i.due_at, 'tracker_id', i.tracker_id, 'item_number', i.item_number,
           'number', coalesce(i.data->>'number', i.data->'details'->>'cr_number', i.data->'details'->>'vat_number', i.case_number, i.data->>'violation_number')),
         case when ch = 'inapp' then 'sent' else 'pending' end,
         case when ch = 'inapp' then now() else null end
  from public.items i
  join public.reminder_rules r on r.org_id = i.org_id and (r.item_id = i.id or (r.item_id is null and r.tracker_id = i.tracker_id))
  cross join lateral unnest(r.channels || array['inapp']) as ch
  join public.org_members mem on mem.org_id = i.org_id and mem.status = 'active'
       and (r.target = 'all' or mem.user_id = i.assignee_id)
  where i.status = 'open' and i.due_at is not null and i.remind_before is null
    and i.due_at - make_interval(mins => r.offset_minutes) <= now() + interval '5 minutes'
    and i.due_at > now() - interval '1 day'
  on conflict do nothing;
  get diagnostics n = row_count;

  -- (2) عناصر بلا قاعدة تذكير ولا مهلة خاصة: تنبيه داخل الموقع قبل الاستحقاق بيوم
  insert into public.notifications (org_id, item_id, user_id, channel, scheduled_at, payload, status, sent_at)
  select i.org_id, i.id, mem.user_id, 'inapp', i.due_at - interval '1 day',
         jsonb_build_object('title', i.title, 'due_at', i.due_at, 'tracker_id', i.tracker_id, 'item_number', i.item_number,
           'number', coalesce(i.data->>'number', i.data->'details'->>'cr_number', i.data->'details'->>'vat_number', i.case_number, i.data->>'violation_number')),
         'sent', now()
  from public.items i
  join public.org_members mem on mem.org_id = i.org_id and mem.status = 'active'
       and (i.assignee_id is null or mem.user_id = i.assignee_id)
  where i.status = 'open' and i.due_at is not null and i.remind_before is null
    and i.due_at - interval '1 day' <= now() + interval '5 minutes'
    and i.due_at > now() - interval '1 day'
    and not exists (
      select 1 from public.reminder_rules r
      where r.org_id = i.org_id and (r.item_id = i.id or (r.item_id is null and r.tracker_id = i.tracker_id))
    )
    and not exists (
      select 1 from public.notifications x
      where x.item_id = i.id and x.user_id = mem.user_id and x.channel = 'inapp'
    );
  get diagnostics m = row_count;

  return k + n + m;
end $$;

-- ============================================================
-- 0049 — البوت يعرف الفريق وأعباءه، ولكل عنصر مهلة تذكيره
--   telegram_team(secret, user)            : أعضاء الشركة النشطة وعبء كل عضو
--   items.remind_before                    : «نبهني قبل الموعد بكذا» لعنصر بعينه
--   telegram_set_reminder(secret, user, q, before) : يحدد العنصر بالبحث ويحفظ المهلة
--   generate_due_notifications()           : يحترم مهلة العنصر قبل قواعد السجل
-- كل دالة محمية بـ check_worker_secret، ومفاتيح الإخراج كبقية دوال telegram_*.
-- ============================================================

alter table public.items add column if not exists remind_before interval;
comment on column public.items.remind_before is 'مهلة التذكير قبل الاستحقاق لهذا العنصر وحده؛ تعلو على قواعد السجل';

-- ---------- (1) الفريق وأعباؤه ----------
create or replace function public.telegram_team(p_secret text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_name text; v_result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;

  v_org := public.telegram_user_org(p_user_id);
  if v_org is null then return jsonb_build_object('status', 'no_org'); end if;
  select name into v_name from public.organizations where id = v_org;

  select jsonb_build_object(
    'status', 'ok',
    'org', jsonb_build_object('id', v_org, 'name', v_name),
    'members', coalesce(jsonb_agg(m order by m->>'full_name'), '[]'::jsonb)
  )
  into v_result
  from (
    select jsonb_build_object(
      'user_id', mem.user_id,
      'full_name', coalesce(pr.full_name, pr.email, ''),
      'email', pr.email,
      'role', mem.role,
      'department', mem.department,
      'job_title', mem.job_title,
      'open', coalesce(w.open_count, 0),
      'overdue', coalesce(w.overdue_count, 0),
      'next_due', w.next_due,
      'items', coalesce(w.items, '[]'::jsonb)
    ) as m
    from public.org_members mem
    left join public.profiles pr on pr.id = mem.user_id
    left join lateral (
      select count(*) filter (where i.status = 'open') as open_count,
             count(*) filter (where i.status = 'open' and i.due_at < now()) as overdue_count,
             min(i.due_at) filter (where i.status = 'open' and i.due_at >= now()) as next_due,
             (select jsonb_agg(x order by x->>'due_at' nulls last)
                from (
                  select jsonb_build_object(
                    'title', j.title,
                    'case_number', j.case_number,
                    'violation_number', j.data->>'violation_number',
                    'client_name', j.client_name,
                    'due_at', j.due_at,
                    'status', j.status
                  ) as x
                  from public.items j
                  where j.org_id = v_org and j.assignee_id = mem.user_id and j.status = 'open'
                  order by j.due_at asc nulls last
                  limit 5
                ) top5) as items
      from public.items i
      where i.org_id = v_org and i.assignee_id = mem.user_id
    ) w on true
    where mem.org_id = v_org and mem.status = 'active'
  ) rows;

  return v_result;
end $$;

revoke all on function public.telegram_team(text, uuid) from public;
grant execute on function public.telegram_team(text, uuid) to service_role, authenticated, anon;

-- ---------- (2) تذكير خاص بعنصر ----------
-- p_before يقبل «يوم»، «يومين»، «أسبوع»، «ساعة»، «ساعتين»، «30 دقيقة»، «3 days»، أو رقما = أياما.
create or replace function public.telegram_parse_before(p_before text)
returns interval language plpgsql immutable as $$
declare t text := lower(btrim(coalesce(p_before, ''))); v interval; n int;
begin
  if t = '' then return null; end if;
  -- رقم مجرد = أيام («ذكرني قبلها بـ 3») قبل أي تفسير آخر، وإلا قرأه بوستجرس ثواني
  if t ~ '^\d+$' then return make_interval(days => t::int); end if;
  if t ~ 'يومين' then return interval '2 days'; end if;
  if t ~ 'ساعتين' then return interval '2 hours'; end if;
  if t ~ 'نصف\s*ساعة' then return interval '30 minutes'; end if;
  if t ~ 'أسبوعين|اسبوعين' then return interval '14 days'; end if;
  if t ~ 'أسبوع|اسبوع' then return interval '7 days'; end if;
  if t ~ 'شهرين' then return interval '60 days'; end if;
  n := nullif(regexp_replace(t, '\D', '', 'g'), '')::int;
  if t ~ 'دقيق' then return make_interval(mins => coalesce(n, 30)); end if;
  if t ~ 'ساع'  then return make_interval(hours => coalesce(n, 1)); end if;
  if t ~ 'يوم|أيام|ايام' then return make_interval(days => coalesce(n, 1)); end if;
  if t ~ 'شهر|أشهر|اشهر|شهور' then return make_interval(days => 30 * coalesce(n, 1)); end if;
  begin v := t::interval; exception when others then v := null; end;
  return v;
end $$;

create or replace function public.telegram_set_reminder(p_secret text, p_user_id uuid, p_query text, p_before text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare q text; c int; v_int interval; v_id uuid; v_row public.items%rowtype;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;

  v_int := public.telegram_parse_before(p_before);
  if v_int is null or v_int <= interval '0' then
    return jsonb_build_object('status', 'bad_interval', 'given', p_before);
  end if;

  q := '%' || btrim(coalesce(p_query, '')) || '%';
  select count(*) into c
  from public.items i
  where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
    and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q);

  if c = 0 then return jsonb_build_object('status', 'not_found'); end if;
  if c > 1 then
    return jsonb_build_object('status', 'ambiguous', 'candidates', (
      select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'case_number', i.case_number,
                                          'client_name', i.client_name, 'due_at', i.due_at) order by i.due_at asc nulls last)
      from (select * from public.items i
            where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
              and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q)
            order by i.due_at asc nulls last limit 6) i));
  end if;

  update public.items i set remind_before = v_int
  where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
    and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q)
  returning i.* into v_row;

  if v_row.id is null then return jsonb_build_object('status', 'not_found'); end if;

  return jsonb_build_object('status', 'set',
    'title', v_row.title, 'case_number', v_row.case_number,
    'violation_number', v_row.data->>'violation_number',
    'client_name', v_row.client_name, 'due_at', v_row.due_at, 'status', v_row.status,
    'remind_before', v_int::text,
    'remind_at', case when v_row.due_at is null then null else v_row.due_at - v_int end);
end $$;

revoke all on function public.telegram_set_reminder(text, uuid, text, text) from public;
grant execute on function public.telegram_set_reminder(text, uuid, text, text) to service_role, authenticated, anon;

-- ---------- (3) الكرون يحترم مهلة العنصر ----------
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
         jsonb_build_object('title', i.title, 'due_at', i.due_at, 'tracker_id', i.tracker_id, 'item_number', i.item_number),
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
         jsonb_build_object('title', i.title, 'due_at', i.due_at, 'tracker_id', i.tracker_id, 'item_number', i.item_number),
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
         jsonb_build_object('title', i.title, 'due_at', i.due_at, 'tracker_id', i.tracker_id, 'item_number', i.item_number),
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

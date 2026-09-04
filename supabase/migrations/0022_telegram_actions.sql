-- البوت العبقري (طلب المهندس رعد): أفعال بلغة طبيعية (إضافة/إنجاز/إسناد/بحث) وإيجاز صباحي
-- وتجهيز مسائي لجلسات الغد. كل شيء عبر دوال محمية بسر الـ Worker، والقراءة/الكتابة داخل
-- شركات المستخدم الفعّالة فقط.

alter table public.channel_links add column if not exists last_digest_at timestamptz;
alter table public.channel_links add column if not exists last_prep_at timestamptz;

-- شركة المستخدم الافتراضية (يملكها وإلا أول عضوية فعّالة)
create or replace function public.telegram_user_org(p_user_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select o.id from public.organizations o join public.org_members m on m.org_id = o.id
  where m.user_id = p_user_id and m.status = 'active'
  order by (m.role = 'owner') desc, m.created_at asc limit 1
$$;

-- شركات المستخدم كلها (للبحث والإيجاز)
create or replace function public.telegram_user_orgs(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.org_id from public.org_members m where m.user_id = p_user_id and m.status = 'active'
$$;

-- إضافة عنصر: المتتبع حسب النوع (مخالفة/جلسة/مهمة): موجود بالاسم المقارب وإلا يُنشأ
create or replace function public.telegram_add_item(p_secret text, p_user_id uuid, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_kind text; v_tracker uuid; v_tracker_name text; v_id uuid; v_num text; v_new boolean := false;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  v_org := public.telegram_user_org(p_user_id);
  if v_org is null then raise exception 'NO_ORG' using errcode = 'P0001'; end if;
  v_kind := coalesce(p_item->>'kind', 'task');
  select id, name into v_tracker, v_tracker_name from public.trackers
  where org_id = v_org and (
    (v_kind = 'violation' and name ~ 'مخالف') or
    (v_kind = 'session' and name ~ '(جلس|قضاي|دعاو)') or
    (v_kind = 'task' and name ~ '(مهام|مهمة|متابع)'))
  order by created_at asc limit 1;
  if v_tracker is null then
    v_tracker_name := case v_kind when 'violation' then 'المخالفات' when 'session' then 'الجلسات والقضايا' else 'المهام' end;
    select id into v_tracker from public.trackers where org_id = v_org and name = v_tracker_name limit 1;
    if v_tracker is null then
      insert into public.trackers (org_id, name, columns, created_by) values (v_org, v_tracker_name, '[]'::jsonb, p_user_id) returning id into v_tracker;
      insert into public.reminder_rules (org_id, tracker_id, offset_minutes, channels, target) values (v_org, v_tracker, 1440, '{telegram}', 'assignee');
      v_new := true;
    end if;
  end if;
  insert into public.items (org_id, tracker_id, title, category, due_at, status, assignee_id, amount, client_name, case_number, data, created_by)
  values (v_org, v_tracker,
          coalesce(nullif(trim(p_item->>'title'), ''), '-'),
          case v_kind when 'violation' then 'مخالفة' when 'session' then 'جلسة' else nullif(p_item->>'category', '') end,
          nullif(p_item->>'due_at', '')::timestamptz,
          'open',
          p_user_id,
          nullif(p_item->>'amount', '')::numeric,
          nullif(p_item->>'client_name', ''),
          nullif(p_item->>'case_number', ''),
          jsonb_strip_nulls(jsonb_build_object(
            'violation_number', p_item->>'violation_number', 'location', p_item->>'location',
            'notes', p_item->>'notes', 'source', 'telegram')),
          p_user_id)
  returning id, item_number into v_id, v_num;
  return jsonb_build_object('id', v_id, 'item_number', v_num, 'tracker_name', v_tracker_name, 'tracker_new', v_new);
end $$;

-- بحث في عناصر المستخدم بأي مقطع (العنوان، رقم الدعوى، العميل، رقم المخالفة، الرقم القياسي)
create or replace function public.telegram_search(p_secret text, p_user_id uuid, p_query text, p_limit int default 8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q text; result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  q := '%' || trim(coalesce(p_query, '')) || '%';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'item_number', i.item_number, 'title', i.title, 'due_at', i.due_at, 'status', i.status,
    'client_name', i.client_name, 'case_number', i.case_number, 'amount', i.amount,
    'violation_number', i.data->>'violation_number', 'tracker_name', t.name, 'attachments', (select count(*) from public.attachments a where a.item_id = i.id)
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

-- إنجاز عنصر: إن طابق عنصر مفتوح واحد يُنجز، وإلا تُعاد المرشحات ليختار المستخدم
create or replace function public.telegram_complete(p_secret text, p_user_id uuid, p_query text, p_item_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q text; c int; v_id uuid; v_title text; v_num text;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_item_id is not null then
    update public.items set status = 'done' where id = p_item_id and status = 'open' and org_id in (select public.telegram_user_orgs(p_user_id))
    returning id, title, item_number into v_id, v_title, v_num;
    if v_id is null then return jsonb_build_object('status', 'not_found'); end if;
    return jsonb_build_object('status', 'done', 'id', v_id, 'title', v_title, 'item_number', v_num);
  end if;
  q := '%' || trim(coalesce(p_query, '')) || '%';
  select count(*) into c from public.items i
  where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
    and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q);
  if c = 0 then return jsonb_build_object('status', 'not_found'); end if;
  if c > 1 then
    return jsonb_build_object('status', 'ambiguous', 'candidates', (
      select jsonb_agg(jsonb_build_object('id', i.id, 'item_number', i.item_number, 'title', i.title, 'due_at', i.due_at, 'client_name', i.client_name) order by i.due_at asc nulls last)
      from (select * from public.items i where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
            and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q)
            order by i.due_at asc nulls last limit 6) i));
  end if;
  update public.items i set status = 'done'
  where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
    and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q)
  returning i.id, i.title, i.item_number into v_id, v_title, v_num;
  return jsonb_build_object('status', 'done', 'id', v_id, 'title', v_title, 'item_number', v_num);
end $$;

-- إسناد عنصر لعضو (بالاسم أو البريد) — يعيد محادثة تلغرام للمُسنَد إليه إن كانت مربوطة
create or replace function public.telegram_assign(p_secret text, p_user_id uuid, p_query text, p_member text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q text; mq text; v_item uuid; v_title text; v_num text; c int; v_member uuid; v_member_name text; v_chat text; v_lang text;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  q := '%' || trim(coalesce(p_query, '')) || '%'; mq := '%' || trim(coalesce(p_member, '')) || '%';
  select count(*) into c from public.items i where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
    and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q);
  if c = 0 then return jsonb_build_object('status', 'not_found'); end if;
  if c > 1 then return jsonb_build_object('status', 'ambiguous'); end if;
  select i.id, i.title, i.item_number into v_item, v_title, v_num from public.items i where i.status = 'open' and i.org_id in (select public.telegram_user_orgs(p_user_id))
    and (i.title ilike q or i.case_number ilike q or i.client_name ilike q or i.item_number ilike q or (i.data->>'violation_number') ilike q) limit 1;
  select p.id, p.full_name, p.lang into v_member, v_member_name, v_lang from public.profiles p
  join public.org_members m on m.user_id = p.id and m.status = 'active'
  where m.org_id = (select org_id from public.items where id = v_item) and (p.full_name ilike mq or p.email ilike mq)
  order by (p.email ilike mq) desc limit 1;
  if v_member is null then return jsonb_build_object('status', 'no_member'); end if;
  update public.items set assignee_id = v_member where id = v_item;
  select external_id into v_chat from public.channel_links where user_id = v_member and channel = 'telegram' and verified_at is not null;
  return jsonb_build_object('status', 'assigned', 'id', v_item, 'title', v_title, 'item_number', v_num,
                            'member_name', v_member_name, 'member_chat', v_chat, 'member_lang', coalesce(v_lang, 'ar'));
end $$;

-- من يستحق إيجازاً الآن؟ (07:00–07:59 بتوقيته ولم يُرسل اليوم) ومن يستحق تجهيز الغد (18:00–18:59)
create or replace function public.telegram_digest_targets(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'chat_id', cl.external_id, 'lang', coalesce(p.lang, 'ar'), 'tz', coalesce(p.tz, 'Asia/Riyadh'),
                                              'name', p.full_name, 'kind', k.kind)), '[]'::jsonb) into result
  from public.channel_links cl
  join public.profiles p on p.id = cl.user_id
  cross join lateral (
    select 'morning' as kind
    where extract(hour from (now() at time zone coalesce(p.tz, 'Asia/Riyadh'))) = 7
      and (cl.last_digest_at is null or (cl.last_digest_at at time zone coalesce(p.tz, 'Asia/Riyadh'))::date < (now() at time zone coalesce(p.tz, 'Asia/Riyadh'))::date)
    union all
    select 'evening'
    where extract(hour from (now() at time zone coalesce(p.tz, 'Asia/Riyadh'))) = 18
      and (cl.last_prep_at is null or (cl.last_prep_at at time zone coalesce(p.tz, 'Asia/Riyadh'))::date < (now() at time zone coalesce(p.tz, 'Asia/Riyadh'))::date)
  ) k
  where cl.channel = 'telegram' and cl.verified_at is not null and cl.external_id is not null;
  return result;
end $$;

-- محتوى الإيجاز: مواعيد اليوم والغد، مخالفات تقترب مهلتها (3 أيام) بمبالغها، المتأخرات، والمهمَل
create or replace function public.telegram_digest(p_secret text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tz text; d0 timestamptz; d1 timestamptz; d2 timestamptz; result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(p.tz, 'Asia/Riyadh') into tz from public.profiles p where p.id = p_user_id;
  tz := coalesce(tz, 'Asia/Riyadh');
  d0 := ((now() at time zone tz)::date)::timestamp at time zone tz;
  d1 := d0 + interval '1 day'; d2 := d0 + interval '2 days';
  with mine as (
    select i.*, t.name as tracker_name, (select count(*) from public.attachments a where a.item_id = i.id) as attachments
    from public.items i left join public.trackers t on t.id = i.tracker_id
    where i.org_id in (select public.telegram_user_orgs(p_user_id)) and i.status = 'open'
  )
  select jsonb_build_object(
    'today', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'due_at', due_at, 'client_name', client_name, 'case_number', case_number, 'attachments', attachments, 'tracker_name', tracker_name) order by due_at), '[]'::jsonb) from mine where due_at >= d0 and due_at < d1),
    'tomorrow', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'due_at', due_at, 'client_name', client_name, 'case_number', case_number, 'attachments', attachments, 'tracker_name', tracker_name) order by due_at), '[]'::jsonb) from mine where due_at >= d1 and due_at < d2),
    'violations_soon', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'due_at', due_at, 'amount', amount, 'client_name', client_name) order by due_at), '[]'::jsonb) from mine where category = 'مخالفة' and due_at >= d0 and due_at < d0 + interval '3 days'),
    'violations_soon_total', (select coalesce(sum(amount), 0) from mine where category = 'مخالفة' and due_at >= d0 and due_at < d0 + interval '3 days'),
    'overdue_count', (select count(*) from mine where due_at < d0),
    'overdue_amount', (select coalesce(sum(amount), 0) from mine where due_at < d0 and category = 'مخالفة'),
    'neglected', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'client_name', client_name, 'case_number', case_number, 'days', extract(day from now() - updated_at)::int) order by updated_at asc), '[]'::jsonb)
                  from (select * from mine where updated_at < now() - interval '30 days' order by updated_at asc limit 3) n),
    'open_total', (select count(*) from mine)
  ) into result;
  return result;
end $$;

create or replace function public.telegram_mark_digest(p_secret text, p_user_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_kind = 'evening' then update public.channel_links set last_prep_at = now() where user_id = p_user_id and channel = 'telegram';
  else update public.channel_links set last_digest_at = now() where user_id = p_user_id and channel = 'telegram'; end if;
end $$;

revoke all on function public.telegram_user_org(uuid) from public;
revoke all on function public.telegram_user_orgs(uuid) from public;
revoke all on function public.telegram_add_item(text, uuid, jsonb) from public;
revoke all on function public.telegram_search(text, uuid, text, int) from public;
revoke all on function public.telegram_complete(text, uuid, text, uuid) from public;
revoke all on function public.telegram_assign(text, uuid, text, text) from public;
revoke all on function public.telegram_digest_targets(text) from public;
revoke all on function public.telegram_digest(text, uuid) from public;
revoke all on function public.telegram_mark_digest(text, uuid, text) from public;
grant execute on function public.telegram_add_item(text, uuid, jsonb) to anon, service_role;
grant execute on function public.telegram_search(text, uuid, text, int) to anon, service_role;
grant execute on function public.telegram_complete(text, uuid, text, uuid) to anon, service_role;
grant execute on function public.telegram_assign(text, uuid, text, text) to anon, service_role;
grant execute on function public.telegram_digest_targets(text) to anon, service_role;
grant execute on function public.telegram_digest(text, uuid) to anon, service_role;
grant execute on function public.telegram_mark_digest(text, uuid, text) to anon, service_role;

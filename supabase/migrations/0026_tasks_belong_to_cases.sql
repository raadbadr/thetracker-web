-- قاعدة المهندس رعد: "المهمات تُشتق من القضايا والمخالفات — لا شيء فارغ، كل شيء مربوط بشيء".
-- المهمة تحمل parent_id إلى القضية/الجلسة أو المخالفة التي تخدمها، وترث عميلها ورقم دعواها.
alter table public.items add column if not exists parent_id uuid references public.items(id) on delete cascade;
create index if not exists items_parent_idx on public.items (parent_id);

-- مرشّحو الأصل: القضايا/الجلسات والمخالفات المفتوحة في الشركة، مصفّاة بتلميح (رقم دعوى/مخالفة/عميل/عنوان)
create or replace function public.parent_candidates(p_org uuid, p_hint text default null, p_limit int default 8)
returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select i.id, i.item_number, i.title, i.client_name, i.case_number, i.data->>'violation_number' as violation_number, i.due_at, i.category
    from public.items i
    where i.org_id = p_org and i.status = 'open' and i.parent_id is null
      and (i.category in ('جلسة', 'مخالفة') or i.case_number is not null or (i.data->>'violation_number') is not null or i.category is null)
  ), hinted as (
    select * from base
    where p_hint is null or btrim(p_hint) = ''
       or case_number ilike '%' || btrim(p_hint) || '%' or violation_number ilike '%' || btrim(p_hint) || '%'
       or client_name ilike '%' || btrim(p_hint) || '%' or title ilike '%' || btrim(p_hint) || '%' or item_number ilike '%' || btrim(p_hint) || '%'
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'item_number', item_number, 'title', title, 'client_name', client_name,
           'case_number', case_number, 'violation_number', violation_number, 'due_at', due_at) order by due_at asc nulls last), '[]'::jsonb)
  from (select * from hinted order by due_at asc nulls last limit greatest(1, least(coalesce(p_limit, 8), 30))) x
$$;
revoke all on function public.parent_candidates(uuid, text, int) from public;
grant execute on function public.parent_candidates(uuid, text, int) to authenticated, anon, service_role;

-- الإدخال السريع من الموقع: المهمة بلا أصل تُرفض بلطف مع مرشّحين للاختيار
create or replace function public.quick_add_item(p_item jsonb, p_assignee uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_kind text; v_tracker uuid; v_tracker_name text; v_id uuid; v_num text;
        v_parent uuid; v_hint text; v_cands jsonb; v_pclient text; v_pcase text;
begin
  if v_actor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_org := coalesce(nullif(p_item->>'org_id', '')::uuid, public.telegram_user_org(v_actor));
  if v_org is null or v_org not in (select public.current_org_ids()) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_kind := coalesce(nullif(p_item->>'kind', ''), 'task');
  if v_kind = 'task' then
    v_parent := nullif(p_item->>'parent_id', '')::uuid;
    if v_parent is not null and not exists (select 1 from public.items where id = v_parent and org_id = v_org) then v_parent := null; end if;
    if v_parent is null then
      v_hint := coalesce(nullif(p_item->>'case_number', ''), nullif(p_item->>'violation_number', ''), nullif(p_item->>'client_name', ''));
      v_cands := public.parent_candidates(v_org, v_hint, 8);
      if v_hint is not null and jsonb_array_length(v_cands) = 1 then
        v_parent := (v_cands->0->>'id')::uuid;
      else
        if v_hint is not null and jsonb_array_length(v_cands) = 0 then v_cands := public.parent_candidates(v_org, null, 8); end if;
        return jsonb_build_object('status', 'needs_parent', 'candidates', v_cands, 'hint', v_hint);
      end if;
    end if;
    select client_name, case_number into v_pclient, v_pcase from public.items where id = v_parent;
  end if;
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
      insert into public.trackers (org_id, name, columns, created_by) values (v_org, v_tracker_name, '[]'::jsonb, v_actor) returning id into v_tracker;
      insert into public.reminder_rules (org_id, tracker_id, offset_minutes, channels, target) values (v_org, v_tracker, 1440, '{telegram}', 'assignee');
    end if;
  end if;
  insert into public.items (org_id, tracker_id, parent_id, title, category, due_at, status, assignee_id, amount, client_name, case_number, data, created_by)
  values (v_org, v_tracker, v_parent,
          coalesce(nullif(trim(p_item->>'title'), ''), '-'),
          case v_kind when 'violation' then 'مخالفة' when 'session' then 'جلسة' else coalesce(nullif(p_item->>'category', ''), 'مهمة') end,
          nullif(p_item->>'due_at', '')::timestamptz, 'open', p_assignee,
          nullif(p_item->>'amount', '')::numeric,
          coalesce(nullif(p_item->>'client_name', ''), v_pclient), coalesce(nullif(p_item->>'case_number', ''), v_pcase),
          jsonb_strip_nulls(jsonb_build_object('violation_number', p_item->>'violation_number', 'location', p_item->>'location', 'notes', p_item->>'notes', 'source', 'team')),
          v_actor)
  returning id, item_number into v_id, v_num;
  if p_assignee is not null then perform public.distribute_item(v_id, p_assignee, 'R'); end if;
  return jsonb_build_object('status', 'saved', 'id', v_id, 'item_number', v_num, 'tracker_name', v_tracker_name, 'title', p_item->>'title', 'due_at', p_item->>'due_at', 'parent_id', v_parent);
end $$;

-- البوت: القاعدة نفسها (المهمة تحتاج أصلاً، وإلا يعيد المرشّحين ليختار المستخدم بزر)
create or replace function public.telegram_add_item(p_secret text, p_user_id uuid, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_kind text; v_tracker uuid; v_tracker_name text; v_id uuid; v_num text; v_new boolean := false;
        v_parent uuid; v_hint text; v_cands jsonb; v_pclient text; v_pcase text;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  v_org := public.telegram_user_org(p_user_id);
  if v_org is null then raise exception 'NO_ORG' using errcode = 'P0001'; end if;
  v_kind := coalesce(p_item->>'kind', 'task');
  if v_kind = 'task' then
    v_parent := nullif(p_item->>'parent_id', '')::uuid;
    if v_parent is not null and not exists (select 1 from public.items where id = v_parent and org_id = v_org) then v_parent := null; end if;
    if v_parent is null then
      v_hint := coalesce(nullif(p_item->>'case_number', ''), nullif(p_item->>'violation_number', ''), nullif(p_item->>'client_name', ''));
      v_cands := public.parent_candidates(v_org, v_hint, 6);
      if v_hint is not null and jsonb_array_length(v_cands) = 1 then
        v_parent := (v_cands->0->>'id')::uuid;
      else
        if v_hint is not null and jsonb_array_length(v_cands) = 0 then v_cands := public.parent_candidates(v_org, null, 6); end if;
        return jsonb_build_object('status', 'needs_parent', 'candidates', v_cands, 'hint', v_hint);
      end if;
    end if;
    select client_name, case_number into v_pclient, v_pcase from public.items where id = v_parent;
  end if;
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
  insert into public.items (org_id, tracker_id, parent_id, title, category, due_at, status, assignee_id, amount, client_name, case_number, data, created_by)
  values (v_org, v_tracker, v_parent,
          coalesce(nullif(trim(p_item->>'title'), ''), '-'),
          case v_kind when 'violation' then 'مخالفة' when 'session' then 'جلسة' else coalesce(nullif(p_item->>'category', ''), 'مهمة') end,
          nullif(p_item->>'due_at', '')::timestamptz, 'open', p_user_id,
          nullif(p_item->>'amount', '')::numeric,
          coalesce(nullif(p_item->>'client_name', ''), v_pclient), coalesce(nullif(p_item->>'case_number', ''), v_pcase),
          jsonb_strip_nulls(jsonb_build_object('violation_number', p_item->>'violation_number', 'location', p_item->>'location', 'notes', p_item->>'notes', 'source', 'telegram')),
          p_user_id)
  returning id, item_number into v_id, v_num;
  return jsonb_build_object('status', 'saved', 'id', v_id, 'item_number', v_num, 'tracker_name', v_tracker_name, 'tracker_new', v_new, 'parent_id', v_parent);
end $$;

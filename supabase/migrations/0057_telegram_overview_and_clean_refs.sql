-- ============================================================
-- 0057 — نظرة عامة للبوت، وقيمة مرجعية علامة ترقيم فقط تصير null
--   telegram_overview(secret, user)  : إجمالي/مفتوح/منجز، متتبعاته، وأنواعه
--   clean_ref(text)                  : «-»/«—»/«ـ»/N/A/«لا يوجد» ← null
-- حالة حقيقية: عنصر عنوانه «RSK-05092026-0001 · عدم ارتكاب المخالفة…»
-- حمل case_number = «-» (من سجل الخطر نفسه) فحسبه item_kind جلسة قضائية
-- خطأ (coalesce(case_number,'')<>''), وسأل مالك الشركة البوت «هل توجد
-- مخالفات؟» فرد نفيا مجردا بلا نظرة عامة.
-- ============================================================

create or replace function public.clean_ref(v text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when v is null then null
    when btrim(v) = '' then null
    when btrim(v) ~ '^[\s\-–—_ـ]+$' then null
    when lower(btrim(v)) in ('n/a', 'na') then null
    when btrim(v) in ('لا يوجد', 'لايوجد', 'غير محدد', 'غير متوفر') then null
    else v
  end
$$;

revoke all on function public.clean_ref(text) from public, anon;
grant execute on function public.clean_ref(text) to authenticated, service_role;

-- تعبئة تصحيحية لمرة واحدة على الموجود
update public.items set case_number = null
  where case_number is not null and public.clean_ref(case_number) is null;
update public.items set client_name = null
  where client_name is not null and public.clean_ref(client_name) is null;
update public.items set data = jsonb_set(data, '{violation_number}', 'null'::jsonb)
  where data ? 'violation_number' and data->>'violation_number' is not null
    and public.clean_ref(data->>'violation_number') is null;
update public.risks set case_number = null
  where case_number is not null and public.clean_ref(case_number) is null;
update public.risks set client_name = null
  where client_name is not null and public.clean_ref(client_name) is null;

create or replace function public.telegram_add_item(p_secret text, p_user_id uuid, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_kind text; v_tracker uuid; v_tracker_name text; v_id uuid; v_num text; v_new boolean := false;
        v_parent uuid; v_hint text; v_cands jsonb; v_pclient text; v_pcase text; v_case text; v_client text; v_vnum text;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  v_org := public.telegram_user_org(p_user_id);
  if v_org is null then raise exception 'NO_ORG' using errcode = 'P0001'; end if;
  v_kind := coalesce(p_item->>'kind', 'task');
  v_case := public.clean_ref(p_item->>'case_number');
  v_client := public.clean_ref(p_item->>'client_name');
  v_vnum := public.clean_ref(p_item->>'violation_number');
  if v_kind = 'task' then
    v_parent := nullif(p_item->>'parent_id', '')::uuid;
    if v_parent is not null and not exists (select 1 from public.items where id = v_parent and org_id = v_org) then v_parent := null; end if;
    if v_parent is null then
      v_hint := coalesce(v_case, v_vnum, v_client);
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
          coalesce(v_client, v_pclient), coalesce(v_case, v_pcase),
          jsonb_strip_nulls(jsonb_build_object('violation_number', v_vnum, 'location', p_item->>'location', 'notes', p_item->>'notes', 'source', 'telegram')),
          p_user_id)
  returning id, item_number into v_id, v_num;
  return jsonb_build_object('status', 'saved', 'id', v_id, 'item_number', v_num, 'tracker_name', v_tracker_name, 'tracker_new', v_new, 'parent_id', v_parent);
end $$;

create or replace function public.telegram_import(p_secret text, p_user_id uuid, p_filename text, p_sheet text, p_tracker_name text, p_columns jsonb, p_mapping jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_org_name text; v_tracker uuid; v_new boolean := false; v_import uuid;
  v_inserted int := 0; r jsonb; v_assignee uuid; v_email text; v_data jsonb;
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  v_org := public.telegram_user_org(p_user_id);
  if v_org is null then
    raise exception 'NO_ORG' using errcode = 'P0001';
  end if;
  select o.name into v_org_name from public.organizations o where o.id = v_org;

  select id into v_tracker from public.trackers where org_id = v_org and name = p_tracker_name order by created_at asc limit 1;
  if v_tracker is null then
    insert into public.trackers (org_id, name, columns, created_by)
    values (v_org, p_tracker_name, coalesce(p_columns, '[]'::jsonb), p_user_id)
    returning id into v_tracker;
    v_new := true;
  end if;

  insert into public.imports (org_id, tracker_id, filename, rows_count, mapping, created_by)
  values (v_org, v_tracker, p_filename, jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), coalesce(p_mapping, '{}'::jsonb), p_user_id)
  returning id into v_import;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_assignee := null;
    v_email := lower(nullif(r->>'assignee_email', ''));
    if v_email is not null then
      select p.id into v_assignee from public.profiles p
      join public.org_members m on m.user_id = p.id and m.org_id = v_org and m.status = 'active'
      where lower(p.email) = v_email limit 1;
    end if;
    v_data := coalesce(r->'data', '{}'::jsonb);
    if v_data ? 'violation_number' then
      v_data := jsonb_set(v_data, '{violation_number}', to_jsonb(public.clean_ref(v_data->>'violation_number')));
    end if;
    insert into public.items (org_id, tracker_id, import_id, title, category, due_at, status, assignee_id,
                              amount, client_name, case_number, data, created_by)
    values (v_org, v_tracker, v_import,
            coalesce(nullif(trim(r->>'title'), ''), '-'),
            nullif(r->>'category', ''),
            nullif(r->>'due_at', '')::timestamptz,
            case when r->>'status' = 'done' then 'done' else 'open' end,
            v_assignee,
            nullif(r->>'amount', '')::numeric,
            public.clean_ref(nullif(r->>'client_name', '')),
            public.clean_ref(nullif(r->>'case_number', '')),
            v_data,
            p_user_id);
    v_inserted := v_inserted + 1;
  end loop;

  if v_new then
    insert into public.reminder_rules (org_id, tracker_id, offset_minutes, channels, target)
    values (v_org, v_tracker, 1440, '{telegram}', 'assignee');
  end if;

  return jsonb_build_object('inserted', v_inserted, 'tracker_name', p_tracker_name, 'tracker_new', v_new,
                            'org_id', v_org, 'org_name', v_org_name, 'import_id', v_import);
end $$;

-- نظرة عامة للبوت: العدد الكلي والمفتوح والمنجز، ومتتبعاته، وأنواع عناصره
create or replace function public.telegram_overview(p_secret text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_org_name text; result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  v_org := public.telegram_user_org(p_user_id);
  if v_org is null then return jsonb_build_object('status', 'no_org'); end if;
  select name into v_org_name from public.organizations where id = v_org;

  select jsonb_build_object(
    'status', 'ok',
    'org_name', v_org_name,
    'total', (select count(*) from public.items i where i.org_id = v_org),
    'open',  (select count(*) from public.items i where i.org_id = v_org and i.status = 'open'),
    'done',  (select count(*) from public.items i where i.org_id = v_org and i.status = 'done'),
    'trackers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', t.name,
               'open', (select count(*) from public.items i where i.tracker_id = t.id and i.status = 'open'),
               'done', (select count(*) from public.items i where i.tracker_id = t.id and i.status = 'done'),
               'next_due', (select min(i.due_at) from public.items i where i.tracker_id = t.id and i.status = 'open' and i.due_at is not null))
             order by (select count(*) from public.items i where i.tracker_id = t.id and i.status = 'open') desc)
      from public.trackers t where t.org_id = v_org), '[]'::jsonb),
    'kinds', coalesce((
      select jsonb_agg(jsonb_build_object('kind', k.kind, 'open', k.open_count, 'done', k.done_count) order by k.open_count desc)
      from (
        select public.item_kind(i.category, i.case_number, i.data, i.parent_id) as kind,
               count(*) filter (where i.status = 'open') as open_count,
               count(*) filter (where i.status = 'done') as done_count
        from public.items i
        where i.org_id = v_org
        group by 1
      ) k), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke all on function public.telegram_overview(text, uuid) from public;
grant execute on function public.telegram_overview(text, uuid) to service_role, authenticated, anon;

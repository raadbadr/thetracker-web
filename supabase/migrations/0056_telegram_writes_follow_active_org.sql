-- ============================================================
-- 0056 — الكتابة من البوت تذهب إلى الشركة التي اختارها المستخدم
-- كان telegram_user_org يعيد «المالك أولا» متجاهلا الشركة النشطة في
-- channel_links، فيستورد المستخدم ملفا أو يضيف عنصرا فيذهب إلى شركة
-- أخرى بلا أن يشعر. الآن الشركة النشطة أولا (إن كان عضوا نشطا فيها)،
-- وإلا الترتيب القديم: مالك، فمشرف، فالأقدم عضوية.
-- telegram_import صار يمر بها ويعيد org_id وorg_name ليؤكدهما البوت.
-- ============================================================

create or replace function public.telegram_user_org(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.active_org_id
       from public.channel_links l
       join public.org_members m on m.org_id = l.active_org_id and m.user_id = p_user_id and m.status = 'active'
      where l.user_id = p_user_id and l.channel = 'telegram' and l.verified_at is not null and l.active_org_id is not null
      order by l.verified_at desc limit 1),
    (select o.id from public.organizations o
       join public.org_members m on m.org_id = o.id
      where m.user_id = p_user_id and m.status = 'active'
      order by (m.role = 'owner') desc, (m.role = 'admin') desc, m.created_at asc limit 1)
  )
$$;

create or replace function public.telegram_import(p_secret text, p_user_id uuid, p_filename text, p_sheet text, p_tracker_name text, p_columns jsonb, p_mapping jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_org_name text; v_tracker uuid; v_new boolean := false; v_import uuid;
  v_inserted int := 0; r jsonb; v_assignee uuid; v_email text;
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
    insert into public.items (org_id, tracker_id, import_id, title, category, due_at, status, assignee_id,
                              amount, client_name, case_number, data, created_by)
    values (v_org, v_tracker, v_import,
            coalesce(nullif(trim(r->>'title'), ''), '-'),
            nullif(r->>'category', ''),
            nullif(r->>'due_at', '')::timestamptz,
            case when r->>'status' = 'done' then 'done' else 'open' end,
            v_assignee,
            nullif(r->>'amount', '')::numeric,
            nullif(r->>'client_name', ''),
            nullif(r->>'case_number', ''),
            coalesce(r->'data', '{}'::jsonb),
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

-- إدخال سريع من صفحة الفريق (طلب المهندس رعد): سطر واحد يُنشئ العنصر في متتبع نوعه
-- ويوزّعه في اللحظة نفسها (المنفّذ R + المكلَّف، ومن أدخل = المعتمد A).
create or replace function public.quick_add_item(p_item jsonb, p_assignee uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_org uuid; v_kind text; v_tracker uuid; v_tracker_name text; v_id uuid; v_num text;
begin
  if v_actor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_org := coalesce(nullif(p_item->>'org_id', '')::uuid, public.telegram_user_org(v_actor));
  if v_org is null or v_org not in (select public.current_org_ids()) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_kind := coalesce(nullif(p_item->>'kind', ''), 'task');
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
  insert into public.items (org_id, tracker_id, title, category, due_at, status, assignee_id, amount, client_name, case_number, data, created_by)
  values (v_org, v_tracker,
          coalesce(nullif(trim(p_item->>'title'), ''), '-'),
          case v_kind when 'violation' then 'مخالفة' when 'session' then 'جلسة' else nullif(p_item->>'category', '') end,
          nullif(p_item->>'due_at', '')::timestamptz, 'open', p_assignee,
          nullif(p_item->>'amount', '')::numeric, nullif(p_item->>'client_name', ''), nullif(p_item->>'case_number', ''),
          jsonb_strip_nulls(jsonb_build_object('violation_number', p_item->>'violation_number', 'location', p_item->>'location', 'notes', p_item->>'notes', 'source', 'team')),
          v_actor)
  returning id, item_number into v_id, v_num;
  if p_assignee is not null then
    perform public.distribute_item(v_id, p_assignee, 'R');
  end if;
  return jsonb_build_object('id', v_id, 'item_number', v_num, 'tracker_name', v_tracker_name, 'title', p_item->>'title', 'due_at', p_item->>'due_at');
end $$;
revoke all on function public.quick_add_item(jsonb, uuid) from public;
grant execute on function public.quick_add_item(jsonb, uuid) to authenticated;

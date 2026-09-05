-- ============================================================
-- 0042 — ملف القضية: رأس واحد تتعلق به الجلسات والمهام والأحكام
-- والتنفيذ والمستندات. المرحلة عمود عام تحتاجه كل القطاعات،
-- وما يخص المحاكم يبقى داخل بيانات العنصر (قاعدة النواة العامة).
-- ============================================================

alter table public.items add column if not exists stage text;
create index if not exists items_stage_idx on public.items (org_id, stage) where stage is not null;

create or replace function public.item_kind(p_category text, p_case_number text, p_data jsonb, p_parent_id uuid)
returns text language sql immutable as $$
  select coalesce(
    nullif(p_data->>'kind', ''),
    case
      when p_category = 'قضية'  then 'case'
      when p_category = 'جلسة'  then 'session'
      when p_category = 'حكم'   then 'ruling'
      when p_category = 'تنفيذ' then 'execution'
      when p_category = 'مخالفة' or coalesce(p_data->>'violation_number','') <> '' then 'violation'
      when coalesce(p_data->>'document_kind','') <> '' then 'document'
      when p_parent_id is not null then 'task'
      when coalesce(p_case_number, '') <> '' then 'session'
      else 'other'
    end)
$$;

create or replace function public.case_file(p_org uuid, p_case uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_head jsonb; v_kids jsonb;
begin
  if p_org not in (select public.current_org_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select to_jsonb(h) - 'org_id' into v_head
  from (
    select i.id, i.item_number, i.title, i.category, i.status, i.due_at, i.amount,
           i.client_name, i.client_name_en, i.case_number, i.stage, i.assignee_id, i.data, i.org_id,
           public.item_kind(i.category, i.case_number, i.data, i.parent_id) as kind,
           (select count(*) from public.attachments a where a.item_id = i.id) as attachments
    from public.items i where i.id = p_case and i.org_id = p_org
  ) h;
  if v_head is null then return jsonb_build_object('error', 'not_found'); end if;

  select coalesce(jsonb_agg(to_jsonb(k) order by k.due_at nulls last, k.created_at), '[]'::jsonb) into v_kids
  from (
    select i.id, i.item_number, i.title, i.category, i.status, i.due_at, i.amount,
           i.client_name, i.case_number, i.stage, i.assignee_id, i.created_at, i.data,
           public.item_kind(i.category, i.case_number, i.data, i.parent_id) as kind,
           (select count(*) from public.attachments a where a.item_id = i.id) as attachments
    from public.items i
    where i.org_id = p_org
      and i.id <> p_case
      and (i.parent_id = p_case
           or (v_head->>'case_number' is not null and i.case_number = v_head->>'case_number'))
  ) k;

  return jsonb_build_object('head', v_head, 'children', v_kids);
end $$;

revoke all on function public.case_file(uuid, uuid) from public;
grant execute on function public.case_file(uuid, uuid) to authenticated;
grant execute on function public.item_kind(text, text, jsonb, uuid) to authenticated, anon, service_role;

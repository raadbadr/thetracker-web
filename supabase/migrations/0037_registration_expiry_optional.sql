-- ============================================================
-- 0037 — السجل التجاري السعودي الجديد بلا تاريخ انتهاء: شهادة المهندس رعد
-- نفسها تحمل «تاريخ الإصدار» فقط. فبقاء تاريخ الانتهاء إلزامياً كان يمنع
-- صاحب السجل من إنشاء شركته. المستند ورقمه يبقيان إلزاميين، والتاريخ
-- يُسجَّل إن وُجد فيُتابَع تجديده، وإن لم يوجد حُفظت الورقة بلا موعد.
-- ============================================================

create or replace function public.create_org_registered(p_name text, p_entity_type text, p_reg_number text, p_reg_expiry date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_type text; v_kind text; v_num text; v_org uuid; v_tracker uuid; v_item uuid; v_item_num text;
  v_label text; v_plan text; v_exp timestamptz;
begin
  if v_actor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'NAME_REQUIRED' using errcode = 'P0001'; end if;
  v_type := case when p_entity_type in ('company','establishment','freelance','individual','nonprofit','government') then p_entity_type else 'company' end;
  v_num := regexp_replace(coalesce(p_reg_number, ''), '\s', '', 'g');
  if v_type in ('company','establishment') then
    if v_num !~ '^[1247][0-9]{9}$' then raise exception 'REG_NUMBER_INVALID' using errcode = 'P0001'; end if;
    v_kind := 'commercial_register'; v_label := 'السجل التجاري';
  elsif v_type = 'individual' then
    if v_num !~ '^[12][0-9]{9}$' then raise exception 'REG_NUMBER_INVALID' using errcode = 'P0001'; end if;
    v_kind := 'id_document'; v_label := 'الهوية';
  else
    if length(v_num) < 4 then raise exception 'REG_NUMBER_INVALID' using errcode = 'P0001'; end if;
    v_kind := 'license'; v_label := 'الرخصة';
  end if;

  insert into public.organizations (name, owner_id) values (btrim(p_name), v_actor)
  returning id, plan_code into v_org, v_plan;

  insert into public.org_profiles (org_id, entity_type, legal_name, cr_number, license_number, unified_number, updated_by)
  values (v_org, v_type, btrim(p_name),
          case when v_kind = 'commercial_register' then v_num end,
          case when v_kind = 'license' then v_num end,
          case when v_kind = 'id_document' then v_num end,
          v_actor)
  on conflict (org_id) do update set entity_type = excluded.entity_type, legal_name = excluded.legal_name,
    cr_number = coalesce(excluded.cr_number, org_profiles.cr_number), license_number = coalesce(excluded.license_number, org_profiles.license_number),
    unified_number = coalesce(excluded.unified_number, org_profiles.unified_number), updated_by = v_actor, updated_at = now();

  select id into v_tracker from public.trackers where org_id = v_org and name in ('المستندات','Documents','دستاویزات') order by created_at asc limit 1;
  if v_tracker is null then
    insert into public.trackers (org_id, name, columns, created_by) values (v_org, 'المستندات', '[]'::jsonb, v_actor) returning id into v_tracker;
  end if;

  -- التاريخ اختياري: بلا موعد تبقى الورقة محفوظة، ومع موعد تدخل التذكيرات
  v_exp := case when p_reg_expiry is null then null
                else (p_reg_expiry::timestamp + interval '9 hours') at time zone 'Asia/Riyadh' end;

  insert into public.items (org_id, tracker_id, title, category, due_at, status, client_name, data, created_by)
  values (v_org, v_tracker, v_label || ' — ' || btrim(p_name), v_label, v_exp, 'open', btrim(p_name),
          jsonb_build_object('document_kind', v_kind, 'number', v_num, 'issuer',
            case v_kind when 'commercial_register' then 'وزارة التجارة' when 'id_document' then 'وزارة الداخلية' else null end,
            'source', 'org_registration'),
          v_actor)
  returning id, item_number into v_item, v_item_num;

  update public.org_members set department = 'management' where org_id = v_org and user_id = v_actor;

  return jsonb_build_object('id', v_org, 'name', btrim(p_name), 'plan_code', v_plan, 'entity_type', v_type,
                            'document_kind', v_kind, 'item_id', v_item, 'item_number', v_item_num);
end $$;

revoke all on function public.create_org_registered(text, text, text, date) from public;
grant execute on function public.create_org_registered(text, text, text, date) to authenticated;

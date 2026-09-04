-- ============================================================
-- 0038 — المنشأة تحمل اسمين كما يحمل الشخص: عربي وإنجليزي، ويكفي أحدهما.
-- السجل التجاري السعودي نفسه يحمل الاسمين، والفواتير والتقارير
-- والخطابات تحتاج الاسم الإنجليزي حين يكون العميل أو الجهة أجنبية.
-- ============================================================

alter table public.organizations add column if not exists name_en text;
alter table public.org_profiles  add column if not exists legal_name_en text;

-- إنشاء الجهة يقبل الاسمين؛ الإنجليزي اختياري ولا يمنع الإنشاء
create or replace function public.create_org_registered(p_name text, p_entity_type text, p_reg_number text, p_reg_expiry date, p_name_en text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_type text; v_kind text; v_num text; v_org uuid; v_tracker uuid; v_item uuid; v_item_num text;
  v_label text; v_plan text; v_exp timestamptz; v_ar text; v_en text; v_show text;
begin
  if v_actor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_ar := nullif(btrim(coalesce(p_name, '')), '');
  v_en := nullif(btrim(coalesce(p_name_en, '')), '');
  if v_ar is null and v_en is null then raise exception 'NAME_REQUIRED' using errcode = 'P0001'; end if;
  v_show := coalesce(v_ar, v_en);
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

  insert into public.organizations (name, name_en, owner_id) values (v_show, v_en, v_actor)
  returning id, plan_code into v_org, v_plan;

  insert into public.org_profiles (org_id, entity_type, legal_name, legal_name_en, cr_number, license_number, unified_number, updated_by)
  values (v_org, v_type, v_show, v_en,
          case when v_kind = 'commercial_register' then v_num end,
          case when v_kind = 'license' then v_num end,
          case when v_kind = 'id_document' then v_num end,
          v_actor)
  on conflict (org_id) do update set entity_type = excluded.entity_type, legal_name = excluded.legal_name,
    legal_name_en = coalesce(excluded.legal_name_en, org_profiles.legal_name_en),
    cr_number = coalesce(excluded.cr_number, org_profiles.cr_number), license_number = coalesce(excluded.license_number, org_profiles.license_number),
    unified_number = coalesce(excluded.unified_number, org_profiles.unified_number), updated_by = v_actor, updated_at = now();

  select id into v_tracker from public.trackers where org_id = v_org and name in ('المستندات','Documents','دستاویزات') order by created_at asc limit 1;
  if v_tracker is null then
    insert into public.trackers (org_id, name, columns, created_by) values (v_org, 'المستندات', '[]'::jsonb, v_actor) returning id into v_tracker;
  end if;

  v_exp := case when p_reg_expiry is null then null
                else (p_reg_expiry::timestamp + interval '9 hours') at time zone 'Asia/Riyadh' end;

  insert into public.items (org_id, tracker_id, title, category, due_at, status, client_name, data, created_by)
  values (v_org, v_tracker, v_label || ' — ' || v_show, v_label, v_exp, 'open', v_show,
          jsonb_build_object('document_kind', v_kind, 'number', v_num, 'issuer',
            case v_kind when 'commercial_register' then 'وزارة التجارة' when 'id_document' then 'وزارة الداخلية' else null end,
            'party_en', v_en, 'source', 'org_registration'),
          v_actor)
  returning id, item_number into v_item, v_item_num;

  update public.org_members set department = 'management' where org_id = v_org and user_id = v_actor;

  return jsonb_build_object('id', v_org, 'name', v_show, 'name_en', v_en, 'plan_code', v_plan,
                            'entity_type', v_type, 'item_id', v_item, 'item_number', v_item_num);
end $$;

revoke all on function public.create_org_registered(text, text, text, date, text) from public;
grant execute on function public.create_org_registered(text, text, text, date, text) to authenticated;

-- إعادة التسمية تقبل الاسمين معاً
create or replace function public.rename_org(p_org uuid, p_name text, p_name_en text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ar text; v_en text; v_show text;
begin
  if not public.is_org_admin(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_ar := nullif(btrim(coalesce(p_name, '')), '');
  v_en := nullif(btrim(coalesce(p_name_en, '')), '');
  if v_ar is null and v_en is null then raise exception 'NAME_REQUIRED' using errcode = 'P0001'; end if;
  v_show := coalesce(v_ar, v_en);
  update public.organizations set name = v_show, name_en = v_en where id = p_org;
  update public.org_profiles set legal_name = v_show,
         legal_name_en = coalesce(v_en, legal_name_en), updated_at = now()
   where org_id = p_org;
  return jsonb_build_object('id', p_org, 'name', v_show, 'name_en', v_en);
end $$;

revoke all on function public.rename_org(uuid, text, text) from public;
grant execute on function public.rename_org(uuid, text, text) to authenticated;

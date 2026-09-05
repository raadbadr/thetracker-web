-- بيانات شركة المستخدم المسجلة (السجل، الضريبي، الآيبان، العنوان) وأوراقها المرفوعة: يجيب منها الوكيل «كم رقم السجل التجاري؟»
create or replace function public.telegram_company_profile(p_secret text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'org_id', o.id, 'name', o.name, 'name_en', o.name_en, 'role', m.role, 'plan', o.plan_code, 'plan_expires_at', o.plan_expires_at,
      'entity_type', p.entity_type, 'legal_name', p.legal_name, 'legal_name_en', p.legal_name_en,
      'cr_number', p.cr_number, 'vat_number', p.vat_number, 'unified_number', p.unified_number, 'license_number', p.license_number,
      'national_address', p.national_address, 'phone', p.phone, 'email', p.email, 'website', p.website,
      'iban', p.iban, 'bank_name', p.bank_name, 'account_name', p.account_name,
      'documents', (select coalesce(jsonb_agg(jsonb_build_object('item_number', i.item_number, 'title', i.title, 'kind', i.data->>'document_kind',
                      'number', i.data->>'number', 'issuer', i.data->>'issuer', 'expires_at', i.due_at, 'details', i.data->'details',
                      'files', (select count(*) from public.attachments a where a.item_id = i.id)) order by i.created_at), '[]'::jsonb)
                    from public.items i where i.org_id = o.id and i.data ? 'document_kind'))
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, (p.cr_number is not null) desc, o.created_at desc), '[]'::jsonb)
  into result
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  left join public.org_profiles p on p.org_id = o.id
  where m.user_id = p_user_id and m.status = 'active';
  return result;
end $$;
revoke all on function public.telegram_company_profile(text, uuid) from public;
grant execute on function public.telegram_company_profile(text, uuid) to anon, service_role;

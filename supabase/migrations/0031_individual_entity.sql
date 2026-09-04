-- ============================================================
-- 0031 — الحساب الفردي: المنصة تقبل الشخص كما تقبل المنشأة.
-- التجاري عندنا: شركة، مؤسسة، وثيقة عمل حر. وما عداه شخص أو موظف
-- يريد ترتيب أوراقه، فله نوع خاص وأوراقه الشخصية المتوقعة.
-- ============================================================

alter table public.org_profiles drop constraint if exists org_profiles_entity_type_check;
alter table public.org_profiles add constraint org_profiles_entity_type_check
  check (entity_type in ('individual','company','establishment','freelance','nonprofit','government'));

-- الأوراق المتوقعة من الشخص: هويته وما يتجدد معه من رخص وعقود.
insert into public.required_docs (entity_type, kind, required, renews, sort_order) values
  ('individual','id_document',true,true,1),
  ('individual','passport',false,true,2),
  ('individual','driving_license',false,true,3),
  ('individual','vehicle_registration',false,true,4),
  ('individual','insurance_policy',false,true,5),
  ('individual','employment_contract',false,true,6),
  ('individual','lease_contract',false,true,7)
on conflict (entity_type, kind) do update
  set required = excluded.required, renews = excluded.renews, sort_order = excluded.sort_order;

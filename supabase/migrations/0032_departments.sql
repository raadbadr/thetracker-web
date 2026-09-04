-- تخصيص الرؤية حسب القسم (قرار المهندس رعد 2026-09-04): المالك والمشرف يرون كل شيء؛
-- القانوني لا يرى مصاريف التشغيل، الموارد البشرية لا تراها كذلك، المالية لا ترى القضايا.
-- القسم صفة على العضوية، وخريطة «قسم ← خدمات» في القاعدة، والدالة my_services هي الحكم.

alter table public.org_members add column if not exists department text
  check (department is null or department in ('management','legal','hr','finance','operations','other'));

-- المالك مديرٌ بطبيعته
update public.org_members set department = 'management' where role = 'owner' and department is null;

create table if not exists public.department_services (
  department text not null,
  service text not null,
  primary key (department, service)
);
alter table public.department_services enable row level security;
drop policy if exists department_services_read on public.department_services;
create policy department_services_read on public.department_services for select using (auth.uid() is not null);

-- الخدمات: dashboard, cases, violations, expenses, documents, processes, risks, team, settings
insert into public.department_services (department, service) values
  ('management','dashboard'),('management','cases'),('management','violations'),('management','expenses'),('management','documents'),('management','processes'),('management','risks'),('management','team'),('management','settings'),
  ('legal','dashboard'),('legal','cases'),('legal','violations'),('legal','documents'),('legal','processes'),('legal','risks'),('legal','team'),('legal','settings'),
  ('hr','dashboard'),('hr','team'),('hr','documents'),('hr','processes'),('hr','settings'),
  ('finance','dashboard'),('finance','expenses'),('finance','violations'),('finance','documents'),('finance','settings'),
  ('operations','dashboard'),('operations','processes'),('operations','risks'),('operations','documents'),('operations','team'),('operations','settings'),
  ('other','dashboard'),('other','documents'),('other','settings')
on conflict do nothing;

-- خدمات المستخدم الحالي في شركة بعينها: المالك/المشرف/الإدارة = الكل، وغيرهم بحسب قسمهم (بلا قسم = other)
create or replace function public.my_services(p_org uuid)
returns text[] language sql stable security definer set search_path = public as $$
  with me as (
    select m.role, coalesce(m.department, case when m.role in ('owner','admin') then 'management' else 'other' end) as department
    from public.org_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
    limit 1
  )
  select case
    when not exists (select 1 from me) then '{}'::text[]
    when (select role from me) in ('owner','admin') or (select department from me) = 'management'
      then (select array_agg(distinct service order by service) from public.department_services)
    else (select coalesce(array_agg(ds.service order by ds.service), '{}'::text[])
          from public.department_services ds where ds.department = (select department from me))
  end
$$;
revoke all on function public.my_services(uuid) from public;
grant execute on function public.my_services(uuid) to authenticated;

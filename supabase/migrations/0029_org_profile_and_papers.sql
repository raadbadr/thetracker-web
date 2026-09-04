-- ============================================================
-- 0029 — النواة المشتركة لكل منشأة: بطاقة المنشأة، أوراقها الرسمية،
-- حالتها، وأشخاصها. لا اسم قطاع في هذا الملف: ما فيه يخدم مكتب المحاماة
-- والعيادة والمكتب الهندسي وصاحب وثيقة العمل الحر بالقدر نفسه.
-- ============================================================

-- ---------- 1) بطاقة المنشأة ----------
create table if not exists public.org_profiles (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  entity_type text not null default 'company'
    check (entity_type in ('company','establishment','freelance','nonprofit','government')),
  legal_name text,
  cr_number text,
  vat_number text,
  unified_number text,
  license_number text,
  national_address jsonb not null default '{}'::jsonb,
  phone text,
  email text,
  website text,
  iban text,
  bank_name text,
  account_name text,
  logo_attachment_id uuid references public.attachments(id) on delete set null,
  notes text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_profiles enable row level security;

drop policy if exists org_profiles_read on public.org_profiles;
create policy org_profiles_read on public.org_profiles for select
  using (org_id in (select public.current_org_ids()));

drop policy if exists org_profiles_write on public.org_profiles;
create policy org_profiles_write on public.org_profiles for insert
  with check (public.is_org_admin(org_id));

drop policy if exists org_profiles_update on public.org_profiles;
create policy org_profiles_update on public.org_profiles for update
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop trigger if exists org_profiles_touch on public.org_profiles;
create trigger org_profiles_touch before update on public.org_profiles
  for each row execute function public.touch_updated_at();

-- ---------- 2) الأوراق الرسمية المتوقعة لكل نوع منشأة ----------
-- جدول مرجعي عام (إعداد لا بيانات عمل): يقرؤه الجميع ولا يكتبه أحد من التطبيق.
create table if not exists public.required_docs (
  entity_type text not null,
  kind text not null,
  required boolean not null default true,
  renews boolean not null default true,
  sort_order int not null default 0,
  primary key (entity_type, kind)
);

alter table public.required_docs enable row level security;

drop policy if exists required_docs_read on public.required_docs;
create policy required_docs_read on public.required_docs for select
  using (auth.uid() is not null);

insert into public.required_docs (entity_type, kind, required, renews, sort_order) values
  ('company','commercial_register',true,true,1),
  ('company','articles_of_association',true,false,2),
  ('company','bylaws',false,false,3),
  ('company','vat_certificate',true,false,4),
  ('company','zakat_certificate',true,true,5),
  ('company','gosi_certificate',true,true,6),
  ('company','saudization_certificate',true,true,7),
  ('company','chamber_certificate',true,true,8),
  ('company','license',false,true,9),
  ('company','lease_contract',true,true,10),

  ('establishment','commercial_register',true,true,1),
  ('establishment','vat_certificate',false,false,2),
  ('establishment','zakat_certificate',true,true,3),
  ('establishment','gosi_certificate',true,true,4),
  ('establishment','saudization_certificate',false,true,5),
  ('establishment','chamber_certificate',true,true,6),
  ('establishment','license',false,true,7),
  ('establishment','lease_contract',true,true,8),

  ('freelance','license',true,true,1),
  ('freelance','id_document',true,true,2),
  ('freelance','vat_certificate',false,false,3),
  ('freelance','lease_contract',false,true,4),

  ('nonprofit','license',true,true,1),
  ('nonprofit','bylaws',true,false,2),
  ('nonprofit','zakat_certificate',false,true,3),
  ('nonprofit','lease_contract',false,true,4),

  ('government','license',false,true,1),
  ('government','lease_contract',false,true,2)
on conflict (entity_type, kind) do update
  set required = excluded.required, renews = excluded.renews, sort_order = excluded.sort_order;

-- ---------- 3) حالة أوراق المنشأة ----------
-- لكل ورقة متوقعة: هل هي محفوظة، ومتى تنتهي، وكم بقي، وما حالتها.
-- الورقة عنصر في items يحمل data->>'document_kind' وdue_at تاريخ انتهائه.
create or replace function public.org_documents_status(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with prof as (
    select coalesce((select entity_type from public.org_profiles where org_id = p_org), 'company') as entity_type
  ),
  expected as (
    select r.kind, r.required, r.renews, r.sort_order
    from public.required_docs r, prof
    where r.entity_type = prof.entity_type
  ),
  latest as (
    select distinct on (i.data->>'document_kind')
           i.data->>'document_kind' as kind,
           i.id, i.item_number, i.title, i.due_at, i.status,
           i.data->>'number' as number
    from public.items i
    where i.org_id = p_org
      and i.status <> 'cancelled'
      and coalesce(i.data->>'document_kind','') <> ''
    order by i.data->>'document_kind', i.due_at desc nulls last, i.created_at desc
  )
  select case when (select count(*) from public.org_members m
                    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active') = 0
              then jsonb_build_object('error','forbidden')
         else jsonb_build_object(
           'entity_type', (select entity_type from prof),
           'papers', coalesce((
             select jsonb_agg(jsonb_build_object(
               'kind', e.kind,
               'required', e.required,
               'renews', e.renews,
               'item_id', l.id,
               'item_number', l.item_number,
               'title', l.title,
               'number', l.number,
               'expires_at', l.due_at,
               'days_left', case when l.due_at is null then null
                                 else floor(extract(epoch from (l.due_at - now())) / 86400)::int end,
               'state', case
                 when l.id is null then 'missing'
                 when l.due_at is null then 'stored'
                 when l.due_at < now() then 'expired'
                 when l.due_at < now() + interval '30 days' then 'expiring'
                 else 'valid' end
             ) order by e.sort_order)
             from expected e left join latest l on l.kind = e.kind
           ), '[]'::jsonb),
           'extra', coalesce((
             select jsonb_agg(jsonb_build_object('kind', l.kind, 'item_id', l.id, 'title', l.title, 'expires_at', l.due_at))
             from latest l where l.kind not in (select kind from expected)
           ), '[]'::jsonb)
         ) end
$$;

revoke all on function public.org_documents_status(uuid) from public;
grant execute on function public.org_documents_status(uuid) to authenticated, service_role;

-- ---------- 4) الأشخاص: المسمى الوظيفي وصفة الشخص ----------
alter table public.org_members add column if not exists job_title text;
alter table public.org_members add column if not exists person_kind text
  check (person_kind is null or person_kind in ('partner','manager','employee','contractor'));

-- ---------- 5) لا سجل بلا تذكير ----------
-- كل سجل جديد يولد قاعدة تذكير افتراضية قبل يوم عبر تيليغرام، في كل القطاعات.
create or replace function public.tracker_default_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.reminder_rules (org_id, tracker_id, offset_minutes, channels, target)
  values (new.org_id, new.id, 1440, '{telegram}', 'assignee');
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists trackers_default_rule on public.trackers;
create trigger trackers_default_rule after insert on public.trackers
  for each row execute function public.tracker_default_rule();

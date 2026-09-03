-- طلبات الترقية تتم داخل الموقع بدل البريد: المسؤول يطلب، ومدير المنصة يوافق.
create table if not exists public.plan_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text not null references public.plans(code),
  months integer not null default 1 check (months between 1 and 36),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  note text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz
);

create index if not exists plan_requests_org_idx on public.plan_requests (org_id, created_at desc);
create index if not exists plan_requests_status_idx on public.plan_requests (status) where status = 'pending';

alter table public.plan_requests enable row level security;

drop policy if exists plan_requests_read on public.plan_requests;
create policy plan_requests_read on public.plan_requests
  for select using (org_id in (select current_org_ids()) or is_platform_admin());

drop policy if exists plan_requests_insert on public.plan_requests;
create policy plan_requests_insert on public.plan_requests
  for insert with check (is_org_admin(org_id) and created_by = auth.uid());

drop policy if exists plan_requests_update on public.plan_requests;
create policy plan_requests_update on public.plan_requests
  for update using (is_platform_admin() or (is_org_admin(org_id) and status = 'pending'))
  with check (is_platform_admin() or (is_org_admin(org_id) and status in ('pending','cancelled')));

grant select, insert, update on public.plan_requests to authenticated;

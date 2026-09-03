-- ============================================================
-- TRACKER — المخطط الأساسي (v1) — 2026-09-03
-- كل الجداول محمية بـ RLS؛ العزل على مستوى الشركة (organization).
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- الباقات ----------
create table if not exists public.plans (
  code text primary key,
  name_ar text not null,
  name_en text not null,
  name_fr text not null,
  name_ur text not null,
  price_monthly_sar numeric(10,2),
  price_yearly_sar numeric(10,2),
  limits jsonb not null default '{}'::jsonb,
  sort_order int not null default 0
);
insert into public.plans (code, name_ar, name_en, name_fr, name_ur, price_monthly_sar, price_yearly_sar, limits, sort_order) values
  ('free',    'مجاني', 'Free',    'Gratuit', 'مفت',   0,    0,    '{"members":1,"items":100,"channels":["email"],"imports_per_month":1,"calendar":["ics"]}', 1),
  ('monthly', 'شهري',  'Monthly', 'Mensuel', 'ماہانہ', 49,   null, '{"members":5,"items":2000,"channels":["email","telegram","whatsapp","sms"],"imports_per_month":null,"calendar":["ics","google"]}', 2),
  ('yearly',  'سنوي',  'Yearly',  'Annuel',  'سالانہ', null, 490,  '{"members":15,"items":20000,"channels":["email","telegram","whatsapp","sms"],"imports_per_month":null,"calendar":["ics","google"],"priority_support":true}', 3)
on conflict (code) do update set
  name_ar = excluded.name_ar, name_en = excluded.name_en, name_fr = excluded.name_fr, name_ur = excluded.name_ur,
  price_monthly_sar = excluded.price_monthly_sar, price_yearly_sar = excluded.price_yearly_sar,
  limits = excluded.limits, sort_order = excluded.sort_order;

-- ---------- الملفات الشخصية ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  lang text not null default 'ar',
  tz text not null default 'Asia/Riyadh',
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email, ''), '@', 1)),
    new.email,
    new.phone
  )
  on conflict (id) do update set email = excluded.email, phone = coalesce(excluded.phone, public.profiles.phone);
  -- قبول الدعوات المعلقة لهذا البريد
  insert into public.org_members (org_id, user_id, role, status, invited_email, invited_by)
  select i.org_id, new.id, i.role, 'active', i.email, i.invited_by
  from public.invitations i
  where new.email is not null and lower(i.email) = lower(new.email) and i.accepted_at is null
  on conflict do nothing;
  update public.invitations set accepted_at = now()
  where new.email is not null and lower(email) = lower(new.email) and accepted_at is null;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- الشركات والأعضاء ----------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  plan_code text not null default 'free' references public.plans(code),
  plan_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  status text not null default 'active' check (status in ('invited','active')),
  invited_email text,
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin','member')),
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invitations_email_idx on public.invitations (lower(email));

-- ---------- المتتبعات والعناصر ----------
create table if not exists public.trackers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text,
  columns jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists trackers_org_idx on public.trackers (org_id);

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid references public.trackers(id) on delete set null,
  filename text,
  rows_count int not null default 0,
  mapping jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists imports_org_idx on public.imports (org_id, created_at desc);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid not null references public.trackers(id) on delete cascade,
  title text not null,
  category text,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  assignee_id uuid references auth.users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  import_id uuid references public.imports(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_org_due_idx on public.items (org_id, due_at);
create index if not exists items_tracker_idx on public.items (tracker_id);
create index if not exists items_assignee_idx on public.items (assignee_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- ---------- التنبيهات ----------
create table if not exists public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid references public.trackers(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  offset_minutes int not null default 1440,
  channels text[] not null default '{email}',
  target text not null default 'assignee' check (target in ('assignee','all')),
  created_at timestamptz not null default now(),
  check (tracker_id is not null or item_id is not null)
);
create index if not exists reminder_rules_org_idx on public.reminder_rules (org_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email','telegram','whatsapp','sms')),
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (item_id, user_id, channel, scheduled_at)
);
create index if not exists notifications_due_idx on public.notifications (status, scheduled_at);

create table if not exists public.channel_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email','telegram','whatsapp','sms')),
  external_id text,
  verify_code text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, channel)
);

create table if not exists public.calendar_tokens (
  token text primary key default encode(gen_random_bytes(24), 'hex'),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, org_id)
);

-- ---------- الاشتراكات (تفعيل يدوي الآن) ----------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text not null references public.plans(code),
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  activated_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists subscriptions_org_idx on public.subscriptions (org_id, created_at desc);

-- ---------- رسائل التواصل من الموقع ----------
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  subject text,
  name text,
  email text,
  message text,
  source text not null default 'web',
  status text not null default 'new',
  created_at timestamptz not null default now()
);

-- ============================================================
-- دوال مساعدة
-- ============================================================
create or replace function public.current_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select org_id from public.org_members where user_id = auth.uid() and status = 'active'
$$;

create or replace function public.is_org_admin(o uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members
    where org_id = o and user_id = auth.uid() and status = 'active' and role in ('owner','admin')
  )
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false)
$$;

-- الباقة الفعّالة للشركة: اشتراك نشط غير منتهٍ، وإلا free
create or replace function public.effective_plan(o uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.plan_code from public.subscriptions s
      where s.org_id = o and s.status = 'active' and (s.expires_at is null or s.expires_at > now())
      order by s.created_at desc limit 1),
    'free')
$$;

-- عند إنشاء شركة: المالك عضو + اشتراك مجاني
create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_members (org_id, user_id, role, status) values (new.id, new.owner_id, 'owner', 'active')
  on conflict do nothing;
  insert into public.subscriptions (org_id, plan_code, status, activated_by, note)
  values (new.id, 'free', 'active', new.owner_id, 'auto');
  return new;
end $$;
drop trigger if exists on_org_created on public.organizations;
create trigger on_org_created after insert on public.organizations
  for each row execute function public.handle_new_org();

-- فرض حدود الباقة من قاعدة البيانات لا من الواجهة
create or replace function public.enforce_item_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; cnt int;
begin
  select (p.limits->>'items')::int into lim from public.plans p where p.code = public.effective_plan(new.org_id);
  if lim is not null then
    select count(*) into cnt from public.items where org_id = new.org_id;
    if cnt >= lim then
      raise exception 'PLAN_LIMIT_ITEMS: الباقة الحالية تسمح بـ % عنصر', lim using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists items_enforce_limit on public.items;
create trigger items_enforce_limit before insert on public.items
  for each row execute function public.enforce_item_limit();

create or replace function public.enforce_member_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; cnt int;
begin
  select (p.limits->>'members')::int into lim from public.plans p where p.code = public.effective_plan(new.org_id);
  if lim is not null then
    select count(*) into cnt from public.org_members where org_id = new.org_id;
    if cnt >= lim then
      raise exception 'PLAN_LIMIT_MEMBERS: الباقة الحالية تسمح بـ % عضو', lim using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists members_enforce_limit on public.org_members;
create trigger members_enforce_limit before insert on public.org_members
  for each row execute function public.enforce_member_limit();

-- أرقام المنصة العامة (أعداد فقط) — تُستدعى من الـ Worker بمفتاح anon
create or replace function public.platform_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'organizations', (select count(*) from public.organizations),
    'trackers', (select count(*) from public.trackers),
    'items', (select count(*) from public.items),
    'itemsUpcoming', (select count(*) from public.items where status = 'open' and due_at >= now()),
    'itemsOverdue', (select count(*) from public.items where status = 'open' and due_at < now()),
    'itemsDone', (select count(*) from public.items where status = 'done'),
    'notifications', (select count(*) from public.notifications where status = 'sent'),
    'notifEmail', (select count(*) from public.notifications where status = 'sent' and channel = 'email'),
    'notifTelegram', (select count(*) from public.notifications where status = 'sent' and channel = 'telegram'),
    'notifWhatsapp', (select count(*) from public.notifications where status = 'sent' and channel = 'whatsapp'),
    'notifSms', (select count(*) from public.notifications where status = 'sent' and channel = 'sms')
  )
$$;
revoke all on function public.platform_stats() from public;
grant execute on function public.platform_stats() to anon, authenticated;

-- توليد التنبيهات المستحقة من القواعد (يستدعيها الـ Worker بمفتاح service role)
create or replace function public.generate_due_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  insert into public.notifications (org_id, item_id, user_id, channel, scheduled_at, payload)
  select i.org_id, i.id, m.user_id, ch, i.due_at - make_interval(mins => r.offset_minutes),
         jsonb_build_object('title', i.title, 'due_at', i.due_at, 'tracker_id', i.tracker_id)
  from public.items i
  join public.reminder_rules r on r.org_id = i.org_id and (r.item_id = i.id or (r.item_id is null and r.tracker_id = i.tracker_id))
  cross join lateral unnest(r.channels) as ch
  join public.org_members m on m.org_id = i.org_id and m.status = 'active'
       and (r.target = 'all' or m.user_id = i.assignee_id)
  where i.status = 'open' and i.due_at is not null
    and i.due_at - make_interval(mins => r.offset_minutes) <= now() + interval '5 minutes'
    and i.due_at > now() - interval '1 day'
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.generate_due_notifications() from public;

-- ============================================================
-- RLS
-- ============================================================
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.invitations enable row level security;
alter table public.trackers enable row level security;
alter table public.imports enable row level security;
alter table public.items enable row level security;
alter table public.reminder_rules enable row level security;
alter table public.notifications enable row level security;
alter table public.channel_links enable row level security;
alter table public.calendar_tokens enable row level security;
alter table public.subscriptions enable row level security;
alter table public.contact_messages enable row level security;

create policy plans_read on public.plans for select using (true);

create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_platform_admin()
         or exists (select 1 from public.org_members a join public.org_members b on a.org_id = b.org_id
                    where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy orgs_read on public.organizations for select using (id in (select public.current_org_ids()) or public.is_platform_admin());
create policy orgs_insert on public.organizations for insert with check (owner_id = auth.uid());
create policy orgs_update on public.organizations for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));
create policy orgs_delete on public.organizations for delete using (owner_id = auth.uid());

create policy members_read on public.org_members for select using (org_id in (select public.current_org_ids()) or public.is_platform_admin());
create policy members_insert on public.org_members for insert with check (public.is_org_admin(org_id));
create policy members_update on public.org_members for update using (public.is_org_admin(org_id));
create policy members_delete on public.org_members for delete using (public.is_org_admin(org_id) or user_id = auth.uid());

create policy invitations_rw on public.invitations for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy trackers_rw on public.trackers for all using (org_id in (select public.current_org_ids())) with check (org_id in (select public.current_org_ids()));
create policy imports_rw on public.imports for all using (org_id in (select public.current_org_ids())) with check (org_id in (select public.current_org_ids()));
create policy items_rw on public.items for all using (org_id in (select public.current_org_ids())) with check (org_id in (select public.current_org_ids()));
create policy rules_rw on public.reminder_rules for all using (org_id in (select public.current_org_ids())) with check (org_id in (select public.current_org_ids()));

create policy notifications_read on public.notifications for select using (org_id in (select public.current_org_ids()));

create policy channel_links_rw on public.channel_links for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy calendar_tokens_rw on public.calendar_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid() and org_id in (select public.current_org_ids()));

create policy subscriptions_read on public.subscriptions for select using (org_id in (select public.current_org_ids()) or public.is_platform_admin());
create policy subscriptions_admin on public.subscriptions for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy contact_insert on public.contact_messages for insert with check (true);
create policy contact_read on public.contact_messages for select using (public.is_platform_admin());

-- ============================================================
-- TheTracker — لا توجد باقة مجانية دائمة (قرار المهندس رعد 2026-09-03)
-- فترة تجريبية 14 يوماً بكل المزايا، ثم اشتراك شهري أو سنوي.
-- بعد انتهاء التجربة تصبح الشركة للقراءة والتصدير فقط (باقة expired).
-- ============================================================
insert into public.plans (code, name_ar, name_en, name_fr, name_ur, price_monthly_sar, price_yearly_sar, limits, sort_order) values
  ('trial', 'التجريبية', 'Trial', 'Essai', 'آزمائشی', 0, 0,
   '{"members":5,"items":2000,"channels":["email","telegram","whatsapp","sms"],"imports_per_month":null,"calendar":["ics","google"],"trial_days":14}', 1),
  ('expired', 'منتهية', 'Expired', 'Expiré', 'ختم شدہ', null, null,
   '{"members":1,"items":0,"channels":["email"],"imports_per_month":0,"calendar":["ics"],"read_only":true}', 9)
on conflict (code) do update set
  name_ar = excluded.name_ar, name_en = excluded.name_en, name_fr = excluded.name_fr, name_ur = excluded.name_ur,
  price_monthly_sar = excluded.price_monthly_sar, price_yearly_sar = excluded.price_yearly_sar,
  limits = excluded.limits, sort_order = excluded.sort_order;

update public.subscriptions set plan_code = 'trial',
       expires_at = coalesce(expires_at, starts_at + interval '14 days')
 where plan_code = 'free';
update public.organizations set plan_code = 'trial' where plan_code = 'free';
alter table public.organizations alter column plan_code set default 'trial';
delete from public.plans where code = 'free';

create or replace function public.effective_plan(o uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.plan_code from public.subscriptions s
      where s.org_id = o and s.status = 'active' and (s.expires_at is null or s.expires_at > now())
      order by s.created_at desc limit 1),
    'expired')
$$;

create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_members (org_id, user_id, role, status) values (new.id, new.owner_id, 'owner', 'active')
  on conflict do nothing;
  insert into public.subscriptions (org_id, plan_code, status, starts_at, expires_at, activated_by, note)
  values (new.id, 'trial', 'active', now(), now() + interval '14 days', new.owner_id, 'trial');
  update public.organizations set plan_code = 'trial', plan_expires_at = now() + interval '14 days' where id = new.id;
  return new;
end $$;

create or replace function public.enforce_item_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; cnt int; pc text;
begin
  pc := public.effective_plan(new.org_id);
  if pc = 'expired' then
    raise exception 'PLAN_EXPIRED: انتهت الفترة التجريبية — فعّل اشتراكاً للمتابعة' using errcode = 'P0001';
  end if;
  select (p.limits->>'items')::int into lim from public.plans p where p.code = pc;
  if lim is not null then
    select count(*) into cnt from public.items where org_id = new.org_id;
    if cnt >= lim then
      raise exception 'PLAN_LIMIT_ITEMS: الباقة الحالية تسمح بـ % عنصر', lim using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function public.enforce_member_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; cnt int; pc text;
begin
  pc := public.effective_plan(new.org_id);
  select (p.limits->>'members')::int into lim from public.plans p where p.code = pc;
  if lim is not null then
    select count(*) into cnt from public.org_members where org_id = new.org_id;
    if cnt >= lim then
      if pc = 'expired' then
        raise exception 'PLAN_EXPIRED: انتهت الفترة التجريبية — فعّل اشتراكاً للمتابعة' using errcode = 'P0001';
      end if;
      raise exception 'PLAN_LIMIT_MEMBERS: الباقة الحالية تسمح بـ % عضو', lim using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.enforce_item_limit() from public, anon, authenticated;
revoke execute on function public.enforce_member_limit() from public, anon, authenticated;
revoke execute on function public.handle_new_org() from public, anon, authenticated;
revoke execute on function public.effective_plan(uuid) from public, anon;
grant execute on function public.effective_plan(uuid) to authenticated;

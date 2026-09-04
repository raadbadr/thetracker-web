-- تخزين ملفات المستخدم في Google Drive الخاص به خياراً (المهندس رعد 2026-09-05):
-- وضع التخزين صفة على الملف الشخصي (مرجع لكل الأجهزة، 'platform' افتراضاً)، والمرفق يحفظ معرّف ملف درايف.
alter table public.profiles add column if not exists storage_mode text not null default 'platform'
  check (storage_mode in ('platform','drive'));
alter table public.attachments add column if not exists drive_file_id text;
create index if not exists attachments_drive_idx on public.attachments (drive_file_id) where drive_file_id is not null;

-- حصة التخزين تُحسب على ما يسكن تخزين المنصة فقط؛ روابط درايف والملفات المحفوظة فيه لا تستهلك الحصة
create or replace function public.enforce_storage_limit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare used bigint; cap bigint;
begin
  if new.storage_path is null then return new; end if;
  select coalesce((p.limits->>'storage_mb')::bigint, 0) * 1024 * 1024 into cap
  from public.plans p where p.code = public.effective_plan(new.org_id);
  if cap is null or cap = 0 then
    raise exception 'PLAN_LIMIT_STORAGE' using errcode = 'check_violation';
  end if;
  select coalesce(sum(a.size_bytes), 0) into used
  from public.attachments a where a.org_id = new.org_id and a.storage_path is not null;
  if used + coalesce(new.size_bytes, 0) > cap then
    raise exception 'PLAN_LIMIT_STORAGE' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- المساحة المجانية للأساسيات (السجل التجاري، العقد التأسيسي، الشهادة الضريبية)؛ الزيادة بالاشتراك أو بدرايف
update public.plans set limits = jsonb_set(limits, '{storage_mb}', '50'::jsonb) where code = 'trial';

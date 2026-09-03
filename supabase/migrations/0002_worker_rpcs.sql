-- ============================================================
-- TheTracker — دوال الـ Worker (بدون مفتاح service role في Cloudflare)
-- الـ Worker يستخدم مفتاح anon + سرّ مشترك (worker_secret) تتحقق منه دوال SECURITY DEFINER.
-- ============================================================
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

create or replace function public.check_worker_secret(p_secret text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_secret, '') <> '' and length(p_secret) >= 32
     and exists (select 1 from public.app_settings where key = 'worker_secret' and value = p_secret)
$$;

-- التنبيهات المعلّقة المستحقة (تولّد أولاً من القواعد)
create or replace function public.cron_pending_notifications(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform public.generate_due_notifications();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'org_id', n.org_id, 'item_id', n.item_id, 'user_id', n.user_id, 'channel', n.channel,
      'title', i.title, 'due_at', i.due_at, 'tracker_name', t.name, 'org_name', o.name,
      'email', p.email, 'lang', p.lang, 'external_id', cl.external_id
    ) order by n.scheduled_at), '[]'::jsonb)
  into result
  from (select * from public.notifications where status = 'pending' and scheduled_at <= now() order by scheduled_at limit 100) n
  join public.items i on i.id = n.item_id
  left join public.trackers t on t.id = i.tracker_id
  left join public.organizations o on o.id = n.org_id
  left join public.profiles p on p.id = n.user_id
  left join public.channel_links cl on cl.user_id = n.user_id and cl.channel = n.channel and cl.verified_at is not null;
  return result;
end $$;

create or replace function public.cron_mark_notification(p_secret text, p_id uuid, p_status text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.notifications
  set status = p_status, error = p_error, sent_at = case when p_status = 'sent' then now() else null end
  where id = p_id;
end $$;

-- تقويم ICS: الرمز نفسه هو السر
create or replace function public.calendar_feed(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; result jsonb;
begin
  select org_id into v_org from public.calendar_tokens where token = p_token;
  if v_org is null then return null; end if;
  select jsonb_build_object(
    'org_name', (select name from public.organizations where id = v_org),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', i.title, 'category', i.category, 'due_at', i.due_at, 'status', i.status, 'tracker_name', t.name
      ) order by i.due_at)
      from public.items i left join public.trackers t on t.id = i.tracker_id
      where i.org_id = v_org and i.due_at is not null and i.status <> 'cancelled'), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ربط قناة برمز التحقق (تيليغرام/واتساب)
create or replace function public.link_channel(p_secret text, p_channel text, p_code text, p_external_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.channel_links
  set external_id = p_external_id, verified_at = now(), verify_code = null
  where channel = p_channel and verify_code = upper(p_code) and verified_at is null
  returning user_id into v_user;
  return v_user;
end $$;

-- هدف الإرسال التجريبي لمستخدم بعينه
create or replace function public.notify_target(p_secret text, p_user_id uuid, p_channel text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'email', (select email from public.profiles where id = p_user_id),
    'lang', coalesce((select lang from public.profiles where id = p_user_id), 'ar'),
    'external_id', (select external_id from public.channel_links where user_id = p_user_id and channel = p_channel and verified_at is not null)
  );
end $$;

revoke all on function public.check_worker_secret(text) from public;
revoke all on function public.cron_pending_notifications(text) from public;
revoke all on function public.cron_mark_notification(text, uuid, text, text) from public;
revoke all on function public.calendar_feed(text) from public;
revoke all on function public.link_channel(text, text, text, text) from public;
revoke all on function public.notify_target(text, uuid, text) from public;
grant execute on function public.check_worker_secret(text) to anon, authenticated, service_role;
grant execute on function public.cron_pending_notifications(text) to anon, service_role;
grant execute on function public.cron_mark_notification(text, uuid, text, text) to anon, service_role;
grant execute on function public.calendar_feed(text) to anon, service_role;
grant execute on function public.link_channel(text, text, text, text) to anon, service_role;
grant execute on function public.notify_target(text, uuid, text) to anon, service_role;

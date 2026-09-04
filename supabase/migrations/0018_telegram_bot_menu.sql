-- بوت تلغرام كامل (طلب المهندس رعد): الربط بضغطة من داخل البوت (زر يفتح الموقع، أو
-- مشاركة رقم الجوال المسجَّل في الملف الشخصي)، وقوائم المواعيد القادمة والمتأخرة.
-- كل الدوال محمية بسر الـ Worker (SECURITY DEFINER).

-- ربط مباشر لمحادثة بحساب مسجَّل (الزر داخل البوت بعد التحقق من الرمز الموقّع)
create or replace function public.link_channel_direct(p_secret text, p_user_id uuid, p_channel text, p_external_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  insert into public.channel_links (user_id, channel, external_id, verify_code, verified_at)
  values (p_user_id, p_channel, p_external_id, null, now())
  on conflict (user_id, channel) do update
    set external_id = excluded.external_id, verify_code = null, verified_at = now();
end $$;
revoke all on function public.link_channel_direct(text, uuid, text, text) from public;
grant execute on function public.link_channel_direct(text, uuid, text, text) to anon, service_role;

-- الربط برقم الجوال الذي شاركه صاحب المحادثة: نطابق آخر 9 أرقام مع رقم الملف الشخصي
create or replace function public.link_channel_by_phone(p_secret text, p_channel text, p_phone text, p_external_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_digits text;
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  if length(v_digits) < 9 then return null; end if;
  select id into v_user from public.profiles
  where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = v_digits
  order by created_at asc limit 1;
  if v_user is null then return null; end if;
  perform public.link_channel_direct(p_secret, v_user, p_channel, p_external_id);
  return v_user;
end $$;
revoke all on function public.link_channel_by_phone(text, text, text, text) from public;
grant execute on function public.link_channel_by_phone(text, text, text, text) to anon, service_role;

-- مواعيد المستخدم عبر شركاته الفعّالة: القادمة (upcoming) أو المتأخرة (overdue)
create or replace function public.telegram_items(p_secret text, p_user_id uuid, p_mode text, p_limit int default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', x.title, 'due_at', x.due_at, 'tracker_name', x.tracker_name, 'org_name', x.org_name,
           'client_name', x.client_name, 'case_number', x.case_number) order by x.due_at asc), '[]'::jsonb)
  into result
  from (
    select i.title, i.due_at, i.client_name, i.case_number, t.name as tracker_name, o.name as org_name
    from public.items i
    left join public.trackers t on t.id = i.tracker_id
    left join public.organizations o on o.id = i.org_id
    where i.org_id in (select m.org_id from public.org_members m where m.user_id = p_user_id and m.status = 'active')
      and i.status = 'open' and i.due_at is not null
      and ((p_mode = 'overdue' and i.due_at < now()) or (p_mode <> 'overdue' and i.due_at >= now()))
    order by i.due_at asc
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  ) x;
  return result;
end $$;
revoke all on function public.telegram_items(text, uuid, text, int) from public;
grant execute on function public.telegram_items(text, uuid, text, int) to anon, service_role;

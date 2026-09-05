-- ============================================================
-- 0060 — إحصاءات المنصة للبوت من القاعدة، لا من خيال النموذج
-- المهندس رعد سأل «كم المسجلين في الموقع» فاخترع النموذج الرقم 5
-- وأسماء لا وجود لها. telegram_platform تعيد الأرقام والأسماء
-- الحقيقية فقط، ومحجوبة عن أي مستخدم ليس مدير منصة.
-- ============================================================

create or replace function public.telegram_platform(p_secret text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_admin boolean; v_week_start timestamptz; result jsonb;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'unauthorized' using errcode = '42501'; end if;

  select coalesce(is_platform_admin, false) into v_admin from public.profiles where id = p_user_id;
  if not coalesce(v_admin, false) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  v_week_start := (date_trunc('day', now() at time zone 'Asia/Riyadh')
                   - make_interval(days => extract(dow from now() at time zone 'Asia/Riyadh')::int))
                  at time zone 'Asia/Riyadh';

  select jsonb_build_object(
    'status', 'ok',
    'users', (select count(*) from public.profiles),
    'orgs', (select count(*) from public.organizations),
    'items', (select count(*) from public.items),
    -- اشتراكات مدفوعة فعلا (لا تجريبية) وسارية الآن؛ صفر صادق أفضل من رقم مزيف
    'active_subscriptions', (
      select count(*) from public.subscriptions s
      where s.status = 'active' and s.plan_code <> 'trial'
        and (s.expires_at is null or s.expires_at > now())
    ),
    'signups_this_week', (select count(*) from public.profiles where created_at >= v_week_start),
    'latest_users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', u.full_name,
        'email_masked', case when u.email is null or position('@' in u.email) = 0 then null
          else left(split_part(u.email, '@', 1), least(2, length(split_part(u.email, '@', 1)))) || '***@' || split_part(u.email, '@', 2)
        end,
        'created_at', u.created_at))
      from (select full_name, email, created_at from public.profiles order by created_at desc limit 10) u
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke all on function public.telegram_platform(text, uuid) from public, anon;
grant execute on function public.telegram_platform(text, uuid) to authenticated, service_role;

create or replace function public.notify_target(p_secret text, p_user_id uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'email', (select email from public.profiles where id = p_user_id),
    'full_name', (select full_name from public.profiles where id = p_user_id),
    'lang', coalesce((select lang from public.profiles where id = p_user_id), 'ar'),
    'tz', coalesce((select tz from public.profiles where id = p_user_id), 'Asia/Riyadh'),
    'org_name', (select o.name from public.organizations o
                 join public.org_members m on m.org_id = o.id
                 where m.user_id = p_user_id and m.status = 'active'
                 order by (m.role = 'owner') desc, m.created_at asc
                 limit 1),
    'external_id', (select external_id from public.channel_links
                    where user_id = p_user_id and channel = p_channel and verified_at is not null)
  );
end $function$;

create or replace function public.cron_pending_notifications(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare result jsonb;
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform public.generate_due_notifications();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'org_id', n.org_id, 'item_id', n.item_id, 'user_id', n.user_id, 'channel', n.channel,
      'title', i.title, 'due_at', i.due_at, 'tracker_name', t.name, 'org_name', o.name,
      'email', p.email, 'lang', p.lang, 'tz', coalesce(p.tz, 'Asia/Riyadh'), 'external_id', cl.external_id
    ) order by n.scheduled_at), '[]'::jsonb)
  into result
  from (select * from public.notifications where status = 'pending' and scheduled_at <= now() order by scheduled_at limit 100) n
  join public.items i on i.id = n.item_id
  left join public.trackers t on t.id = i.tracker_id
  left join public.organizations o on o.id = n.org_id
  left join public.profiles p on p.id = n.user_id
  left join public.channel_links cl on cl.user_id = n.user_id and cl.channel = n.channel and cl.verified_at is not null;
  return result;
end
$function$;

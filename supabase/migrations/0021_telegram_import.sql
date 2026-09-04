-- استيراد إكسل من داخل بوت تلغرام (طلب المهندس رعد): الملف يُقرأ في الـ Worker بمنطق
-- صفحة الاستيراد نفسه، يُعرض ملخصه على المستخدم، وبالتأكيد تُحفظ العناصر في شركته.
-- المسودة بين الخطوتين تُحفظ هنا، والكتابة كلها عبر دوال محمية بسر الـ Worker.

create table if not exists public.telegram_drafts (
  chat_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_drafts enable row level security;
-- لا سياسات: الوصول عبر الدوال المحمية وحدها

create or replace function public.telegram_draft_put(p_secret text, p_chat_id text, p_user_id uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  insert into public.telegram_drafts (chat_id, user_id, payload)
  values (p_chat_id, p_user_id, p_payload)
  on conflict (chat_id) do update set user_id = excluded.user_id, payload = excluded.payload, created_at = now();
end $$;

-- تأخذ المسودة وتحذفها (تنتهي صلاحيتها بعد يوم)
create or replace function public.telegram_draft_take(p_secret text, p_chat_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  delete from public.telegram_drafts
  where chat_id = p_chat_id and created_at > now() - interval '1 day'
  returning jsonb_build_object('user_id', user_id, 'payload', payload) into v;
  delete from public.telegram_drafts where chat_id = p_chat_id;
  return v;
end $$;

-- الاستيراد نفسه: شركة المستخدم (التي يملكها وإلا أول عضوية)، متتبع باسم الورقة (يُنشأ إن لم يوجد)،
-- سجل استيراد، ثم العناصر. حد الباقة يفرضه المحفّز items_enforce_limit كما في الموقع.
create or replace function public.telegram_import(
  p_secret text, p_user_id uuid, p_filename text, p_sheet text, p_tracker_name text,
  p_columns jsonb, p_mapping jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_org_name text; v_tracker uuid; v_new boolean := false; v_import uuid;
  v_inserted int := 0; r jsonb; v_assignee uuid; v_email text;
begin
  if not public.check_worker_secret(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select o.id, o.name into v_org, v_org_name
  from public.organizations o join public.org_members m on m.org_id = o.id
  where m.user_id = p_user_id and m.status = 'active'
  order by (m.role = 'owner') desc, m.created_at asc limit 1;
  if v_org is null then
    raise exception 'NO_ORG' using errcode = 'P0001';
  end if;

  select id into v_tracker from public.trackers where org_id = v_org and name = p_tracker_name order by created_at asc limit 1;
  if v_tracker is null then
    insert into public.trackers (org_id, name, columns, created_by)
    values (v_org, p_tracker_name, coalesce(p_columns, '[]'::jsonb), p_user_id)
    returning id into v_tracker;
    v_new := true;
  end if;

  insert into public.imports (org_id, tracker_id, filename, rows_count, mapping, created_by)
  values (v_org, v_tracker, p_filename, jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), coalesce(p_mapping, '{}'::jsonb), p_user_id)
  returning id into v_import;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_assignee := null;
    v_email := lower(nullif(r->>'assignee_email', ''));
    if v_email is not null then
      select p.id into v_assignee from public.profiles p
      join public.org_members m on m.user_id = p.id and m.org_id = v_org and m.status = 'active'
      where lower(p.email) = v_email limit 1;
    end if;
    insert into public.items (org_id, tracker_id, import_id, title, category, due_at, status, assignee_id,
                              amount, client_name, case_number, data, created_by)
    values (v_org, v_tracker, v_import,
            coalesce(nullif(trim(r->>'title'), ''), '-'),
            nullif(r->>'category', ''),
            nullif(r->>'due_at', '')::timestamptz,
            case when r->>'status' = 'done' then 'done' else 'open' end,
            v_assignee,
            nullif(r->>'amount', '')::numeric,
            nullif(r->>'client_name', ''),
            nullif(r->>'case_number', ''),
            coalesce(r->'data', '{}'::jsonb),
            p_user_id);
    v_inserted := v_inserted + 1;
  end loop;

  if v_new then
    insert into public.reminder_rules (org_id, tracker_id, offset_minutes, channels, target)
    values (v_org, v_tracker, 1440, '{telegram}', 'assignee');
  end if;

  return jsonb_build_object('inserted', v_inserted, 'tracker_name', p_tracker_name, 'tracker_new', v_new,
                            'org_name', v_org_name, 'import_id', v_import);
end $$;

revoke all on function public.telegram_draft_put(text, text, uuid, jsonb) from public;
revoke all on function public.telegram_draft_take(text, text) from public;
revoke all on function public.telegram_import(text, uuid, text, text, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.telegram_draft_put(text, text, uuid, jsonb) to anon, service_role;
grant execute on function public.telegram_draft_take(text, text) to anon, service_role;
grant execute on function public.telegram_import(text, uuid, text, text, text, jsonb, jsonb, jsonb) to anon, service_role;

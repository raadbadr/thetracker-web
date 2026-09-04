-- ترجمة العرض التلقائية (أمر المهندس رعد 2026-09-05): أي نص حر يكتبه مستخدم يظهر لغيره بلغة واجهته.
-- الترجمة تُنتج في الـ Worker وتُخزن هنا مؤقتا بمفتاح تجزئة النص + اللغة الهدف، فلا يُترجم النص نفسه مرتين.
create table if not exists public.translations_cache (
  hash        text primary key,               -- sha256(target || '\n' || text)
  target      text not null,
  source_lang text,
  text_out    text not null,
  model       text,
  hits        integer not null default 0,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
alter table public.translations_cache enable row level security;
-- لا وصول مباشر من العملاء: القراءة والكتابة عبر الـ Worker فقط
revoke all on public.translations_cache from anon, authenticated;

create or replace function public.translations_get(p_secret text, p_hashes text[])
returns table (hash text, text_out text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_worker_secret(p_secret) then raise exception 'forbidden'; end if;
  update public.translations_cache t set hits = t.hits + 1, last_used_at = now() where t.hash = any(p_hashes);
  return query select t.hash, t.text_out from public.translations_cache t where t.hash = any(p_hashes);
end $$;
revoke all on function public.translations_get(text, text[]) from public;
grant execute on function public.translations_get(text, text[]) to anon, service_role;

create or replace function public.translations_put(p_secret text, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.check_worker_secret(p_secret) then raise exception 'forbidden'; end if;
  insert into public.translations_cache (hash, target, source_lang, text_out, model)
  select r->>'hash', r->>'target', r->>'source_lang', r->>'text_out', r->>'model'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where coalesce(r->>'hash','') <> '' and coalesce(r->>'text_out','') <> ''
  on conflict (hash) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.translations_put(text, jsonb) from public;
grant execute on function public.translations_put(text, jsonb) to anon, service_role;

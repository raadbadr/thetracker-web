-- ============================================================
-- 0040 — اسم الطرف أو العميل بالإنجليزية بجوار العربي.
-- الأوراق الرسمية السعودية تُصدر بالاسمين، والفاتورة أو الخطاب
-- الموجه لجهة أجنبية يحتاج الاسم الإنجليزي كما هو في السجل.
-- ============================================================

alter table public.items add column if not exists client_name_en text;
create index if not exists items_client_en_idx on public.items (org_id, client_name_en) where client_name_en is not null;

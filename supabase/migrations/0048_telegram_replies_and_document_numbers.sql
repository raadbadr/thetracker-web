-- (1) ردود البوت تسجل (كانت مرفوضة بقيد action) — (2) الأوراق تعيد رقمها هي وتاريخ إصدارها لا الرقم القياسي فقط
alter table public.telegram_messages drop constraint if exists telegram_messages_action_check;
alter table public.telegram_messages add constraint telegram_messages_action_check check (action = any (array['none','linked','bad_code','reply','agent','menu']));
-- telegram_items_by_kind: يضيف document_kind و doc_number و issue_date و violation_number إلى كل صف (النص الكامل في سجل الهجرة الحي)

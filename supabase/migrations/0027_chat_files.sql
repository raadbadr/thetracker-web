-- ملفات دردشة الفريق (طلب المهندس رعد): الملف يُرفع إلى حاوية attachments بمسار منظّم
-- (الشركة/chat/المحادثة/السنة-الشهر/الملف) وله صف في attachments، والرسالة تشير إليه.
-- وبما أن "كل شيء مربوط بشيء" يمكن ربط الملف بقضية أو مخالفة فيظهر في ملفها أيضاً.
alter table public.team_messages add column if not exists attachment_id uuid references public.attachments(id) on delete set null;
create index if not exists team_messages_attachment_idx on public.team_messages (attachment_id);
alter table public.attachments add column if not exists channel text;           -- 'chat' لملفات الدردشة
alter table public.attachments add column if not exists thread_key text;        -- 'team' أو معرّف العضو في الخاص
create index if not exists attachments_chat_idx on public.attachments (org_id, channel, thread_key, created_at desc);

-- ============================================================
-- 0028 — سدّ ثغرات صلاحيات ظهرت في مراجعة 2026-09-04
-- لا يغيّر أي سلوك يراه المستخدم؛ يمنع فقط ما لا يجوز.
-- ============================================================

-- 1) الدالتان تُستدعيان من داخل دوال SECURITY DEFINER فقط (quick_add_item,
--    telegram_add_item, telegram_search)، ولا ينادي أي عميل مجهول أياً منهما.
--    بقاء منح anon كان يتيح لمن يعرف معرّف الشركة قراءة عناوين العناصر
--    وأسماء العملاء وأرقام الدعاوى بلا تسجيل دخول.
revoke execute on function public.parent_candidates(uuid, text, int) from anon;
revoke execute on function public.item_roles_text(uuid) from anon;

-- 2) المالك محمي من المشرفين: المشرف يدير الأعضاء ولا يمسّ صف المالك،
--    ولا يرقّي أحداً إلى مالك، والمالك لا يحذف عضويته فيُيتّم الشركة.
drop policy if exists members_update on public.org_members;
create policy members_update on public.org_members for update
  using (
    public.is_org_admin(org_id)
    and (role <> 'owner' or user_id = (select auth.uid()))
  )
  with check (
    public.is_org_admin(org_id)
    and (role <> 'owner' or user_id = (select auth.uid()))
  );

drop policy if exists members_delete on public.org_members;
create policy members_delete on public.org_members for delete
  using (
    role <> 'owner'
    and (public.is_org_admin(org_id) or user_id = (select auth.uid()))
  );

-- 3) الرسالة الخاصة لا تُوجَّه إلا لعضو فعّال في الشركة نفسها،
--    والرسالة المرتبطة بعنصر لا تُربط بعنصر من شركة أخرى.
drop policy if exists team_messages_insert on public.team_messages;
create policy team_messages_insert on public.team_messages for insert
  with check (
    org_id in (select public.current_org_ids())
    and author_id = (select auth.uid())
    and (
      to_user_id is null
      or exists (
        select 1 from public.org_members m
        where m.org_id = team_messages.org_id
          and m.user_id = team_messages.to_user_id
          and m.status = 'active'
      )
    )
    and (
      item_id is null
      or exists (
        select 1 from public.items i
        where i.id = team_messages.item_id and i.org_id = team_messages.org_id
      )
    )
  );

-- إنشاء شركة جديدة كان يفشل: سياسة القراءة تعتمد على current_org_ids() وهي دالة
-- STABLE، فلا ترى صف العضوية الذي ينشئه مشغّل on_org_created في نفس الأمر، فيسقط
-- التحقق عند إعادة الصف (RETURNING) ويصل الخطأ للمتصفح.
-- المالك يرى شركته دائماً بصرف النظر عن جدول العضوية.
drop policy if exists orgs_read on public.organizations;
create policy orgs_read on public.organizations
  for select
  using (
    owner_id = auth.uid()
    or id in (select current_org_ids())
    or is_platform_admin()
  );

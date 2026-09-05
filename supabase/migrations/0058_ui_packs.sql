-- حزم الواجهة: الواجهة تصير بيانات لا شيفرة. النواة تبقى عامة، وكل تخصص صف في جدول إعداد.
-- (أمر المهندس رعد 2026-09-05: «نحتاج واجهات متخصصة… الشخص يدخل يحط الواجهة التي تناسب تخصصه»)
-- هذا الترحيل إضافي بحت: لا يمس my_services ولا create_org_registered ولا أي دالة قائمة.

create table if not exists public.ui_packs (
  key             text primary key check (key ~ '^[a-z_]{2,30}$'),
  names           jsonb not null,                 -- {ar,en,fr,ur}
  hints           jsonb not null,                 -- سطر تعريف تحت اسم الحزمة، أربع لغات
  icon            text  not null,                 -- مسار svg لبطاقة الاختيار
  sort_order      int   not null default 100,
  entity_default  text  not null default 'company'
                  check (entity_default in ('company','establishment','freelance','individual','nonprofit','government')),
  entity_choices  text[] not null default '{company,establishment,freelance,individual,nonprofit,government}',
  labels          jsonb not null default '{}'::jsonb,   -- تسميات بديلة لحقول وعناوين عامة
  active          boolean not null default true,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now()
);

create table if not exists public.pack_services (
  pack_key   text not null references public.ui_packs(key) on delete cascade,
  service    text not null,
  sort_order int  not null default 100,
  label      jsonb,                               -- تسمية بديلة في الشريط الجانبي (أو null فالأصل)
  primary key (pack_key, service)
);

-- حزمة الحساب صفة الحساب، وحزمة الملف الشخصي مجرد افتراض للحسابات التالية
alter table public.org_profiles add column if not exists ui_pack text references public.ui_packs(key);
alter table public.profiles    add column if not exists ui_pack text references public.ui_packs(key);

alter table public.ui_packs      enable row level security;
alter table public.pack_services enable row level security;
drop policy if exists ui_packs_read on public.ui_packs;
drop policy if exists pack_services_read on public.pack_services;
create policy ui_packs_read      on public.ui_packs      for select to authenticated using (true);
create policy pack_services_read on public.pack_services for select to authenticated using (true);

-- ــــ الحزمة الافتراضية: القيم الحالية حرفيا، فلوحة اليوم تخرج كما هي بالبكسل نفسه ــــ
insert into public.ui_packs (key, names, hints, icon, sort_order, entity_default, entity_choices, labels, active, is_default) values
 ('legal',
  '{"ar":"شركة أو إدارة قانونية","en":"Company or legal department","fr":"Entreprise ou service juridique","ur":"کمپنی یا قانونی شعبہ"}',
  '{"ar":"قضايا ومخالفات ومستندات وفريق وإجراءات ومخاطر","en":"Cases, violations, documents, team, processes and risks","fr":"Affaires, infractions, documents, equipe, procedures et risques","ur":"مقدمات، خلاف ورزیاں، دستاویزات، ٹیم، طریقہ کار اور خطرات"}',
  'M20 6h-3V4a2 2 0 00-2-2H9a2 2 0 00-2 2v2H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2zM9 4h6v2H9V4zm11 15H4V8h16v11z',
  1, 'company', '{company,establishment,freelance,nonprofit,government}', '{}', true, true),
 ('individual',
  '{"ar":"شخص","en":"Individual","fr":"Particulier","ur":"فرد"}',
  '{"ar":"أوراقك الرسمية ومواعيدها ومهامك ومصاريفك","en":"Your official papers, their dates, your tasks and expenses","fr":"Vos papiers officiels, leurs echeances, vos taches et depenses","ur":"آپ کے سرکاری کاغذات، ان کی تاریخیں، کام اور اخراجات"}',
  'M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5z',
  2, 'individual', '{individual}',
  '{"documentsTitle":{"ar":"أوراقي الرسمية","en":"My papers","fr":"Mes papiers","ur":"میرے کاغذات"},
    "fieldClient":{"ar":"الجهة","en":"Party","fr":"Organisme","ur":"ادارہ"}}',
  true, false),
 ('trainer',
  '{"ar":"مدرب أو محاضر","en":"Trainer or lecturer","fr":"Formateur ou conferencier","ur":"ٹرینر یا لیکچرار"}',
  '{"ar":"دوراتك وجلساتها ومتدربوك وشهاداتك وفواتيرك","en":"Your courses, sessions, attendees, certificates and invoices","fr":"Vos formations, seances, participants, attestations et factures","ur":"آپ کے کورسز، سیشنز، شرکاء، اسناد اور رسیدیں"}',
  'M18 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm0 18H6V4h2v7l2-1.5L12 11V4h6v16z',
  3, 'freelance', '{freelance,establishment,company,individual}',
  '{"fieldClient":{"ar":"الجهة الطالبة","en":"Client organisation","fr":"Organisme demandeur","ur":"درخواست گزار ادارہ"},
    "fieldCaseNumber":{"ar":"رقم الدورة","en":"Course number","fr":"Numero de formation","ur":"کورس نمبر"}}',
  true, false)
on conflict (key) do update set
  names = excluded.names, hints = excluded.hints, icon = excluded.icon, sort_order = excluded.sort_order,
  entity_default = excluded.entity_default, entity_choices = excluded.entity_choices, labels = excluded.labels,
  active = excluded.active, is_default = excluded.is_default;

-- خدمات كل حزمة (الشريط الجانبي وترتيبه). الافتراضية = كل خدمات اليوم بترتيبها.
delete from public.pack_services where pack_key in ('legal','individual','trainer');
insert into public.pack_services (pack_key, service, sort_order, label) values
 ('legal','dashboard',1,null), ('legal','cases',2,null), ('legal','violations',3,null), ('legal','expenses',4,null),
 ('legal','documents',5,null), ('legal','processes',6,null), ('legal','risks',7,null), ('legal','team',8,null), ('legal','settings',9,null),

 ('individual','dashboard',1,'{"ar":"لوحتي","en":"My board","fr":"Mon tableau","ur":"میرا بورڈ"}'),
 ('individual','documents',2,'{"ar":"أوراقي الرسمية","en":"My papers","fr":"Mes papiers","ur":"میرے کاغذات"}'),
 ('individual','expenses',3,'{"ar":"مصاريفي","en":"My expenses","fr":"Mes depenses","ur":"میرے اخراجات"}'),
 ('individual','settings',4,null),

 ('trainer','dashboard',1,null),
 ('trainer','cases',2,'{"ar":"الدورات","en":"Courses","fr":"Formations","ur":"کورسز"}'),
 ('trainer','documents',3,'{"ar":"الشهادات والمستندات","en":"Certificates and documents","fr":"Attestations et documents","ur":"اسناد اور دستاویزات"}'),
 ('trainer','expenses',4,'{"ar":"الفواتير والمصاريف","en":"Invoices and expenses","fr":"Factures et depenses","ur":"رسیدیں اور اخراجات"}'),
 ('trainer','team',5,'{"ar":"المدربون والمساعدون","en":"Trainers and assistants","fr":"Formateurs et assistants","ur":"ٹرینرز اور معاونین"}'),
 ('trainer','settings',6,null);

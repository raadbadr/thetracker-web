-- ترتيب الواجهات كما حدده المهندس رعد 2026-09-06: شخص، ثم كيان تجاري (وثيقة عمل حر أو مؤسسة أو شركة)،
-- ثم مدرب أو محاضر، ثم إدارة قانونية. القضايا والمخالفات للإدارة القانونية وحدها، فالكيان التجاري يخلو منها.
-- الافتراضية تبقى الإدارة القانونية، فكل حساب قائم يبقى على شريطه الحالي حرفيا حتى يختار صاحبه غيره.
insert into public.ui_packs (key, names, hints, icon, sort_order, entity_default, entity_choices, labels, active, is_default) values
 ('individual',
  '{"ar":"شخص","en":"Individual","fr":"Particulier","ur":"فرد"}',
  '{"ar":"أوراقك الرسمية ومواعيدها ومهامك ومصاريفك","en":"Your official papers, their dates, your tasks and expenses","fr":"Vos papiers officiels, leurs echeances, vos taches et depenses","ur":"آپ کے سرکاری کاغذات، ان کی تاریخیں، کام اور اخراجات"}',
  'M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5z',
  1, 'individual', '{individual}',
  '{"documentsTitle":{"ar":"أوراقي الرسمية","en":"My papers","fr":"Mes papiers","ur":"میرے کاغذات"},"fieldClient":{"ar":"الجهة","en":"Party","fr":"Organisme","ur":"ادارہ"}}',
  true, false),
 ('business',
  '{"ar":"كيان تجاري","en":"Business entity","fr":"Entite commerciale","ur":"تجارتی ادارہ"}',
  '{"ar":"وثيقة عمل حر أو مؤسسة أو شركة: لوحة ومصاريف ومستندات وفريق وإجراءات ومخاطر","en":"Freelance permit, establishment or company: its papers, expenses and team","fr":"Permis freelance, etablissement ou societe : papiers, depenses et equipe","ur":"فری لانس اجازت نامہ، ادارہ یا کمپنی: کاغذات، اخراجات اور ٹیم"}',
  'M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z',
  2, 'company', '{company,establishment,freelance}', '{}', true, false),
 ('trainer',
  '{"ar":"مدرب أو محاضر","en":"Trainer or lecturer","fr":"Formateur ou conferencier","ur":"ٹرینر یا لیکچرار"}',
  '{"ar":"دوراتك وجلساتها ومتدربوك وشهاداتك وفواتيرك","en":"Your courses, sessions, attendees, certificates and invoices","fr":"Vos formations, seances, participants, attestations et factures","ur":"آپ کے کورسز، سیشنز، شرکاء، اسناد اور رسیدیں"}',
  'M18 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm0 18H6V4h2v7l2-1.5L12 11V4h6v16z',
  3, 'freelance', '{freelance,establishment,company,individual}',
  '{"fieldClient":{"ar":"الجهة الطالبة","en":"Client organisation","fr":"Organisme demandeur","ur":"درخواست گزار ادارہ"},"fieldCaseNumber":{"ar":"رقم الدورة","en":"Course number","fr":"Numero de formation","ur":"کورس نمبر"}}',
  true, false),
 ('legal',
  '{"ar":"إدارة قانونية","en":"Legal department","fr":"Service juridique","ur":"قانونی شعبہ"}',
  '{"ar":"قضايا ومخالفات ومستندات وفريق وإجراءات ومخاطر","en":"Cases, violations, documents, team, processes and risks","fr":"Affaires, infractions, documents, equipe, procedures et risques","ur":"مقدمات، خلاف ورزیاں، دستاویزات، ٹیم، طریقہ کار اور خطرات"}',
  'M12 3l9 4v6c0 5.25-3.75 10.15-9 11.5C6.75 23.15 3 18.25 3 13V7l9-4zm-1 6v2H9v2h2v2h2v-2h2v-2h-2V9h-2z',
  4, 'company', '{company,establishment,nonprofit,government,freelance}', '{}', true, true)
on conflict (key) do update set
  names = excluded.names, hints = excluded.hints, icon = excluded.icon, sort_order = excluded.sort_order,
  entity_default = excluded.entity_default, entity_choices = excluded.entity_choices, labels = excluded.labels,
  active = excluded.active, is_default = excluded.is_default;

-- «كل الشركات تحتاج لوحة تحكم ومصاريف التشغيل والمستندات، والباقي يفصل حسب كل تخصص»:
-- النواة المشتركة في كل حزمة (لوحة + مصاريف + مستندات + إعدادات)، وما بعدها تخصص.
delete from public.pack_services where pack_key in ('individual','business','trainer');
insert into public.pack_services (pack_key, service, sort_order, label) values
 ('individual','dashboard',1,'{"ar":"لوحتي","en":"My board","fr":"Mon tableau","ur":"میرا بورڈ"}'),
 ('individual','documents',2,'{"ar":"أوراقي الرسمية","en":"My papers","fr":"Mes papiers","ur":"میرے کاغذات"}'),
 ('individual','expenses',3,'{"ar":"مصاريفي","en":"My expenses","fr":"Mes depenses","ur":"میرے اخراجات"}'),
 ('individual','settings',4,null),
 ('business','dashboard',1,null), ('business','expenses',2,null), ('business','documents',3,null),
 ('business','team',4,null), ('business','processes',5,null), ('business','risks',6,null), ('business','settings',7,null),
 ('trainer','dashboard',1,null),
 ('trainer','cases',2,'{"ar":"الدورات","en":"Courses","fr":"Formations","ur":"کورسز"}'),
 ('trainer','expenses',3,'{"ar":"الفواتير والمصاريف","en":"Invoices and expenses","fr":"Factures et depenses","ur":"رسیدیں اور اخراجات"}'),
 ('trainer','documents',4,'{"ar":"الشهادات والمستندات","en":"Certificates and documents","fr":"Attestations et documents","ur":"اسناد اور دستاویزات"}'),
 ('trainer','team',5,'{"ar":"المدربون والمساعدون","en":"Trainers and assistants","fr":"Formateurs et assistants","ur":"ٹرینرز اور معاونین"}'),
 ('trainer','settings',6,null);

-- حالياً القناة الوحيدة المتاحة هي تيليغرام في كل الباقات (قرار المهندس رعد).
update public.plans set limits = jsonb_set(limits, '{channels}', '["telegram"]'::jsonb);

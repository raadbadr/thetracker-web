-- قرار المهندس رعد: الفترة التجريبية تيليغرام فقط، والباقتان المدفوعتان تيليغرام
-- والبريد الإلكتروني. واتساب والرسائل النصية تُؤجَّل (الشيفرة باقية بلا تفعيل).
update public.plans set limits = jsonb_set(limits, '{channels}', '["telegram"]'::jsonb) where code = 'trial';
update public.plans set limits = jsonb_set(limits, '{channels}', '["telegram","email"]'::jsonb) where code in ('monthly','yearly');
update public.plans set limits = jsonb_set(limits, '{channels}', '["telegram"]'::jsonb) where code = 'expired';

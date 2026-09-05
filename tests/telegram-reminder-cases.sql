-- حالات مهلة التذكير: تُشغَّل على القاعدة (MCP أو psql) وكلها يجب أن تمر.
--   select * from public.test_parse_before_cases() where ok is false;   → صفر صفوف
create or replace function public.test_parse_before_cases()
returns table(input text, expected text, got text, ok boolean)
language sql stable as $$
  select c.input, c.expected, public.telegram_parse_before(c.input)::text,
         public.telegram_parse_before(c.input)::text is not distinct from c.expected
  from (values
    ('يوم',        '1 day'),
    ('يومين',      '2 days'),
    ('3 أيام',     '3 days'),
    ('10 ايام',    '10 days'),
    ('ساعة',       '01:00:00'),
    ('ساعتين',     '02:00:00'),
    ('نصف ساعة',   '00:30:00'),
    ('30 دقيقة',   '00:30:00'),
    ('أسبوع',      '7 days'),
    ('اسبوعين',    '14 days'),
    ('شهر',        '30 days'),
    ('شهرين',      '60 days'),
    ('2 days',     '2 days'),
    ('12 hours',   '12:00:00'),
    ('5',          '5 days'),
    ('كلام فاضي',  null),
    ('',           null)
  ) as c(input, expected);
$$;

# 🅃 TheTracker Website

موقع ويب احترافي لمنصة TheTracker - تتبّع أعمالك ومواعيدك في مكان واحد

## 🎨 المميزات

- ✨ تصميم Neumorphic حديث (الثيم نفسه المعتمد في Parkinzi)
- 🌓 دعم Dark Mode كامل
- 🌍 متعدد اللغات (العربية / English / Français / اردو)
- 📱 Responsive تماماً
- ⚡ أداء محسّن
- 🎭 تأثيرات تفاعلية جميلة
- 🤖 مساعد محادثة ذكي داخل الصفحة الرئيسية

## 🚀 التقنيات

- HTML5
- CSS3 (Neumorphic Design)
- Vanilla JavaScript
- IBM Plex Sans Arabic Font
- Cloudflare Workers (واجهة API + الملفات الثابتة عبر `[assets]`)
- Supabase (المصادقة + قاعدة البيانات + RLS)
- Workers AI أو Claude لمساعد الموقع

## 📂 الملفات

```
06-TheTracker/
├── index.html                          # الصفحة الرئيسية: hero + أرقام المنصة (/api/stats) + المميزات + كتل CTA + مساعد المحادثة
├── pricing.html                        # الخطط: تجربة 14 يوماً / شهري 49 ريال / سنوي 490 ريال
├── login.html                          # الدخول: Google، Apple، رابط سحري بالبريد، رمز OTP بالهاتف (Supabase Auth)
├── app.js                              # مساعد المصادقة المشترك + قراءة الإعدادات من /api/config
├── about.html                          # من نحن
├── privacy.html                        # سياسة الخصوصية (4 لغات)
├── terms.html                          # شروط الاستخدام
├── 404.html                            # صفحة غير موجود
├── header.css                          # هيدر موحد (لغة + مظهر)
├── footer.css                          # فوتر موحد
├── brand-logo.js                       # يستبدل كلمة "TheTracker" الحرفية بصورة tracker-logo-dark.png
├── src/worker.js                       # الـ Worker: GET /api/config، GET /api/stats، POST /api/assistant، POST /api/contact
├── src/assistant.js                    # المساعد: Claude إن وُجد ANTHROPIC_API_KEY وإلا Workers AI (مجاني)
├── supabase/migrations/0001_init.sql   # المخطط + RLS + حدود الخطط + platform_stats() + generate_due_notifications()
├── wrangler.toml                       # النطاقان appmails.net و www.appmails.net + [assets] + [ai]
├── DESIGN_STANDARDS.md                 # معايير التصميم
└── RULES.md                            # القواعد الثابتة
```

### مسارات الـ Worker (`src/worker.js`)

| المسار | الطريقة | الوظيفة |
|---|---|---|
| `/api/config` | GET | يعيد `SUPABASE_URL` و `SUPABASE_ANON_KEY` فقط للمتصفح |
| `/api/stats` | GET | أرقام المنصة عبر الدالة `platform_stats()` (أعداد فقط) |
| `/api/assistant` | POST | مساعد المحادثة (Claude أو Workers AI) |
| `/api/contact` | POST | حفظ رسائل التواصل في جدول `contact_messages` |

كل ما عدا `/api/*` يُخدَم كملفات ثابتة عبر `[assets]`.

### المساعد (`src/assistant.js`)

- إن وُجد السر `ANTHROPIC_API_KEY` يعمل المساعد بنموذج Claude.
- وإلا يعمل مجاناً عبر Workers AI بالنموذج `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (الربط `[ai]` في `wrangler.toml`).
- أدوات المساعد للقراءة فقط: الخطط، معلومات المنصة، أرقام المنصة.

## 🎯 المعايير المستخدمة

جميع المعايير موروثة حرفياً من موقع Parkinzi (خط أحمر للمالك — لا يتغير التصميم):
- نفس الألوان من `NeumorphicTheme.Colors`
- نفس المسافات من `NeumorphicTheme.Spacing`
- نفس الزوايا من `NeumorphicTheme.CornerRadius`
- نفس التأثيرات الزجاجية

## 🎨 الألوان

### Light Mode
- Primary: `#008CF2`
- Background: `#FAFCFF` → `#EDF3F9`
- Text: `#1A1A26`

### Dark Mode
- Primary: `#00CCFF`
- Background: `#1F2E38` → `#14232D`
- Text: `#FFFFFF`

### أزرق العلامة (الشعار)
- Brand Blue: `rgb(0, 160, 210)`

## 📱 التجاوبية

- Desktop: تأثيرات كاملة + 3D
- Tablet: تأثيرات متوسطة
- Mobile: مبسّطة للأداء
- Touch Devices: تحسينات خاصة

## 🌐 اللغات المدعومة

- 🇸🇦 العربية (افتراضي) - RTL
- 🇬🇧 English - LTR
- 🇫🇷 Français - LTR
- 🇵🇰 اردو - RTL

## 🎭 التأثيرات

- Glassmorphism (backdrop-filter)
- Neumorphic shadows
- Gradient animations
- Hover effects
- Float animations
- Pulse effects

## ⚡ الأداء

- GPU acceleration
- Optimized animations
- Reduced motion support
- Mobile-first approach
- Lazy effects on mobile

## 📝 الاستخدام

1. افتح `https://appmails.net` (أو شغّل `npx wrangler dev` محلياً)
2. اختر اللغة من القائمة العلوية
3. اختر المظهر (فاتح/داكن)
4. سجّل الدخول من `login.html` ثم استمتع بالتصفح! ✨

## 🔧 التخصيص

جميع الألوان في `:root` داخل `index.html` (موروثة من Parkinzi ولا تُعدَّل):
```css
--primary: rgb(0, 140, 242);
--text-primary: rgb(26, 26, 38);
--bg-top: rgb(250, 252, 255);
```

## 📄 الترخيص

© 2026 TheTracker. جميع الحقوق محفوظة.
الدعم: `support@appmails.net`

## ⚠️ تعليمات ثابتة — لا تُعدّل

### طريقة النشر (GitHub → Cloudflare Workers)
- **المستودع:** `github.com/raadbadr/thetracker-web`
- **الـ Worker:** `thetracker` — النطاقان `appmails.net` و `www.appmails.net` مربوطان كـ Custom Domains من `wrangler.toml`
- **كل `git push` للفرع `main` ينشر تلقائياً** عبر GitHub Actions (`.github/workflows/deploy.yml`) الذي يشغّل `wrangler deploy` بالسر `CLOUDFLARE_API_TOKEN` (نفس رمز Parkinzi).
- **الرمز `CLOUDFLARE_API_TOKEN` يعيش في GitHub Secrets فقط** — لا يُكتب في أي ملف.
- **لا تستخدم `wrangler deploy` يدوياً — النشر فقط من GitHub.**

### أسرار الـ Worker (Cloudflare → Workers & Pages → thetracker → Settings → Variables and Secrets)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (للـ Worker وحده — لا يصل إلى المتصفح أبداً)
- `ANTHROPIC_API_KEY` (اختياري — بدونه يعمل المساعد عبر Workers AI مجاناً)

### أيقونة الموقع (Favicon & Apple Touch Icon)
- ملفات الأيقونة: `favicon.ico`، `favicon-32x32.png`، `favicon-16x16.png`، `apple-touch-icon.png`
- المصدر: أيقونات حرف "T" المولّدة (خط Monoton على أزرق العلامة)
- **لا تغيير هذه الأيقونة بعد الآن بدون إذن مباشر من المهندس رعد.**
- مرجعية في `manifest.webmanifest` وكل صفحات HTML.

---

**النسخة:** 1.0
**آخر تحديث:** 2026-09-03
**الحالة:** ✅ Production Ready

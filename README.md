# 🅿️ Parkinzi Website

موقع ويب احترافي لتطبيق Parkinzi - حل ذكي لمواقف السيارات

## 🎨 المميزات

- ✨ تصميم Neumorphic حديث
- 🌓 دعم Dark Mode كامل
- 🌍 متعدد اللغات (العربية / English / Français / اردو)
- 📱 Responsive تماماً
- ⚡ أداء محسّن
- 🎭 تأثيرات تفاعلية جميلة

## 🚀 التقنيات

- HTML5
- CSS3 (Neumorphic Design)
- Vanilla JavaScript
- IBM Plex Sans Arabic Font

## 📂 الملفات

```
Web/
├── index.html              # الصفحة الرئيسية
├── privacy.html            # سياسة الخصوصية (4 لغات)
├── refund.html             # سياسة الاسترجاع + دليل المخالفات
├── header.css              # هيدر موحد (لغة + مظهر)
├── footer.css              # فوتر موحد
├── DESIGN_STANDARDS.md     # معايير التصميم
└── IMPROVEMENTS.md         # التحسينات الأخيرة
```

## 🎯 المعايير المستخدمة

جميع المعايير مطابقة لتطبيق Parkinzi iOS:
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

1. افتح `index.html` في المتصفح
2. اختر اللغة من القائمة العلوية
3. اختر المظهر (فاتح/داكن)
4. استمتع بالتصفح! ✨

## 🔧 التخصيص

جميع الألوان في `:root`:
```css
--primary: rgb(0, 140, 242);
--text-primary: rgb(26, 26, 38);
--bg-top: rgb(250, 252, 255);
```

## 📄 الترخيص

© 2026 PARKINZI. جميع الحقوق محفوظة.

## ⚠️ تعليمات ثابتة — لا تُعدّل

### طريقة النشر (GitHub → Cloudflare Pages)
- **المستودع:** `github.com/raadbadr/parkinzi-web`
- **لوحة Cloudflare:** Workers & Pages → parkinzi → Settings → Builds & deployments
- **الربط:** Connect to Git → GitHub → `raadbadr/parkinzi-web` → الفرع `main`
- **إعدادات البناء:** Build command = فارغ، Build output directory = `/`
- **كل `git push` للفرع `main` ينشر تلقائياً خلال ثوانٍ.**
- **لا تستخدم `wrangler deploy` يدوياً — النشر فقط من GitHub.**

### أيقونة الموقع (Favicon & Apple Touch Icon)
- ملفات الأيقونة: `favicon-32x32.png`، `favicon-16x16.png`، `apple-touch-icon.png`
- المصدر: `parkinzi_icon_512.png` (512×512 PNG)
- **لا تغيير هذه الأيقونة بعد الآن بدون إذن مباشر من رعد.**
- مرجعية في `manifest.webmanifest` وكل صفحات HTML الست.

---

**النسخة:** 2.1
**آخر تحديث:** 2026-02-17
**الحالة:** ✅ Production Ready

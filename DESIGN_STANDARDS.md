# معايير التصميم - موقع TRACKER

> الثيم موروث حرفياً من موقع Parkinzi (NeumorphicTheme) ولا يُعدَّل — خط أحمر للمالك. كل ما يخص TRACKER هنا هو الشعار فقط.

## 🎨 نظام الألوان (من NeumorphicTheme)

### الوضع الفاتح (Light Mode)
```css
--primary: rgb(0, 140, 242)        /* #008CF2 */
--primary-light: rgb(25, 179, 255) /* #19B3FF */
--primary-dark: rgb(0, 128, 230)   /* #0080E6 */

--text-primary: rgb(26, 26, 38)    /* #1A1A26 */
--text-secondary: rgb(77, 77, 89)  /* #4D4D59 */

--bg-top: rgb(250, 252, 255)       /* #FAFCFF */
--bg-mid: rgb(242, 247, 252)       /* #F2F7FC */
--bg-bottom: rgb(237, 243, 249)    /* #EDF3F9 */
```

### الوضع الداكن (Dark Mode)
```css
--primary: rgb(0, 204, 255)        /* #00CCFF */
--primary-light: rgb(51, 212, 255) /* #33D4FF */
--primary-dark: rgb(0, 179, 230)   /* #00B3E6 */

--text-primary: rgb(255, 255, 255)
--text-secondary: rgba(255, 255, 255, 0.7)

--bg-top: rgb(31, 46, 56)          /* #1F2E38 */
--bg-mid: rgb(26, 40, 51)          /* #1A2833 */
--bg-bottom: rgb(20, 35, 45)       /* #14232D */
```

## 📐 المسافات (Spacing)
مطابقة لـ `NeumorphicTheme.Spacing`:
- `xs: 4px`
- `sm: 8px`
- `md: 16px`
- `lg: 20px`
- `xl: 24px`
- `cardPadding: 20px`

## 🔘 الزوايا (Corner Radius)
مطابقة لـ `NeumorphicTheme.CornerRadius`:
- `md: 12px`
- `lg: 16px`
- `xl: 18px`
- `xxl: 20px`
- `xxxl: 24px`

## 💫 التأثيرات الزجاجية (Glass Effects)

### الوضع الفاتح
```css
--glass: rgba(255, 255, 255, 0.85)
--glass-border: rgba(0, 0, 0, 0.08)
--glass-strong: rgba(255, 255, 255, 0.95)

backdrop-filter: blur(30px) saturate(180%)
```

### الوضع الداكن
```css
--glass: rgba(255, 255, 255, 0.08)
--glass-border: rgba(255, 255, 255, 0.15)
--glass-strong: rgba(255, 255, 255, 0.12)

backdrop-filter: blur(30px) saturate(180%)
```

## 🎭 الظلال (Neumorphic Shadows)

```css
/* Light Mode */
box-shadow: 
  0 8px 32px var(--shadow-dark),
  0 0 0 1px var(--glass-border),
  inset 0 0 0 1px rgba(255,255,255,0.1);

/* Dark Mode */
box-shadow: 
  0 8px 32px rgba(0,0,0,0.6),
  0 0 0 1px var(--glass-border),
  inset 0 0 0 1px rgba(255,255,255,0.05);
```

## 🔤 الخطوط (Typography)

```css
font-family: 'IBM Plex Sans Arabic', sans-serif;

/* الأحجام */
.hero-logo: 360px (400px على الشاشات الكبيرة)
.tagline: 1.3rem
.section-title: 2.5rem
.btn: 1.1rem
```

## 🎬 الحركات (Animations)

```css
transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
/* مطابق لـ NeumorphicTheme.Animation */
```

## 📱 التجاوب (Responsive)

- **Desktop**: كامل التأثيرات ثلاثية الأبعاد
- **Tablet**: (≤ 1024px) تأثيرات مخففة
- **Mobile**: (≤ 768px) بدون تأثيرات ثقيلة
- **Small Mobile**: (≤ 480px) تحسينات للشاشات الصغيرة

## ✅ التطابق مع التطبيق

- ✅ نفس الألوان من `NeumorphicTheme.Colors`
- ✅ نفس المسافات من `NeumorphicTheme.Spacing`
- ✅ نفس الزوايا من `NeumorphicTheme.CornerRadius`
- ✅ نفس الظلال من `NeumorphicTheme.Shadows`
- ✅ نفس التأثيرات الزجاجية (glass + backdrop-filter)
- ✅ نفس الحركات (cubic-bezier timing)
- ✅ دعم Dark Mode كامل

## 🏷️ شعار TRACKER - قواعد ثابتة لكل المشروع

**الهيكل:** حرف T + نص RACKER

### الثيم الداكن (Dark)
| العنصر | اللون | CSS |
|--------|-------|-----|
| الحرف (T) | أبيض | `color: #ffffff` |
| RACKER | أزرق العلامة | `rgb(0, 160, 210)` |
| ملف الشعار الكامل | `tracker-logo-full-dark.png` | — |
| العلامة الصغيرة | `tracker-logo-dark.png` | — |

### الثيم الفاتح (Light)
| العنصر | اللون | CSS |
|--------|-------|-----|
| الحرف (T) | أسود | `color: #000000` |
| RACKER | أزرق العلامة | `rgb(0, 160, 210)` |
| ملف الشعار الكامل | `tracker-logo-full-light.png` | — |
| العلامة الصغيرة | `tracker-logo-light.png` | — |

**ملف التطبيق:** `footer.css` — مصدر واحد للفوتر في index, pricing, login, about, privacy, terms
**الاستبدال التلقائي:** `brand-logo.js` يستبدل كلمة "TRACKER" الحرفية في النصوص بصورة `tracker-logo-dark.png`
**ملاحظة:** الثيم (الألوان، المسافات، الزوايا، الزجاج، الظلال، الخطوط، الحركات) موروث حرفياً من Parkinzi ولا يتغير

---

## 🎯 المكونات الرئيسية

### 1. Header (Neumorphic Glass)
```css
background: var(--glass)
backdrop-filter: blur(25px) saturate(180%)
border-bottom: 1px solid var(--glass-border)
```

### 2. Buttons (Primary Action)
```css
border-radius: 20px /* NeumorphicTheme.CornerRadius.xl */
background: linear-gradient(primary → primary-dark)
box-shadow: neumorphic + glow effect
```

### 3. Feature Cards (Glass Cards)
```css
padding: 2rem /* NeumorphicTheme.Spacing.cardPadding */
border-radius: 24px /* NeumorphicTheme.CornerRadius.xxxl */
backdrop-filter: blur(30px) saturate(180%)
```

## 📝 ملاحظات مهمة

1. **اللغة العربية الفصحى فقط** - لا عامية
2. **RTL Support** - دعم كامل للعربية
3. **Performance** - تحسينات للأجهزة المحمولة
4. **Accessibility** - دعم reduced-motion
5. **Cross-browser** - webkit prefixes للتوافق

---

آخر تحديث: 2026-09-03
النسخة: 1.2 (شعار TRACKER — الثيم موروث من Parkinzi)

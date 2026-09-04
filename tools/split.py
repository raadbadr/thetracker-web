#!/usr/bin/env python3
"""تقسيم الملفات الكبيرة إلى أجزاء لا تتجاوز 1000 سطر بلا أي تغيير في السلوك.

  python3 tools/split.py js  app/common.js          # يقسم ملف JS إلى app/common/*.js + app/common.js.parts.json ويحذف الأصل
  python3 tools/split.py page app/settings.html     # يستخرج <style> و<script> الداخلية إلى ملفات css/js ثابتة (حزمة أجزاء فقط إن تجاوزت الكتلة الحد)
  python3 tools/split.py build app/common.js        # يطبع تجميع الحزمة (للفحص بـ node --check أو للمقارنة)
  python3 tools/split.py check                      # يعدد الملفات التي ما زالت فوق 1000 سطر

الحزمة: الملف المطلوب /app/x.js يُجمَّع في الخادم (src/bundles.js) من أجزائه المذكورة في /app/x.js.parts.json
بالترتيب وبلا فاصل، فالتجميع مطابق للأصل بايتا بايت (يُتحقق منه هنا)."""
import io, json, os, re, sys

LIMIT = 1000        # الحد الذي أمر به المهندس رعد
TARGET = 850        # حجم الجزء المستهدف ليبقى تحت الحد بعد تعديلات لاحقة

def read(p): return io.open(p, encoding="utf-8").read()
def write(p, s):
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    io.open(p, "w", encoding="utf-8").write(s)

def safe_cut_points(lines, kind, max_indent=8):
    """مواضع يمكن القطع قبلها بأمان: بعد سطر فارغ، وخارج التعليقات الكتلية والقوالب النصية،
    والسطر التالي يبدأ بمسافة بادئة قليلة (مستوى أعلى)."""
    pts = []
    in_block = False; backticks = 0
    for i, line in enumerate(lines):
        # تتبع حالة التعليق الكتلي وعلامات القالب حتى نهاية هذا السطر
        j = 0
        while j < len(line):
            if in_block:
                k = line.find("*/", j)
                if k == -1: j = len(line); break
                in_block = False; j = k + 2; continue
            if kind == "js" and line.startswith("//", j): break
            if line.startswith("/*", j): in_block = True; j += 2; continue
            if kind == "js" and line[j] == "`": backticks += 1
            j += 1
        if in_block or backticks % 2: continue
        if line.strip() == "" and i + 1 < len(lines):
            nxt = lines[i + 1]
            indent = len(nxt) - len(nxt.lstrip(" "))
            if nxt.strip() and indent <= max_indent: pts.append(i + 1)  # دوال داخل IIFE تبدأ عند 6
    return pts

def split_text(text, kind):
    lines = text.splitlines(keepends=True)
    if len(lines) <= LIMIT: return [text]
    parts = []; start = 0
    while len(lines) - start > TARGET:
        want = start + TARGET
        cut = None
        # إغلاق بمسافة بادئة عميقة: نوسّع حد المسافة تدريجيا؛ الضمان الحقيقي هو «خارج التعليقات والقوالب» وتطابق التجميع
        for max_indent in (8, 12, 999):
            pts = safe_cut_points(lines, kind, max_indent)
            cands = [p for p in pts if start + 200 <= p <= want]
            if cands: cut = cands[-1]; break
            cands = [p for p in pts if want < p <= start + LIMIT - 1]
            if cands: cut = cands[0]; break
        if cut is None:
            # لا أسطر فارغة (كائن ترجمات ضخم مثلا): القطع عند حد سطر كافٍ للمطابقة البايتية لأن التجميع بلا فاصل؛
            # نفضّل سطرا ينتهي بفاصلة أو قوس إغلاق ليبقى الجزء مقروءا
            for k in range(want, start + 200, -1):
                if lines[k - 1].rstrip().endswith((",", "}", "};", ";")): cut = k; break
            if cut is None: cut = want
        parts.append("".join(lines[start:cut])); start = cut
    parts.append("".join(lines[start:]))
    assert "".join(parts) == text
    for p in parts: assert p.count("\n") <= LIMIT, "part still too long"
    return parts

def bundle_paths(target):
    d, base = os.path.split(target); name, ext = os.path.splitext(base); ext = ext.lstrip(".")
    return d, name, ext, os.path.join(d, base + ".parts.json")

def write_bundle(target, text, kind, label=None):
    """يكتب أجزاء النص تحت <dir>/<name>/ ويسجلها في <target>.parts.json؛ يعيد عدد الأجزاء."""
    d, name, ext, manifest = bundle_paths(target)
    parts = split_text(text, kind)
    if len(parts) == 1:
        # يكفي ملف ثابت واحد (لا حزمة ولا تجميع): أبسط وأسرع تخزينا على الحافة
        write(target, text)
        return 1
    rels = []
    for i, part in enumerate(parts, 1):
        rel = "%s/%s.%d.%s" % (name, label or ext, i, ext)
        write(os.path.join(d, rel), part); rels.append(rel)
    write(manifest, json.dumps(rels, ensure_ascii=False, indent=1) + "\n")
    assert build(target) == text
    return len(parts)

def build(target):
    d, name, ext, manifest = bundle_paths(target)
    if not os.path.exists(manifest): return read(target) if os.path.exists(target) else None
    return "".join(read(os.path.join(d, rel)) for rel in json.load(io.open(manifest, encoding="utf-8")))

def cmd_js(path):
    text = read(path)
    if text.count("\n") <= LIMIT: print("%s already under %d lines" % (path, LIMIT)); return
    n = write_bundle(path, text, "js", "part")
    os.remove(path)
    print("%s → %d parts (original removed; served as a bundle)" % (path, n))

SCRIPT_RX = re.compile(r'([ \t]*)<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>[ \t]*\n?', re.S)
STYLE_RX = re.compile(r'([ \t]*)<style([^>]*)>(.*?)</style>[ \t]*\n?', re.S)

def cmd_page(path):
    html = read(path); d, base = os.path.split(path); page = os.path.splitext(base)[0]
    out = html; made = []
    # الأنماط: كل كتل <style> بالترتيب في حزمة واحدة <page>.css
    styles = list(STYLE_RX.finditer(html))
    if styles:
        css = "".join(m.group(3).lstrip("\n") if not m.group(3).startswith("\n") else m.group(3)[1:] for m in styles)
        css_target = os.path.join(d, page + ".css")
        n = write_bundle(css_target, css, "css", "style")
        first = True
        for m in styles:
            tag = '%s<link rel="stylesheet" href="/%s?v=1">\n' % (m.group(1), css_target.replace(os.sep, "/")) if first else ""
            out = out.replace(m.group(0), tag, 1); first = False
        made.append("%s (%d parts, %d lines)" % (css_target, n, css.count("\n")))
    # السكربتات الداخلية: كل كتلة تبقى سكربتا مستقلا (نفس الدلالة تماما) بحزمة خاصة <page>.N.js
    # نوع غير تنفيذي (ld+json، json، أي قالب نصي) لا يصح إخراجه: المتصفح لا يجلب src
    # لعنصر script بنوع كهذا فيبقى فارغا — تحقق فعلي في متصفح حقيقي، ليس افتراضا.
    JS_TYPE_RX = re.compile(r'type\s*=\s*["\']?\s*(text/javascript|application/javascript|module)\b', re.I)
    idx = 0
    for m in SCRIPT_RX.finditer(html):
        body = m.group(3)
        attrs = m.group(2)
        if body.count("\n") < 6:            # سطر أو سطران: يبقى داخليا
            continue
        if re.search(r'\btype\s*=', attrs, re.I) and not JS_TYPE_RX.search(attrs):
            continue                        # نوع غير تنفيذي (مثل ld+json): يبقى داخليا دائما
        idx += 1
        code = body[1:] if body.startswith("\n") else body
        js_target = os.path.join(d, "%s.%d.js" % (page, idx))
        n = write_bundle(js_target, code, "js", "script")
        attrs = m.group(2).strip()
        tag = '%s<script src="/%s?v=1"%s></script>\n' % (m.group(1), js_target.replace(os.sep, "/"), (" " + attrs) if attrs else "")
        out = out.replace(m.group(0), tag, 1)
        made.append("%s (%d parts, %d lines)" % (js_target, n, code.count("\n")))
    write(path, out)
    print("%s → %d lines now" % (path, out.count("\n")))
    for x in made: print("   ", x)
    if out.count("\n") > LIMIT: print("   WARNING: page still over %d lines (markup/translations)" % LIMIT)

def cmd_check():
    import subprocess
    files = subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.split()
    bad = []
    for f in files:
        if re.search(r"\.(png|jpg|webp|ico|ttf|svg|lock)$", f) or f.startswith("node_modules"): continue
        try: n = read(f).count("\n")
        except Exception: continue
        if n > LIMIT: bad.append((n, f))
    for n, f in sorted(bad, reverse=True): print("%6d  %s" % (n, f))
    print("files over %d lines: %d" % (LIMIT, len(bad)))

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "js": cmd_js(sys.argv[2])
    elif cmd == "page": cmd_page(sys.argv[2])
    elif cmd == "build": sys.stdout.write(build(sys.argv[2]) or "")
    else: cmd_check()

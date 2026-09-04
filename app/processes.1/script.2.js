    const lang = () => localStorage.getItem("tracker_lang") || "ar";
    const theme = () => localStorage.getItem("tracker_theme") || "dark";
    const langNames = { ar: "العربية", en: "English", fr: "Français", ur: "اردو" };
    let l = lang();
    document.documentElement.lang = l;
    document.documentElement.dir = (l === "ar" || l === "ur") ? "rtl" : "ltr";

    const placeholderKeys = { inviteEmail: "inviteEmailPlaceholder", chatInput: "chatPlaceholder" };
    const ariaKeys = { inviteRole: "roleLabel" };
    function applyPlaceholders(code) {
      const dict = translations[code] || translations.ar;
      Object.keys(placeholderKeys).forEach(id => {
        const el = document.getElementById(id);
        if (el && dict[placeholderKeys[id]]) el.placeholder = dict[placeholderKeys[id]];
      });
      Object.keys(ariaKeys).forEach(id => {
        const el = document.getElementById(id);
        if (el && dict[ariaKeys[id]]) el.setAttribute("aria-label", dict[ariaKeys[id]]);
      });
    }

    function setLang(code) {
      localStorage.setItem("tracker_lang", code);
      l = code;
      document.documentElement.lang = code;
      document.documentElement.dir = (code === "ar" || code === "ur") ? "rtl" : "ltr";
      document.getElementById("currentLangDisplay").textContent = langNames[code] || code;
      ["ar","en","fr","ur"].forEach(c => {
        const el = document.getElementById("check-" + c);
        if (el) el.style.display = c === code ? "inline" : "none";
      });
      const th = theme();
      document.getElementById("currentThemeDisplay").textContent = translations[code][th === "dark" ? "dark" : "light"];
      document.querySelectorAll("[data-i18n]").forEach(el => {
        const k = el.dataset.i18n;
        if (translations[code] && translations[code][k]) el.innerHTML = translations[code][k];
      });
      applyPlaceholders(code);
      document.title = (translations[code] && translations[code].title ? translations[code].title : "Team") + " | TheTracker";
      if (typeof window.__trackerAuthRefresh === "function") window.__trackerAuthRefresh();
      if (typeof window.__processesRefresh === "function") window.__processesRefresh();
    }

    function setTheme(th) {
      localStorage.setItem("tracker_theme", th);
      document.documentElement.dataset.theme = th;
      const meta = document.getElementById("themeColorMeta");
      if (meta) meta.content = th === "dark" ? "#1a2933" : "#0068b8";
      const logo = document.getElementById("footerLogo");
      if (logo) logo.src = th === "dark" ? "/tracker-logo-full-dark.png?v=2" : "/tracker-logo-full-light.png?v=2";
      document.getElementById("themeIcon").textContent = th === "dark" ? "🌙" : "☀️";
      document.getElementById("currentThemeDisplay").textContent = translations[l][th === "dark" ? "dark" : "light"];
      document.getElementById("check-light").style.display = th === "light" ? "inline" : "none";
      document.getElementById("check-dark").style.display = th === "dark" ? "inline" : "none";
    }

    document.getElementById("langMenuBtn").addEventListener("click", e => {
      e.stopPropagation();
      document.getElementById("langDropdown").classList.toggle("show");
      document.getElementById("themeDropdown").classList.remove("show");
    });
    // زر المظهر يبدل الثيم مباشرة بضغطة واحدة بلا قائمة (طلب المهندس رعد)
    document.getElementById("themeMenuBtn").addEventListener("click", e => {
      e.stopPropagation();
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      document.getElementById("langDropdown").classList.remove("show");
    });
    document.addEventListener("click", () => {
      document.getElementById("langDropdown").classList.remove("show");
      document.getElementById("themeDropdown").classList.remove("show");
    });

    document.querySelectorAll("#langDropdown .menu-dropdown-item").forEach(item => {
      item.addEventListener("click", () => setLang(item.dataset.lang));
    });
    document.querySelectorAll("#themeDropdown .menu-dropdown-item").forEach(item => {
      item.addEventListener("click", () => {
        setTheme(item.dataset.theme);
        document.getElementById("themeDropdown").classList.remove("show");
      });
    });

    document.querySelectorAll("[data-i18n]").forEach(el => {
      const k = el.dataset.i18n;
      if (translations[l] && translations[l][k]) el.innerHTML = translations[l][k];
    });
    applyPlaceholders(l);
    document.getElementById("currentLangDisplay").textContent = langNames[l] || l;
    ["ar","en","fr","ur"].forEach(c => {
      const el = document.getElementById("check-" + c);
      if (el) el.style.display = l === c ? "inline" : "none";
    });
    document.title = (translations[l] && translations[l].title ? translations[l].title : "Team") + " | TheTracker";

    (function() {
      const th = theme();
      document.documentElement.dataset.theme = th;
      const meta = document.getElementById("themeColorMeta");
      if (meta) meta.content = th === "dark" ? "#1a2933" : "#0068b8";
      const logo = document.getElementById("footerLogo");
      if (logo) logo.src = th === "dark" ? "/tracker-logo-full-dark.png?v=2" : "/tracker-logo-full-light.png?v=2";
      document.getElementById("themeIcon").textContent = th === "dark" ? "🌙" : "☀️";
      document.getElementById("currentThemeDisplay").textContent = translations[l][th === "dark" ? "dark" : "light"];
      document.getElementById("check-light").style.display = th === "light" ? "inline" : "none";
      document.getElementById("check-dark").style.display = th === "dark" ? "inline" : "none";
    })();
  
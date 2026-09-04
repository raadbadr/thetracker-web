    let chatState = { step: "subject", data: {} };
    
    function addChatMsg(text, isBot, options = null) {
      const div = document.createElement("div");
      div.className = "chat-msg " + (isBot ? "bot" : "user");
      const content = document.createElement("div");
      if (text.includes("TheTracker")) {
        const logoHtml = '<img src="tracker-logo-full-dark.png?v=2" alt="TheTracker" class="brand-logo-inline brand-logo-inline--xs">';
        const parts = text.split("TheTracker");
        content.innerHTML = parts.map((p, i) => p + (i < parts.length - 1 ? logoHtml : "")).join("");
      } else {
        content.textContent = text;
      }
      div.appendChild(content);
      if (options && isBot) {
        const opts = document.createElement("div");
        opts.className = "chat-options";
        options.forEach((opt) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "chat-option-btn";
          btn.textContent = opt.label;
          btn.onclick = () => handleOption(opt.value);
          opts.appendChild(btn);
        });
        div.appendChild(opts);
      }
      chatMessages.appendChild(div);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    /* وضعان: "assistant" (LLM بأدوات البيانات الحية عبر /api/assistant) افتراضيا،
       و"contact" (مسار تذاكر الدعم القديم subject→name→email→message) بزر صريح
       أو تلقائيا إن كان المساعد غير متاح (503). */
    let chatMode = "assistant";
    let assistantHistory = [];
    let assistantBusy = false;

    function clearChatOptionButtons() {
      document.querySelectorAll(".chat-option-btn").forEach((b) => b.remove());
    }

    function handleOption(value) {
      const t = translations[lang()];
      clearChatOptionButtons();
      if (value === "__contact") {
        enterContactMode();
        return;
      }
      if (value.indexOf("__sugg") === 0) {
        const q = t["chatAssistantSuggest" + value.slice(6)];
        if (q) sendAssistantMessage(q);
        return;
      }
      const opt = subjectOptions.find((o) => o.value === value);
      const label = opt ? t[opt.i18n] : value;
      addChatMsg(label, false);
      chatState.data.subject = value;
      chatState.step = "name";
      addChatMsg(t.chatAskName, true);
      setInputPlaceholder(t.contactName);
    }

    function setInputPlaceholder(placeholder) {
      chatInput.placeholder = placeholder;
    }

    function enterContactMode() {
      chatMode = "contact";
      chatState = { step: "subject", data: {} };
      const t = translations[lang()];
      addChatMsg(t.chatWelcome, true, subjectOptions.map((o) => ({ value: o.value, label: t[o.i18n] })));
      setInputPlaceholder(t.chatTypeOrSelect);
    }

    async function sendAssistantMessage(text) {
      if (assistantBusy) return;
      const t = translations[lang()];
      clearChatOptionButtons();
      addChatMsg(text, false);
      assistantHistory.push({ role: "user", content: text });
      if (assistantHistory.length > 12) assistantHistory = assistantHistory.slice(-12);
      assistantBusy = true;
      chatSendBtn.disabled = true;
      const typing = document.createElement("div");
      typing.className = "chat-msg bot chat-typing";
      const typingInner = document.createElement("div");
      typingInner.textContent = "…";
      typing.appendChild(typingInner);
      chatMessages.appendChild(typing);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: assistantHistory })
        });
        typing.remove();
        if (res.status === 503) {
          addChatMsg(t.chatAssistantUnavailable, true);
          enterContactMode();
          return;
        }
        if (!res.ok) throw new Error("assistant");
        const data = await res.json();
        const reply = String(data.reply || "").trim();
        if (!reply) throw new Error("assistant");
        assistantHistory.push({ role: "assistant", content: reply });
        addChatMsg(reply, true, [{ value: "__contact", label: t.chatContactSupportBtn }]);
      } catch (err) {
        typing.remove();
        addChatMsg(t.chatAssistantError, true, [{ value: "__contact", label: t.chatContactSupportBtn }]);
      } finally {
        assistantBusy = false;
        chatSendBtn.disabled = false;
      }
    }

    function initChat() {
      chatMessages.innerHTML = "";
      chatMode = "assistant";
      assistantHistory = [];
      chatState = { step: "subject", data: {} };
      chatInput.disabled = false;
      const t = translations[lang()];
      addChatMsg(t.chatAssistantWelcome, true, [
        { value: "__sugg1", label: t.chatAssistantSuggest1 },
        { value: "__sugg2", label: t.chatAssistantSuggest2 },
        { value: "__sugg3", label: t.chatAssistantSuggest3 },
        { value: "__contact", label: t.chatContactSupportBtn }
      ]);
      setInputPlaceholder(t.chatAssistantPlaceholder);
    }
    
    const waitlistForm = document.getElementById("waitlistForm");
    const waitlistEmail = document.getElementById("waitlistEmail");
    const waitlistBtn = document.getElementById("waitlistBtn");
    const waitlistMsg = document.getElementById("waitlistMsg");
    if (waitlistForm && waitlistEmail && waitlistBtn && waitlistMsg) {
      waitlistForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = waitlistEmail.value.trim().toLowerCase();
        if (!email) return;
        const t = translations[lang()];
        waitlistBtn.disabled = true;
        waitlistMsg.textContent = t.waitlistSuccess;
        waitlistMsg.className = "waitlist-msg success";
        waitlistMsg.style.display = "block";
        window.location.href = "login.html?email=" + encodeURIComponent(email);
      });
    }

    async function sendToSupabase() {
      chatSendBtn.disabled = true;
      chatSendBtn.classList.add("sending");
      const t = translations[lang()];
      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatState.data)
        });
        if (res.ok || res.status === 201) {
          const botMsgs = chatMessages.querySelectorAll(".chat-msg.bot");
          if (botMsgs.length) botMsgs[botMsgs.length - 1].remove();
          addChatMsg(t.contactSuccess, true);
          chatState.step = "done";
          chatInput.placeholder = t.chatDone || "تم إرسال رسالتك";
          chatInput.disabled = true;
        } else throw new Error("contact");
      } catch (err) {
        const botMsgs = chatMessages.querySelectorAll(".chat-msg.bot");
        if (botMsgs.length) botMsgs[botMsgs.length - 1].remove();
        addChatMsg(t.contactError, true);
        chatState.step = "message";
      } finally {
        chatSendBtn.disabled = false;
        chatSendBtn.classList.remove("sending");
      }
    }
    
    function handleChatSend() {
      const text = chatInput.value.trim();
      if (!text) return;
      if (chatMode === "assistant") {
        if (assistantBusy) return;
        chatInput.value = "";
        sendAssistantMessage(text);
        return;
      }
      if (chatState.step === "done") return;
      addChatMsg(text, false);
      chatInput.value = "";
      const t = translations[lang()];
      if (chatState.step === "subject") {
        const opt = subjectOptions.find((o) => t[o.i18n] === text || o.value === text);
        chatState.data.subject = opt ? opt.value : "general_inquiry";
        chatState.step = "name";
        addChatMsg(t.chatAskName, true);
        setInputPlaceholder(t.contactName);
      } else if (chatState.step === "name") {
        /* الاسم يجب أن يحوي حرفين فعليين على الأقل (أي أبجدية) — لا أرقاما ورموزا فقط */
        const letters = (text.match(/\p{L}/gu) || []).length;
        if (letters < 2 || text.length > 100) {
          addChatMsg(t.chatNameInvalid, true);
          setInputPlaceholder(t.contactName);
          return;
        }
        chatState.data.name = text;
        chatState.step = "email";
        addChatMsg(t.chatAskEmail, true);
        setInputPlaceholder(t.contactEmail);
      } else if (chatState.step === "email") {
        /* تحقق فعلي من صيغة البريد قبل المتابعة */
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) {
          addChatMsg(t.chatEmailInvalid, true);
          setInputPlaceholder(t.contactEmail);
          return;
        }
        chatState.data.email = text.toLowerCase();
        chatState.step = "message";
        addChatMsg(t.chatAskMessage, true);
        setInputPlaceholder(t.contactMessage);
      } else if (chatState.step === "message") {
        chatState.data.message = text;
        chatState.step = "send";
        addChatMsg(t.chatSending, true);
        sendToSupabase();
      }
    }
    
    chatSendBtn.addEventListener("click", handleChatSend);
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleChatSend();
      }
    });

    /* تبديل اللغة: أعد بناء الترحيب والاقتراحات باللغة الجديدة ما دامت
       المحادثة لم تبدأ فعليا؛ وإن كانت جارية فحدث حقل الإدخال فقط */
    window.__trackerChatLangRefresh = function () {
      const t = translations[lang()];
      if (!t) return;
      const untouched =
        chatMode === "assistant" && assistantHistory.length === 0 && !assistantBusy;
      if (untouched) {
        initChat();
        return;
      }
      if (chatMode === "assistant") {
        setInputPlaceholder(t.chatAssistantPlaceholder);
      }
    };

    initChat();
    
    // Chat widget toggle - زر يظهر ويخفي
    const chatWidget = document.getElementById("chatWidget");
    const chatWidgetBtn = document.getElementById("chatWidgetBtn");
    const footerContactLink = document.getElementById("footerContactLink");
    
    chatWidgetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chatWidget.classList.toggle("open");
    });
    
    if (footerContactLink) {
      footerContactLink.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        chatWidget.classList.add("open");
      });
    }
    
    if (window.location.hash === "#contact" || window.location.search.includes("open=contact")) {
      chatWidget.classList.add("open");
    }
    
    /* نقرات داخل الودجت لا تصل document — بدون هذا، حذف زر الاقتراح لحظة
       النقر يجعل e.target خارج الشجرة فيحسب "نقرا خارجيا" وتنغلق الدردشة */
    chatWidget.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", (e) => {
      if (chatWidget.classList.contains("open") && !chatWidget.contains(e.target)) {
        chatWidget.classList.remove("open");
      }
    });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
      });
    }
  
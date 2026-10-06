(() => {
  // The Dot is paused during native sign-in. Tick from its local open chat,
  // even before a credential input exists or gains focus.
  const tick = () => {
    refreshApprovalNotice();
    chrome.runtime
      .sendMessage({ type: "relay-private-tick", origin: location.origin })
      .catch(() => {});
  };
  setInterval(tick, 1000);
  const opened = new Set();
  let prepared;
  let approvalNotice;
  const visible = (e) =>
    e?.isConnected &&
    e.getClientRects().length &&
    getComputedStyle(e).visibility !== "hidden" &&
    getComputedStyle(e).display !== "none" &&
    getComputedStyle(e).opacity !== "0";
  const routed = (job) =>
    location.origin === "https://chatgpt.com" &&
    location.pathname === `/dots/${job.dotId}` &&
    !location.search &&
    !location.hash &&
    Number.isFinite(job.expires) &&
    Date.now() < job.expires &&
    new URL(job.origin).origin === job.origin &&
    new URL(job.origin).protocol === "https:";
  const privateTriggers = (job) =>
    routed(job)
      ? Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]'))
          .filter(visible)
          .filter(
            (button) =>
              !button.disabled &&
              button.textContent.trim() ===
                `Sign in to ${new URL(job.origin).host}`,
          )
      : [];
  function badge(active, job) {
    try {
      chrome.runtime
        .sendMessage({
          type: "relay-private-notice",
          origin: location.origin,
          active,
          ...(active ? { websiteOrigin: job.origin } : {}),
        })
        .catch(() => {});
    } catch {}
  }
  function clearApprovalNotice() {
    if (!approvalNotice) return;
    approvalNotice.element?.remove();
    approvalNotice = undefined;
    const prefix = "Approval needed · ";
    if (document.title.startsWith(prefix))
      document.title = document.title.slice(prefix.length);
    badge(false);
  }
  function refreshApprovalNotice() {
    if (!approvalNotice) return;
    const { job } = approvalNotice;
    // A closed/expired request is no longer actionable. Do not infer login success.
    if (!routed(job) || (!formFor(job) && privateTriggers(job).length !== 1))
      clearApprovalNotice();
  }
  function showApprovalNotice(job) {
    // This runs only after validated field delivery, without retaining its values.
    clearApprovalNotice();
    approvalNotice = {
      job: {
        id: job.id,
        dotId: job.dotId,
        origin: job.origin,
        expires: job.expires,
      },
    };
    badge(true, job);
    try {
      const element = document.createElement("div");
      element.setAttribute("data-relay-approval-notice", "");
      const root = element.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
        :host { all: initial; position: fixed; right: 20px; bottom: 24px;
          z-index: 2147483647; width: 340px; max-width: calc(100vw - 40px); }
        aside { box-sizing: border-box; background: #152332; color: #f4f7fb;
          border: 1px solid #607c96; border-radius: 12px; padding: 18px;
          box-shadow: 0 8px 32px #0005; font: 14px/1.5 system-ui, sans-serif; }
        strong { display: block; font-size: 16px; color: #ffcf82; }
        p { margin: 8px 0 14px; overflow-wrap: anywhere; }
        button { font: inherit; border: 1px solid #7992a9; border-radius: 6px;
          padding: 7px 11px; background: #d7e9f8; color: #102131; cursor: pointer; }
        button + button { margin-left: 8px; background: transparent; color: #f4f7fb; }
        button:focus-visible { outline: 2px solid #ffcf82; outline-offset: 3px; }
      `;
      const panel = document.createElement("aside");
      panel.setAttribute("role", "alert");
      const heading = document.createElement("strong");
      heading.textContent = "Approval needed";
      const detail = document.createElement("p");
      detail.textContent = `Relay filled the sign-in request for ${new URL(job.origin).host}. Confirm Sign in in ChatGPT when you are ready.`;
      const show = document.createElement("button");
      show.type = "button";
      show.textContent = "Show request";
      show.addEventListener("click", () => {
        if (!routed(job)) return clearApprovalNotice();
        const current = formFor(job);
        if (current) {
          current.form.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
        const triggers = privateTriggers(job);
        // Opening a uniquely matched request is separate from approving it.
        if (triggers.length === 1) triggers[0].click();
        else clearApprovalNotice();
      });
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "Dismiss notice";
      dismiss.addEventListener("click", clearApprovalNotice);
      panel.append(heading, detail, show, dismiss);
      root.append(style, panel);
      document.body.append(element);
      approvalNotice.element = element;
      if (!document.title.startsWith("Approval needed · "))
        document.title = `Approval needed · ${document.title}`;
    } catch {
      // Notification rendering must not turn an already completed fill into failure.
    }
  }
  function formFor(job) {
    if (!routed(job)) return;
    const forms = Array.from(
      document.querySelectorAll('form[data-dd-privacy="mask"]'),
    )
      .filter(visible)
      .filter((form) => {
        const dialog = form.closest('[role="dialog"]');
        return (
          dialog &&
          visible(dialog) &&
          Array.from(dialog.querySelectorAll("h2")).some(
            (h) => h.textContent.trim() === "Sign in to continue",
          ) &&
          form.getAttribute("aria-label") ===
            `Sign in to ${new URL(job.origin).host}` &&
          // ChatGPT nests the displayed address in a wrapper span. Count
          // its visible leaf marker once, while rejecting separate duplicates.
          Array.from(form.querySelectorAll("span"))
            .filter(visible)
            .filter((span) => span.textContent.trim() === job.origin)
            .filter(
              (span) =>
                !Array.from(span.querySelectorAll("span")).some(
                  (child) =>
                    visible(child) && child.textContent.trim() === job.origin,
                ),
            ).length === 1
        );
      });
    if (forms.length !== 1) return;
    const form = forms[0];
    if (new URL(form.action, location.href).origin !== "https://chatgpt.com")
      return;
    const inputs = Array.from(form.querySelectorAll("input"))
      .filter(visible)
      .filter((input) => !["checkbox", "hidden"].includes(input.type));
    if (!inputs.length || inputs.length > 2) return;
    const fields = [];
    for (const input of inputs) {
      if (input.disabled || input.readOnly) return;
      const label = input.getAttribute("aria-label") || "";
      if (
        input.name.startsWith("browser-auth-field-") &&
        input.type === "password" &&
        ["", "current-password"].includes(input.autocomplete) &&
        /\bpassword\b/i.test(label) &&
        !/new|confirm|verify|old|change/i.test(label)
      )
        fields.push({ field: "password", input });
      else if (
        input.name.startsWith("browser-auth-field-") &&
        ["text", "email"].includes(input.type) &&
        ["", "username", "email"].includes(input.autocomplete) &&
        /email|username|user name/i.test(label)
      )
        fields.push({ field: "username", input });
      else return; // Challenges, method choices and signup are owner/native flows.
    }
    if (new Set(fields.map((f) => f.field)).size !== fields.length) return;
    return { form, fields };
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;
    try {
      if (message.type === "relay-private-inspect") {
        const job = message.job;
        if (!routed(job)) return reply({ status: "BLOCKED" });
        const current = formFor(job);
        if (!current) {
          // Native sign-in requests start as a collapsed card in the Dot chat.
          // Open only a unique native dialog trigger for the armed destination.
          if (!opened.has(job.id)) {
            const buttons = privateTriggers(job);
            if (buttons.length === 1) {
              opened.add(job.id);
              buttons[0].click();
            }
          }
          return reply({ status: "WAITING_FOR_PRIVATE_FORM" });
        }
        // Do not overwrite credentials supplied by the owner or a password manager.
        // Values stay in the extension and are never included in metadata.
        if (current.fields.some((f) => f.input.value !== ""))
          return reply({ status: "WAITING_FOR_EMPTY_FORM" });
        if (
          !prepared ||
          prepared.job.id !== job.id ||
          prepared.form !== current.form ||
          prepared.fields.length !== current.fields.length ||
          current.fields.some((f, i) => prepared.fields[i]?.input !== f.input)
        )
          prepared = { ...current, job, nonce: crypto.randomUUID() };
        return reply({
          status: "READY",
          origin: job.origin,
          nonce: prepared.nonce,
          fields: prepared.fields.map((f) => f.field),
        });
      }
      if (message.type === "relay-private-fill") {
        const c = message.delivery;
        const block = () => {
          prepared = undefined;
          reply({ status: "BLOCKED" });
        };
        const current = prepared && formFor(prepared.job);
        if (
          !current ||
          !c ||
          c.id !== prepared.job.id ||
          c.dotId !== prepared.job.dotId ||
          c.origin !== prepared.job.origin ||
          c.nonce !== prepared.nonce ||
          c.expires !== prepared.job.expires ||
          c.fields.length !== prepared.fields.length ||
          current.form !== prepared.form ||
          current.fields.some((f) => f.input.value !== "") ||
          current.fields.length !== prepared.fields.length ||
          current.fields.some(
            (f, i) => prepared.fields[i]?.input !== f.input,
          ) ||
          c.fields.some(
            (f, i) =>
              f.field !== prepared.fields[i]?.field ||
              typeof f.value !== "string" ||
              !f.value ||
              f.value.length > 4096,
          )
        )
          return block();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        for (let i = 0; i < c.fields.length; i++) {
          const input = prepared.fields[i].input;
          // Recheck the visible native request before every individual write.
          const fresh = formFor(prepared.job);
          if (
            !fresh ||
            fresh.form !== prepared.form ||
            fresh.fields.length !== prepared.fields.length ||
            fresh.fields.some((f, n) => f.input !== prepared.fields[n].input) ||
            !visible(input)
          )
            return block();
          setter.call(input, c.fields[i].value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          if (!input.isConnected || input.value !== c.fields[i].value)
            return block();
          c.fields[i].value = "";
        }
        const noticeJob = prepared.job;
        prepared = undefined;
        try {
          showApprovalNotice(noticeJob);
        } catch {}
        // Never click Sign in, Save to Passwords, takeover or a method choice.
        return reply({ status: "FILLED" });
      }
    } catch {
      prepared = undefined;
      reply({ status: "BLOCKED" });
    }
    return false;
  });
  // Also clear any old toolbar notice when this content script is reloaded.
  badge(false);
  tick();
})();

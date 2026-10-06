(() => {
  let focused;
  let nonce;
  const kind = (input) => {
    if (
      !(input instanceof HTMLInputElement) ||
      input.disabled ||
      input.readOnly ||
      !input.getClientRects().length ||
      getComputedStyle(input).visibility === "hidden" ||
      getComputedStyle(input).display === "none" ||
      getComputedStyle(input).opacity === "0"
    )
      return undefined;
    if (input.type === "password") return "password";
    const label = [
      input.autocomplete,
      input.getAttribute("aria-label"),
      input.name,
      input.id,
      input.placeholder,
      ...Array.from(input.labels || [], (l) => l.textContent),
    ]
      .filter(Boolean)
      .join(" ");
    if (
      /one-time-code|totp|authenticator|verification.?code|\botp\b/i.test(
        label,
      ) &&
      ["text", "tel", "number"].includes(input.type)
    )
      return "totp";
    if (
      /email|username|user.?name|login|identifier/i.test(label) &&
      ["text", "email"].includes(input.type)
    )
      return "username";
    return undefined;
  };
  function report() {
    const input = document.activeElement;
    const field = kind(input);
    if (!field) {
      if (nonce)
        chrome.runtime
          .sendMessage({ type: "relay-blur", origin: location.origin, nonce })
          .catch(() => {});
      focused = undefined;
      nonce = undefined;
      return;
    }
    if (input !== focused) {
      focused = input;
      nonce = crypto.randomUUID();
    }
    chrome.runtime
      .sendMessage({
        type: "relay-focus",
        origin: location.origin,
        nonce,
        kind: field,
      })
      .catch(() => {});
  }
  document.addEventListener("focusin", report, true);
  document.addEventListener("focusout", () => setTimeout(report, 0), true);
  setInterval(report, 1000);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message.type !== "relay-fill")
      return false;
    const c = message.command;
    const input = document.activeElement;
    const block = (reason) => reply({ status: "BLOCKED", reason });
    if (
      !c ||
      c.target.origin !== location.origin ||
      c.target.nonce !== nonce ||
      input !== focused ||
      kind(input) !== c.field
    )
      return block("FIELD_FOCUS_CHANGED");
    if (
      input.form &&
      new URL(input.form.action, location.href).origin !== location.origin
    )
      return block("FORM_ORIGIN_MISMATCH");
    if (
      c.field === "password" &&
      c.allowNewPassword &&
      input.form &&
      Array.from(input.form.querySelectorAll('input[type="password"]')).some(
        (field) =>
          field !== input &&
          (field.autocomplete === "current-password" ||
            /\bold\b|\bcurrent\b/i.test(
              [
                field.name,
                field.getAttribute("aria-label"),
                ...Array.from(field.labels || [], (l) => l.textContent),
              ]
                .filter(Boolean)
                .join(" "),
            )),
      )
    )
      return block("NEW_PASSWORD_REQUIRES_LOCAL_SETUP");
    if (
      c.field === "password" &&
      !c.allowNewPassword &&
      (input.autocomplete === "new-password" ||
        /new|confirm|verify/i.test(
          [
            input.name,
            input.getAttribute("aria-label"),
            ...Array.from(input.labels || [], (l) => l.textContent),
          ]
            .filter(Boolean)
            .join(" "),
        ))
    )
      return block("NEW_PASSWORD_REQUIRES_LOCAL_SETUP");
    if (typeof c.value !== "string" || c.value.length > 4096)
      return block("INVALID_COMMAND");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, c.value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (input.value !== c.value || !input.isConnected) {
      c.value = "";
      return block("FIELD_FOCUS_CHANGED");
    }
    c.value = "";
    reply({ status: "FILLED" });
    return false;
  });
})();

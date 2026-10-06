const BROKER = "http://127.0.0.1:4318/api/browser";
let polling = false;
async function request(path, body) {
  const { token } = await chrome.storage.local.get("token");
  if (!token) throw new Error("NOT_PAIRED");
  const response = await fetch(BROKER + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("BROKER_UNAVAILABLE");
  return response.json();
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const { command } = await request("/poll");
    if (!command) {
      await pollPrivateSignIn();
      return;
    }
    let result = { status: "BLOCKED", reason: "FIELD_FOCUS_CHANGED" };
    try {
      const tab = await chrome.tabs.get(command.target.tabId);
      if (new URL(tab.url).origin === command.target.origin) {
        result = await chrome.tabs.sendMessage(
          command.target.tabId,
          { type: "relay-fill", command },
          { frameId: command.target.frameId },
        );
      }
    } catch {}
    command.value = "";
    await request("/complete", {
      id: command.id,
      status: result?.status === "FILLED" ? "FILLED" : "BLOCKED",
      reason: result?.reason ?? "FIELD_FOCUS_CHANGED",
    });
  } catch {
  } finally {
    polling = false;
  }
}
async function pollPrivateSignIn() {
  const { jobs } = await request("/private-jobs");
  for (const job of jobs) {
    // Route only to the owner-configured Dot in this paired desktop profile.
    const path = `/dots/${job.dotId}`;
    const tabs = (
      await chrome.tabs.query({ url: "https://chatgpt.com/dots/*" })
    ).filter((tab) => {
      const url = new URL(tab.url);
      return (
        url.origin === "https://chatgpt.com" &&
        url.pathname === path &&
        !url.search &&
        !url.hash
      );
    });
    if (tabs.length !== 1) continue;
    const tabId = tabs[0].id;
    let inspected;
    try {
      inspected = await chrome.tabs.sendMessage(
        tabId,
        { type: "relay-private-inspect", job },
        { frameId: 0 },
      );
    } catch {
      continue;
    }
    if (inspected?.status !== "READY" || inspected.origin !== job.origin)
      continue;
    const delivery = await request("/private-delivery", {
      id: job.id,
      dotId: job.dotId,
      origin: inspected.origin,
      nonce: inspected.nonce,
      fields: inspected.fields,
      tabId,
    });
    let result;
    try {
      result = await chrome.tabs.sendMessage(
        tabId,
        { type: "relay-private-fill", delivery },
        { frameId: 0 },
      );
    } catch {}
    for (const entry of delivery.fields) entry.value = "";
    await request("/private-complete", {
      id: job.id,
      status: result?.status === "FILLED" ? "FILLED" : "BLOCKED",
    });
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === "relay-pair" && !sender.tab) {
    (async () => {
      const response = await fetch(BROKER + "/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: message.code }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("PAIRING_FAILED");
      const paired = await response.json();
      await chrome.storage.local.set({
        token: paired.token,
        companionId: paired.id,
      });
      await poll();
      reply({ status: "PAIRED" });
    })().catch(() =>
      reply({
        status: "BLOCKED",
        reason: "Check the pairing code and make sure Relay is running.",
      }),
    );
    return true;
  }
  if (message.type === "relay-status" && !sender.tab) {
    (async () => {
      const { token } = await chrome.storage.local.get("token");
      if (!token) return reply({ status: "NOT_PAIRED" });
      await request("/status");
      reply({ status: "PAIRED" });
    })().catch(() => reply({ status: "BROKER_UNAVAILABLE" }));
    return true;
  }
  if (
    !sender.tab ||
    sender.id !== chrome.runtime.id ||
    typeof sender.frameId !== "number"
  )
    return false;
  (async () => {
    const origin = new URL(sender.url).origin;
    if (origin !== new URL(sender.tab.url).origin || message.origin !== origin)
      return reply({ status: "BLOCKED" });
    if (message.type === "relay-focus") {
      await request("/focus", {
        tabId: sender.tab.id,
        frameId: sender.frameId,
        origin,
        nonce: message.nonce,
        kind: message.kind,
      });
      await poll();
    } else if (message.type === "relay-blur") {
      await request("/blur", { nonce: message.nonce });
    } else if (
      message.type === "relay-private-notice" &&
      origin === "https://chatgpt.com" &&
      sender.frameId === 0 &&
      /^\/dots\/[0-9a-f-]{36}$/.test(new URL(sender.url).pathname)
    ) {
      const active = message.active === true;
      if (
        active &&
        (new URL(message.websiteOrigin).protocol !== "https:" ||
          new URL(message.websiteOrigin).origin !== message.websiteOrigin)
      )
        return reply({ status: "BLOCKED" });
      await Promise.all([
        chrome.action.setBadgeText({
          tabId: sender.tab.id,
          text: active ? "!" : "",
        }),
        chrome.action.setBadgeBackgroundColor({
          tabId: sender.tab.id,
          color: "#ffbf69",
        }),
        chrome.action.setTitle({
          tabId: sender.tab.id,
          title: active
            ? `Approval needed: ${new URL(message.websiteOrigin).host}`
            : "Relay Private Autofill",
        }),
      ]);
    } else if (
      message.type === "relay-private-tick" &&
      origin === "https://chatgpt.com" &&
      sender.frameId === 0 &&
      /^\/dots\/[0-9a-f-]{36}$/.test(new URL(sender.url).pathname)
    ) {
      await poll();
    } else return reply({ status: "BLOCKED" });
    reply({ status: "OK" });
  })().catch(() => reply({ status: "BLOCKED" }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  // A notice belongs to one document; do not carry it onto another page.
  Promise.all([
    chrome.action.setBadgeText({ tabId, text: "" }),
    chrome.action.setTitle({ tabId, title: "Relay Private Autofill" }),
  ]).catch(() => {});
});

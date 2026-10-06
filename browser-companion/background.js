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
    if (!command) return;
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
    } else return reply({ status: "BLOCKED" });
    reply({ status: "OK" });
  })().catch(() => reply({ status: "BLOCKED" }));
  return true;
});

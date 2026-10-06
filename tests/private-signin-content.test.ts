import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { randomUUID } from "node:crypto";
const code = readFileSync(
  new URL("../browser-companion/private-signin.js", import.meta.url),
  "utf8",
);
function fixture() {
  let listener: Function;
  const intervals: Function[] = [];
  const sent: Record<string, unknown>[] = [];
  class Element {
    isConnected = true;
    disabled = false;
    readOnly = false;
    textContent = "";
    attributes: Record<string, string> = {};
    children: Record<string, Element[]> = {};
    dialog?: Element;
    clicks = 0;
    scrolls = 0;
    nodes: Element[] = [];
    shadow?: Element;
    handlers = new Map<string, Function>();
    getClientRects() {
      return this.isConnected ? [{}] : [];
    }
    getAttribute(key: string) {
      return this.attributes[key] ?? null;
    }
    querySelectorAll(selector: string) {
      return this.children[selector] ?? [];
    }
    closest() {
      return this.dialog;
    }
    click() {
      this.clicks++;
      this.handlers.get("click")?.();
    }
    setAttribute(key: string, value: string) {
      this.attributes[key] = value;
    }
    addEventListener(name: string, fn: Function) {
      this.handlers.set(name, fn);
    }
    append(...nodes: Element[]) {
      this.nodes.push(...nodes);
    }
    attachShadow() {
      this.shadow = new Element();
      return this.shadow;
    }
    remove() {
      this.isConnected = false;
    }
    scrollIntoView() {
      this.scrolls++;
    }
  }
  class Input extends Element {
    name = "";
    type = "text";
    autocomplete = "username";
    private stored = "";
    events: string[] = [];
    get value() {
      return this.stored;
    }
    set value(value: string) {
      this.stored = value;
    }
    dispatchEvent(event: { type: string }) {
      this.events.push(event.type);
    }
  }
  const origin = "https://employer.example";
  const job = {
    id: randomUUID(),
    dotId: randomUUID(),
    origin,
    expires: Date.now() + 300000,
  };
  const location = {
    origin: "https://chatgpt.com",
    pathname: `/dots/${job.dotId}`,
    search: "",
    hash: "",
    href: `https://chatgpt.com/dots/${job.dotId}`,
  };
  const dialog = new Element(),
    heading = new Element(),
    span = new Element(),
    form = new Element();
  heading.textContent = "Sign in to continue";
  dialog.children.h2 = [heading];
  span.textContent = origin;
  form.children.span = [span];
  form.dialog = dialog;
  form.attributes["aria-label"] = "Sign in to employer.example";
  Object.assign(form, { action: location.href });
  const username = new Input(),
    password = new Input();
  username.name = "browser-auth-field-username";
  username.attributes["aria-label"] = "Username or email address";
  password.name = "browser-auth-field-password";
  password.type = "password";
  password.autocomplete = "current-password";
  password.attributes["aria-label"] = "Password";
  form.children.input = [username, password];
  const button = new Element();
  button.textContent = "Sign in to employer.example";
  const document = new Element();
  const body = new Element();
  Object.assign(document, {
    title: "FraudBot",
    body,
    createElement: () => new Element(),
  });
  const approve = new Element();
  approve.textContent = "Sign in";
  form.children.button = [approve];
  document.children['form[data-dd-privacy="mask"]'] = [form];
  document.children['button[aria-haspopup="dialog"]'] = [button];
  new Script(code).runInContext(
    createContext({
      document,
      location,
      URL,
      Date,
      Set,
      Number,
      HTMLInputElement: Input,
      crypto: { randomUUID },
      getComputedStyle: () => ({
        visibility: "visible",
        display: "block",
        opacity: "1",
      }),
      Event: class {
        constructor(public type: string) {}
      },
      chrome: {
        runtime: {
          id: "fixture-extension",
          sendMessage: async (message: Record<string, unknown>) => {
            sent.push(message);
          },
          onMessage: {
            addListener: (fn: Function) => {
              listener = fn;
            },
          },
        },
      },
      setInterval: (fn: Function) => {
        intervals.push(fn);
        return 0;
      },
    }),
  );
  function message(
    type: string,
    data: Record<string, unknown>,
    senderId = "fixture-extension",
  ) {
    let result: any;
    listener({ type, ...data }, { id: senderId }, (r: unknown) => {
      result = r;
    });
    return result;
  }
  const inspect = () => message("relay-private-inspect", { job });
  const delivery = (nonce: string) => ({
    ...job,
    nonce,
    fields: [
      { field: "username", value: "fixture@relay.test" },
      { field: "password", value: "Fixture-only-secret!" },
    ],
  });
  const fill = (data: ReturnType<typeof delivery>) =>
    message("relay-private-fill", { delivery: data });
  const descendants = (element: Element): Element[] => [
    element,
    ...element.nodes.flatMap(descendants),
    ...(element.shadow ? descendants(element.shadow) : []),
  ];
  const notice = () =>
    body.nodes.find(
      (element) =>
        element.isConnected &&
        element.getAttribute("data-relay-approval-notice") !== null,
    );
  return {
    Element,
    job,
    origin,
    location,
    form,
    span,
    document,
    button,
    username,
    password,
    inspect,
    delivery,
    fill,
    message,
    sent,
    approve,
    notice,
    descendants,
    tick: () => intervals.forEach((fn) => fn()),
  };
}
describe("ChatGPT private-form companion", () => {
  it("notifies the owner after filling, without exposing values or clicking approval", () => {
    const f = fixture(),
      inspected = f.inspect();
    expect(f.notice()).toBeUndefined();
    expect(f.fill(f.delivery(inspected.nonce)).status).toBe("FILLED");
    const notice = f.notice()!;
    expect(notice).toBeDefined();
    const nodes = f.descendants(notice);
    expect(nodes.some((node) => node.getAttribute("role") === "alert")).toBe(
      true,
    );
    const text = nodes.map((node) => node.textContent).join(" ");
    expect(text).toContain("Approval needed");
    expect(text).toContain("employer.example");
    expect(text).not.toContain("Fixture-only-secret!");
    expect(text).not.toContain("fixture@relay.test");
    expect(JSON.stringify(f.sent)).not.toContain("Fixture-only-secret!");
    expect(f.sent).toContainEqual({
      type: "relay-private-notice",
      origin: "https://chatgpt.com",
      active: true,
      websiteOrigin: f.origin,
    });
    expect((f.document as any).title).toBe("Approval needed · FraudBot");
    expect(f.approve.clicks).toBe(0);
    expect(f.button.clicks).toBe(0);
    nodes.find((node) => node.textContent === "Show request")!.click();
    expect(f.form.scrolls).toBe(1);
    expect(f.approve.clicks).toBe(0);
  });
  it("opens only the matching collapsed request and dismisses the notice without approval", () => {
    const f = fixture(),
      inspected = f.inspect();
    f.fill(f.delivery(inspected.nonce));
    const nodes = f.descendants(f.notice()!);
    f.document.children['form[data-dd-privacy="mask"]'] = [];
    nodes.find((node) => node.textContent === "Show request")!.click();
    expect(f.button.clicks).toBe(1);
    expect(f.approve.clicks).toBe(0);
    nodes.find((node) => node.textContent === "Dismiss notice")!.click();
    expect(f.notice()).toBeUndefined();
    expect((f.document as any).title).toBe("FraudBot");
    expect(f.sent.at(-1)).toEqual({
      type: "relay-private-notice",
      origin: "https://chatgpt.com",
      active: false,
    });
    expect(f.approve.clicks).toBe(0);
  });
  it("clears expired/closed notices and never notifies for a blocked fill", () => {
    const expired = fixture(),
      inspected = expired.inspect();
    expired.fill(expired.delivery(inspected.nonce));
    expired.job.expires = Date.now() - 1;
    // The notification keeps its own expiry metadata; advance the clock instead.
    const oldNow = Date.now;
    Date.now = () => oldNow() + 300001;
    try {
      expired.tick();
    } finally {
      Date.now = oldNow;
    }
    expect(expired.notice()).toBeUndefined();
    expect((expired.document as any).title).toBe("FraudBot");
    const closed = fixture(),
      ready = closed.inspect();
    closed.fill(closed.delivery(ready.nonce));
    closed.document.children['form[data-dd-privacy="mask"]'] = [];
    closed.button.disabled = true;
    closed.tick();
    expect(closed.notice()).toBeUndefined();
    const blocked = fixture();
    blocked.inspect();
    expect(blocked.fill(blocked.delivery(randomUUID())).status).toBe("BLOCKED");
    expect(blocked.notice()).toBeUndefined();
    expect(blocked.sent.some((message) => message.active === true)).toBe(false);
  });
  it("counts the native nested address once and rejects separate duplicate markers", () => {
    const nested = fixture(),
      wrapper = new nested.Element();
    wrapper.textContent = nested.origin;
    wrapper.children.span = [nested.span];
    nested.form.children.span = [wrapper, nested.span];
    const inspected = nested.inspect();
    expect(inspected.status).toBe("READY");
    expect(nested.fill(nested.delivery(inspected.nonce)).status).toBe("FILLED");

    const duplicate = fixture(),
      other = new duplicate.Element();
    other.textContent = duplicate.origin;
    duplicate.form.children.span.push(other);
    expect(duplicate.inspect().status).not.toBe("READY");
    expect(duplicate.password.value).toBe("");

    const changed = fixture(),
      before = changed.inspect(),
      added = new changed.Element();
    added.textContent = changed.origin;
    changed.form.children.span.push(added);
    expect(changed.fill(changed.delivery(before.nonce)).status).toBe("BLOCKED");
    expect(changed.username.value).toBe("");
    expect(changed.password.value).toBe("");
  });
  it("supports native email/password fields when the website supplied no autocomplete", () => {
    const f = fixture();
    f.username.type = "email";
    f.username.autocomplete = "";
    f.username.attributes["aria-label"] = "Email address";
    f.password.autocomplete = "";
    f.password.attributes["aria-label"] = "Account password";
    const inspected = f.inspect();
    expect(inspected.status).toBe("READY");
    expect(f.fill(f.delivery(inspected.nonce)).status).toBe("FILLED");
  });
  it("preserves values the owner supplies before inspection or during delivery", () => {
    const entered = fixture();
    entered.password.value = "Owner-entered-fixture-secret!";
    expect(entered.inspect().status).toBe("WAITING_FOR_EMPTY_FORM");
    expect(entered.password.value).toBe("Owner-entered-fixture-secret!");
    const racing = fixture(),
      inspected = racing.inspect();
    racing.username.value = "owner-choice@relay.test";
    expect(racing.fill(racing.delivery(inspected.nonce)).status).toBe(
      "BLOCKED",
    );
    expect(racing.username.value).toBe("owner-choice@relay.test");
    expect(racing.password.value).toBe("");
  });
  it("fills only the matching private form, never submits, and returns no values", () => {
    const f = fixture(),
      inspected = f.inspect();
    expect(inspected.status).toBe("READY");
    expect(JSON.stringify(inspected)).not.toContain("Fixture-only-secret!");
    const result = f.fill(f.delivery(inspected.nonce));
    expect(result).toEqual({ status: "FILLED" });
    expect(f.password.value).toBe("Fixture-only-secret!");
    expect(f.username.events).toEqual(["input", "change"]);
    expect(f.button.clicks).toBe(0);
    expect(f.fill(f.delivery(inspected.nonce)).status).toBe("BLOCKED");
  });
  it("waits for and opens only a unique native trigger once", () => {
    const f = fixture();
    f.document.children['form[data-dd-privacy="mask"]'] = [];
    expect(f.inspect().status).toBe("WAITING_FOR_PRIVATE_FORM");
    f.inspect();
    expect(f.button.clicks).toBe(1);
    const other = fixture();
    other.document.children['form[data-dd-privacy="mask"]'] = [];
    other.document.children['button[aria-haspopup="dialog"]'] = [
      other.button,
      other.button,
    ];
    other.inspect();
    expect(other.button.clicks).toBe(0);
  });
  it("rejects another transport origin, Dot, displayed destination, form action, and normal account login", () => {
    const changes = [
      (f: ReturnType<typeof fixture>) => {
        f.location.origin = "https://evil.example";
      },
      (f: ReturnType<typeof fixture>) => {
        f.location.pathname = `/dots/${randomUUID()}`;
      },
      (f: ReturnType<typeof fixture>) => {
        f.span.textContent = "https://wrong.example";
      },
      (f: ReturnType<typeof fixture>) => {
        Object.assign(f.form, { action: "https://evil.example" });
      },
      (f: ReturnType<typeof fixture>) => {
        f.form.dialog = undefined;
      },
      (f: ReturnType<typeof fixture>) => {
        f.password.name = "password";
      },
    ];
    for (const change of changes) {
      const f = fixture();
      change(f);
      expect(f.inspect().status).not.toBe("READY");
      expect(f.password.value).toBe("");
    }
  });
  it("rejects stale nonce, changed fields, expired requests and extension impersonation", () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => {
        f.password.isConnected = false;
      },
      (f: ReturnType<typeof fixture>) => {
        f.password.autocomplete = "new-password";
      },
      (f: ReturnType<typeof fixture>) => {
        f.span.textContent = "https://wrong.example";
      },
    ]) {
      const f = fixture(),
        inspected = f.inspect();
      change(f);
      expect(f.fill(f.delivery(inspected.nonce)).status).toBe("BLOCKED");
      expect(f.username.value).toBe("");
      expect(f.password.value).toBe("");
    }
    const stale = fixture();
    stale.inspect();
    expect(stale.fill(stale.delivery(randomUUID())).status).toBe("BLOCKED");
    const expired = fixture();
    expired.job.expires = Date.now() - 1;
    expect(expired.inspect().status).toBe("BLOCKED");
    expect(
      expired.message(
        "relay-private-inspect",
        { job: expired.job },
        "other-extension",
      ),
    ).toBeUndefined();
  });
});

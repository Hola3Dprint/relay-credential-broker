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
  class Element {
    isConnected = true;
    disabled = false;
    readOnly = false;
    textContent = "";
    attributes: Record<string, string> = {};
    children: Record<string, Element[]> = {};
    dialog?: Element;
    clicks = 0;
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
          sendMessage: async () => {},
          onMessage: {
            addListener: (fn: Function) => {
              listener = fn;
            },
          },
        },
      },
      setInterval: () => 0,
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
  return {
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
  };
}
describe("ChatGPT private-form companion", () => {
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

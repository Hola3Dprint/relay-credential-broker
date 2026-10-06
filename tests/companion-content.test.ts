import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { randomUUID } from "node:crypto";
const code = readFileSync(
  new URL("../browser-companion/content.js", import.meta.url),
  "utf8",
);
function fixture() {
  let listener: Function;
  const events = new Map<string, Function>();
  const sent: Record<string, unknown>[] = [];
  class Input {
    type = "password";
    name = "password";
    autocomplete = "current-password";
    labels: { textContent: string }[] = [];
    disabled = false;
    readOnly = false;
    isConnected = true;
    form: { action: string; querySelectorAll: () => Input[] } | undefined;
    private stored = "";
    get value() {
      return this.stored;
    }
    set value(v: string) {
      this.stored = v;
    }
    getAttribute() {
      return null;
    }
    getClientRects() {
      return [{}];
    }
    dispatchEvent() {}
  }
  const input = new Input();
  const document = {
    activeElement: input,
    addEventListener: (name: string, fn: Function) => events.set(name, fn),
  };
  const chrome = {
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
  };
  new Script(code).runInContext(
    createContext({
      document,
      URL,
      chrome,
      HTMLInputElement: Input,
      crypto: { randomUUID },
      location: { origin: "https://company.example" },
      getComputedStyle: () => ({
        visibility: "visible",
        display: "block",
        opacity: "1",
      }),
      setInterval: () => 0,
      setTimeout: (fn: Function) => {
        fn();
        return 0;
      },
      Event: class {
        constructor(public type: string) {}
      },
    }),
  );
  events.get("focusin")!();
  function fill(
    overrides: Record<string, unknown> = {},
    target: Record<string, unknown> = {},
  ) {
    let result: any;
    listener(
      {
        type: "relay-fill",
        command: {
          field: "password",
          value: "Fixture-only-secret!",
          allowNewPassword: false,
          ...overrides,
          target: {
            origin: "https://company.example",
            nonce: sent[0].nonce,
            ...target,
          },
        },
      },
      { id: "fixture-extension" },
      (r: unknown) => {
        result = r;
      },
    );
    return result;
  }
  return { input, Input, document, sent, fill };
}
describe("Chrome companion content isolation", () => {
  it("fills through the native input setter and sends only metadata and acknowledgement", () => {
    const f = fixture();
    const result = f.fill();
    expect(f.input.value).toBe("Fixture-only-secret!");
    expect(result).toEqual({ status: "FILLED" });
    expect(JSON.stringify(f.sent)).not.toContain("Fixture-only-secret!");
    expect(JSON.stringify(result)).not.toContain("Fixture-only-secret!");
  });
  it("refuses stale focus, another origin, another form destination, or a changed field type", () => {
    expect(fixture().fill({}, { nonce: randomUUID() })).toHaveProperty(
      "status",
      "BLOCKED",
    );
    expect(
      fixture().fill({}, { origin: "https://attacker.example" }),
    ).toHaveProperty("status", "BLOCKED");
    const f = fixture();
    f.input.form = {
      action: "https://attacker.example/collect",
      querySelectorAll: () => [],
    };
    expect(f.fill()).toHaveProperty("reason", "FORM_ORIGIN_MISMATCH");
    expect(f.input.value).toBe("");
    f.input.form = undefined;
    f.input.type = "text";
    expect(f.fill()).toHaveProperty("reason", "FIELD_FOCUS_CHANGED");
    expect(f.input.value).toBe("");
  });
  it("requires signup approval for new-password fields and refuses password-change forms", () => {
    const f = fixture();
    f.input.autocomplete = "new-password";
    expect(f.fill()).toHaveProperty(
      "reason",
      "NEW_PASSWORD_REQUIRES_LOCAL_SETUP",
    );
    expect(f.fill({ allowNewPassword: true })).toHaveProperty(
      "status",
      "FILLED",
    );
    const old = new f.Input();
    old.name = "old-password";
    f.input.form = {
      action: "https://company.example/change",
      querySelectorAll: () => [old, f.input],
    };
    expect(f.fill({ allowNewPassword: true })).toHaveProperty(
      "reason",
      "NEW_PASSWORD_REQUIRES_LOCAL_SETUP",
    );
  });
});

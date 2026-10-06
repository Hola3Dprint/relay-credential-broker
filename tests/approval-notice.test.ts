import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { randomUUID } from "node:crypto";

const code = readFileSync(
  new URL("../browser-companion/background.js", import.meta.url),
  "utf8",
);
function fixture() {
  let listener: Function;
  let updated: Function;
  const actions: { operation: string; details: Record<string, unknown> }[] = [];
  const setAction =
    (operation: string) => async (details: Record<string, unknown>) => {
      actions.push({ operation, details });
    };
  new Script(code).runInContext(
    createContext({
      URL,
      chrome: {
        runtime: {
          id: "fixture-extension",
          onMessage: {
            addListener: (fn: Function) => {
              listener = fn;
            },
          },
        },
        tabs: {
          onUpdated: {
            addListener: (fn: Function) => {
              updated = fn;
            },
          },
        },
        action: {
          setBadgeText: setAction("text"),
          setBadgeBackgroundColor: setAction("color"),
          setTitle: setAction("title"),
        },
      },
    }),
  );
  const url = `https://chatgpt.com/dots/${randomUUID()}`;
  const sender = {
    id: "fixture-extension",
    frameId: 0,
    url,
    tab: { id: 7, url },
  };
  const send = (
    input: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) =>
    new Promise((resolve) => {
      const pending = listener(
        {
          type: "relay-private-notice",
          origin: "https://chatgpt.com",
          ...input,
        },
        { ...sender, ...overrides },
        resolve,
      );
      if (pending !== true) resolve(undefined);
    });
  return {
    actions,
    send,
    updated: (change: Record<string, unknown>) => updated(7, change),
  };
}
describe("private approval toolbar notice", () => {
  it("shows a per-tab approval badge and clears it without a broker call", async () => {
    const f = fixture();
    expect(
      await f.send({ active: true, websiteOrigin: "https://employer.example" }),
    ).toEqual({ status: "OK" });
    expect(f.actions).toContainEqual({
      operation: "text",
      details: { tabId: 7, text: "!" },
    });
    expect(f.actions).toContainEqual({
      operation: "title",
      details: { tabId: 7, title: "Approval needed: employer.example" },
    });
    expect(await f.send({ active: false })).toEqual({ status: "OK" });
    expect(f.actions.at(-1)).toEqual({
      operation: "title",
      details: { tabId: 7, title: "Relay Private Autofill" },
    });
    expect(f.actions).toContainEqual({
      operation: "text",
      details: { tabId: 7, text: "" },
    });
  });
  it("rejects another extension, child frame and non-Dot page", async () => {
    for (const override of [
      { id: "another-extension" },
      { frameId: 1 },
      { url: "https://chatgpt.com/settings" },
      {
        url: "https://evil.example/",
        tab: { id: 7, url: "https://evil.example/" },
      },
    ]) {
      const f = fixture();
      await f.send(
        { active: true, websiteOrigin: "https://employer.example" },
        override,
      );
      expect(f.actions).toEqual([]);
    }
  });
  it("rejects insecure, invalid and non-canonical destination origins", async () => {
    for (const websiteOrigin of [
      "http://employer.example",
      "https://employer.example/login",
      "not-a-url",
    ]) {
      const f = fixture();
      expect(await f.send({ active: true, websiteOrigin })).toEqual({
        status: "BLOCKED",
      });
      expect(f.actions).toEqual([]);
    }
  });
  it("clears the tab badge when navigation leaves the old document", async () => {
    const f = fixture();
    f.updated({ url: "https://another.example/" });
    expect(f.actions).toEqual([
      { operation: "text", details: { tabId: 7, text: "" } },
      {
        operation: "title",
        details: { tabId: 7, title: "Relay Private Autofill" },
      },
    ]);
  });
});

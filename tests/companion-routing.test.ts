import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

const code = readFileSync(
  new URL("../browser-companion/background.js", import.meta.url),
  "utf8",
);
async function route(tabs: any[], active: any[]) {
  const inspected: number[] = [];
  const job = {
    id: "test",
    dotId: "configured-dot",
    origin: "https://github.com",
  };
  const context = createContext({
    URL,
    AbortSignal,
    chrome: {
      storage: { local: { get: async () => ({ token: "public-test-token" }) } },
      tabs: {
        query: async (query: any) => (query.active ? active : tabs),
        sendMessage: async (id: number, message: any) => {
          if (message.type === "relay-private-inspect") {
            inspected.push(id);
            return {
              status: "READY",
              origin: job.origin,
              nonce: "test",
              fields: ["username"],
            };
          }
          return { status: "FILLED" };
        },
      },
      runtime: { onMessage: { addListener: () => {} } },
    },
    fetch: async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/private-jobs")
          ? { jobs: [job] }
          : url.endsWith("/private-delivery")
            ? { fields: [{ value: "public-test-value" }] }
            : {},
    }),
  });
  new Script(code).runInContext(context);
  await new Script("pollPrivateSignIn()").runInContext(context);
  return inspected;
}
const tab = (id: number, dot = "configured-dot") => ({
  id,
  url: `https://chatgpt.com/dots/${dot}`,
});
describe("private form routing", () => {
  it("routes a single matching Dot even when another site is active", async () => {
    expect(await route([tab(1)], [{ id: 9 }])).toEqual([1]);
  });
  it("uses only the active matching Dot when duplicate tabs exist", async () => {
    expect(await route([tab(1), tab(2)], [{ id: 2 }])).toEqual([2]);
  });
  it("refuses duplicate tabs when the focused tab is another Dot", async () => {
    expect(
      await route([tab(1), tab(2), tab(3, "other-dot")], [{ id: 3 }]),
    ).toEqual([]);
  });
  it("refuses an ambiguous active match", async () => {
    expect(await route([tab(1), tab(2)], [{ id: 1 }, { id: 2 }])).toEqual([]);
  });
});

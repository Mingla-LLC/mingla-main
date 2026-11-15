// MINGLA-INVARIANT: I-4238-META-NO-AUTO-SPA-PAGEVIEW | issue #4238 | every Meta pixel boot (server-rendered landing and the SPA runtime) sets fbq.disablePushState = true before init, so Meta's automatic history-change PageView never double-counts buyer routes or counts host dashboard routes; the app sends its own PageViews.
/**
 * Meta's SPA guide (developers.facebook.com/documentation/meta-pixel/
 * implementation/tag_spa, read 14 Nov 2026): fbq.disablePushState = true stops
 * PageView events on history state changes. Runs the real server-rendered
 * runtime in a VM and records the flag at the moment `init` is called. The SPA
 * half is the behavioural case in webAnalytics.ssrTakeover.issue4238.test.ts.
 */
import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { runInNewContext } from "node:vm";

jest.mock("../supabaseRpc", () => ({
  requestRpcJson: jest.fn(),
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-key",
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { publicAdRuntimeScript } = require("../publicAdRuntime") as {
  publicAdRuntimeScript: (input: Record<string, unknown>) => string;
};

const facts = {
  kind: "event",
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
};

beforeAll(() => {
  process.env.EXPO_PUBLIC_META_PIXEL_ID = "meta-4238";
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_META_PIXEL_ID;
});

test("the server-rendered Meta boot sets disablePushState before init", () => {
  const calls: Array<{ args: unknown[]; disablePushState: unknown }> = [];
  const script = () => ({ attrs: {}, setAttribute: () => undefined, remove: () => undefined });
  const context: Record<string, unknown> = {
    document: {
      readyState: "complete",
      referrer: "",
      cookie: "",
      head: { appendChild: () => undefined },
      body: { appendChild: () => undefined },
      documentElement: { style: { setProperty: () => undefined } },
      createElement: script,
      getElementsByTagName: () => [{ parentNode: { insertBefore: () => undefined } }],
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => undefined,
    },
    navigator: {},
    addEventListener: () => undefined,
    dispatchEvent: () => true,
    setTimeout: () => 0,
    location: { href: "https://host.usemingla.com/e/acme/signal-night" },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    fetch: () => Promise.resolve({ ok: true }),
    crypto: { randomUUID: () => "33333333-3333-4333-8333-333333333333" },
    console,
  };
  context.window = context;
  Object.defineProperty(context, "fbq", {
    configurable: true,
    get: () => context.__fbq,
    set: (fn: unknown) => {
      const wrapped = ((...args: unknown[]) => {
        calls.push({ args, disablePushState: (wrapped as unknown as { disablePushState?: unknown }).disablePushState });
        return (fn as (...a: unknown[]) => unknown)(...args);
      }) as unknown as Record<string, unknown>;
      context.__fbq = wrapped;
    },
  });
  try {
    runInNewContext(publicAdRuntimeScript({ facts }), context);
  } catch {
    // The privacy strip has no DOM here; the pixel boot runs before it.
  }
  const init = calls.find((c) => c.args[0] === "init");
  expect(init?.args[1]).toBe("meta-4238");
  expect(init?.disablePushState).toBe(true);
});

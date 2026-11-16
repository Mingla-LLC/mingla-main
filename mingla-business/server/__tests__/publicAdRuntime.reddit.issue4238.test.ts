// MINGLA-INVARIANT: I-4238-REDDIT-SSR | issue #4238 | every pixel id the SPA can boot (AdPixelIds) is also in the server-rendered pixel config, so a server-rendered landing boots Reddit like the other three.
/**
 * #4238 W2-2 (D5). The server-rendered landing config listed Meta, TikTok and
 * Snap only, so Reddit never saw PageVisit or ViewContent from an ad landing.
 */
import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  process.env.EXPO_PUBLIC_TIKTOK_PIXEL_CODE = "tiktok-4238";
  process.env.EXPO_PUBLIC_SNAP_PIXEL_ID = "snap-4238";
  process.env.EXPO_PUBLIC_REDDIT_PIXEL_ID = "a2_reddit4238";
});

afterAll(() => {
  delete process.env.EXPO_PUBLIC_META_PIXEL_ID;
  delete process.env.EXPO_PUBLIC_TIKTOK_PIXEL_CODE;
  delete process.env.EXPO_PUBLIC_SNAP_PIXEL_ID;
  delete process.env.EXPO_PUBLIC_REDDIT_PIXEL_ID;
});

function pixelsConfig(script: string): Record<string, unknown> {
  const match = /"pixels":(\{[^}]*\})/.exec(script);
  expect(match).not.toBeNull();
  return JSON.parse((match as RegExpExecArray)[1]) as Record<string, unknown>;
}

test("W2-2: the SSR config carries the Reddit pixel id and the boot inits Reddit", () => {
  const script = publicAdRuntimeScript({ facts });
  expect(pixelsConfig(script)).toEqual({
    meta: "meta-4238",
    tiktok: "tiktok-4238",
    snap: "snap-4238",
    reddit: "a2_reddit4238",
  });
  expect(script).toContain('rdt("init",c.pixels.reddit)');
  expect(script).toContain('setAttribute("data-mingla-pixel","reddit")');
});

test("W2-2: parity, the SSR pixel keys equal the SPA's AdPixelIds keys", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "src", "analytics", "adPixelRuntime.web.ts"),
    "utf8",
  );
  const body = /export interface AdPixelIds \{([^}]*)\}/.exec(source);
  expect(body).not.toBeNull();
  const spaKeys = [...(body as RegExpExecArray)[1].matchAll(/(\w+):/g)]
    .map((m) => m[1])
    .sort();
  expect(Object.keys(pixelsConfig(publicAdRuntimeScript({ facts }))).sort())
    .toEqual(spaKeys);
});

test("W2-2: on arrival the server runtime boots Reddit with PageVisit and ViewContent once", () => {
  const rdtCalls: unknown[][] = [];
  const scripts: Array<Record<string, unknown>> = [];
  const makeScript = (): Record<string, unknown> => {
    const attrs: Record<string, string> = {};
    const script: Record<string, unknown> = {
      attrs,
      setAttribute: (k: string, v: string) => {
        attrs[k] = v;
      },
      remove: () => undefined,
    };
    scripts.push(script);
    return script;
  };
  const document = {
    readyState: "complete",
    referrer: "",
    cookie: "",
    head: { appendChild: () => undefined },
    body: { appendChild: () => undefined },
    documentElement: { style: { setProperty: () => undefined } },
    createElement: () => makeScript(),
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => undefined } }],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => undefined,
  };
  const context: Record<string, unknown> = {
    document,
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
  // Capture the Reddit queue calls without loading pixel.js.
  Object.defineProperty(context, "rdt", {
    configurable: true,
    get: () => context.__rdt,
    set: (fn: unknown) => {
      context.__rdt = (...args: unknown[]) => {
        rdtCalls.push(args);
        return (fn as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  try {
    runInNewContext(publicAdRuntimeScript({ facts }), context);
  } catch {
    // The privacy strip has no DOM here; the pixel boot runs before it.
  }
  expect(rdtCalls).toEqual([
    ["init", "a2_reddit4238"],
    ["track", "PageVisit"],
    ["track", "ViewContent"],
  ]);
  expect(
    scripts.filter((s) => (s.attrs as Record<string, string>)["data-mingla-pixel"] === "reddit"),
  ).toHaveLength(1);
});

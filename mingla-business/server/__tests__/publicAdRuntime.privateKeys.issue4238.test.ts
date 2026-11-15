// MINGLA-INVARIANT: I-4238-NO-PRIVATE-TOKEN-TO-PIXELS | issue #4238 | the server-rendered public page runtime (server/publicAdRuntime.js) never starts a third-party ad pixel (Meta, TikTok, Snap, Reddit) in a document whose address carries a buyer return page's private key (bst, csi, cs, rcs, trxref, reference, token) in the query or the hash, on arrival or after a later privacy-bar "ads on" save; its key list equals src/utils/privateUrlTokens.ts PRIVATE_URL_QUERY_KEYS.
/**
 * Runs the real server-rendered runtime in a VM. Before this guard the inline
 * boot started all four pixels on /e/...?bst=..., before the app (and its own
 * private-key guard) had loaded. The real-browser half is
 * playwright/issue4238-private-key-pixels.spec.ts.
 */
import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { runInNewContext } from "node:vm";
import { PRIVATE_URL_QUERY_KEYS as APP_KEYS } from "../../src/utils/privateUrlTokens";

jest.mock("../supabaseRpc", () => ({
  requestRpcJson: jest.fn(),
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-key",
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runtime = require("../publicAdRuntime") as {
  publicAdRuntimeScript: (input: Record<string, unknown>) => string;
  PRIVATE_URL_QUERY_KEYS: readonly string[];
};

const facts = {
  kind: "event",
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
};

const PIXEL_ENV = {
  EXPO_PUBLIC_META_PIXEL_ID: "meta-4238",
  EXPO_PUBLIC_TIKTOK_PIXEL_CODE: "tiktok-4238",
  EXPO_PUBLIC_SNAP_PIXEL_ID: "snap-4238",
  EXPO_PUBLIC_REDDIT_PIXEL_ID: "reddit-4238",
};

beforeAll(() => {
  Object.assign(process.env, PIXEL_ENV);
});
afterAll(() => {
  for (const key of Object.keys(PIXEL_ENV)) delete process.env[key];
});

interface Run {
  scriptSources: string[];
  globals: Record<string, unknown>;
  emit: (name: string, detail: unknown) => void;
}

function run(search: string, hash = ""): Run {
  const scriptSources: string[] = [];
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const element = (): Record<string, unknown> => {
    const node: Record<string, unknown> = {
      setAttribute: () => undefined,
      remove: () => undefined,
    };
    Object.defineProperty(node, "src", {
      configurable: true,
      get: () => node.__src,
      set: (value: string) => {
        node.__src = value;
        scriptSources.push(value);
      },
    });
    return node;
  };
  const context: Record<string, unknown> = {
    document: {
      readyState: "complete",
      referrer: "",
      cookie: "",
      head: { appendChild: () => undefined },
      body: { appendChild: () => undefined },
      documentElement: { style: { setProperty: () => undefined } },
      createElement: element,
      getElementsByTagName: () => [{ parentNode: { insertBefore: () => undefined } }],
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => undefined,
    },
    navigator: {},
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
    dispatchEvent: () => true,
    setTimeout: () => 0,
    location: {
      href: `https://host.usemingla.com/e/acme/signal-night${search}${hash}`,
      search,
      hash,
    },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    fetch: () => Promise.resolve({ ok: true }),
    crypto: { randomUUID: () => "33333333-3333-4333-8333-333333333333" },
    console,
  };
  context.window = context;
  try {
    runInNewContext(runtime.publicAdRuntimeScript({ facts }), context);
  } catch {
    // The privacy strip has no DOM here; the pixel boot runs before it.
  }
  return {
    scriptSources,
    globals: context,
    emit: (name, detail) => {
      for (const fn of listeners.get(name) ?? []) {
        try {
          fn({ detail });
        } catch {
          // Same as above: the strip's DOM is absent in the VM.
        }
      }
    },
  };
}

const PIXEL_HOSTS = [
  "connect.facebook.net",
  "analytics.tiktok.com",
  "sc-static.net",
  "redditstatic.com",
];

function expectNoPixel(result: Run): void {
  for (const host of PIXEL_HOSTS) {
    expect(result.scriptSources.filter((src) => src.includes(host))).toEqual([]);
  }
  for (const name of ["fbq", "ttq", "snaptr", "rdt"]) {
    expect(result.globals[name]).toBeUndefined();
  }
  expect(result.globals.__minglaAdPixelsBootstrapped).not.toBe(true);
}

test("control: a public page without private keys boots all four pixels", () => {
  const result = run("?utm_source=ig");
  for (const host of PIXEL_HOSTS) {
    expect(result.scriptSources.some((src) => src.includes(host))).toBe(true);
  }
  expect(result.globals.__minglaAdPixelsBootstrapped).toBe(true);
});

test.each(APP_KEYS.map((key) => [key]))(
  "?%s=… in the query starts no pixel",
  (key) => {
    expectNoPixel(run(`?utm_source=ig&${key}=issue4238privatetoken`));
  },
);

test.each([
  ["#csi=issue4238privatetoken"],
  ["#reference=issue4238privatetoken"],
  ["#x=1&bst=issue4238privatetoken"],
])("hash %s starts no pixel", (hash) => {
  expectNoPixel(run("", hash));
});

test("an encoded private key (%3Fbst%3D) starts no pixel", () => {
  expectNoPixel(run("?next=%2Fo%2F1%3Fbst%3Dissue4238privatetoken"));
});

test("a later privacy-bar 'ads on' save still starts no pixel in a private document", () => {
  const result = run("?bst=issue4238privatetoken");
  result.emit("mingla:privacy-saved", { analytics: true, ads: true });
  expectNoPixel(result);
});

test("the server key list equals the app's PRIVATE_URL_QUERY_KEYS", () => {
  expect([...runtime.PRIVATE_URL_QUERY_KEYS]).toEqual([...APP_KEYS]);
});

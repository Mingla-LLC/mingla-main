/**
 * #3187 TESTER ADVERSARIAL — the angles the implementor suite does not attack.
 *
 * The implementor suite (issue3187CanonicalShareUrl.implementor.test.ts) proves
 * ONE fixture (a brand, version 1, freshly minted) through each transport, and
 * ONE version hop. This file attacks what a real share goes through instead:
 *
 *   A. OLD LINKS, RE-VERSIONED MANY TIMES. A link minted BEFORE this change is
 *      re-shared (`versionCreated:false`, its frozen server text still names
 *      `/s/<code>`), then the sheet's readiness check adopts newer versions —
 *      9 -> 10 -> 99 -> 100. Every hop crosses a digit boundary, so the old
 *      `ms=<code>.9` URL is a PREFIX of nothing but `.10` is a prefix-collision
 *      trap for any split/strip that works on the wrong URL. After EVERY hop, on
 *      BOTH apps and BOTH platforms, for ALL SIX public kinds, the paste text
 *      must hold exactly ONE link — the adopted version — no `/s/`, and no
 *      residue (a stray digit, a half URL) when compared with the server prose.
 *      This is the two-links failure mode hunted where it actually hides: after
 *      adoption, not on first prepare.
 *   B. THE VERSION CEILING. `ms` accepts at most 9 version digits. Adopting past
 *      it must fall back to the `/s/` link CONSISTENTLY — text and url item
 *      agree, still one link — never a canonical text with a `/s/` item.
 *   C. HOSTILE `ms` AT THE PAGE. Garbage, truncated, wrong version, duplicated
 *      (array-shaped), encoded, CR/LF, XSS-shaped, over-long — through the real
 *      `handlePublicSearchDocument`. Each must render 200 BYTE-IDENTICAL to the
 *      unattributed page (nothing reflected, nothing recorded), and must never
 *      ride a 308 into a Location header. Plus a positive control.
 *   D. APP / PAGE PARITY ON A DUPLICATED `ms`. expo-router hands a repeated
 *      query param to the route as an array; the web page reads
 *      `searchParams.get`. Both must attribute the SAME value, and the app must
 *      never record from anything but a well-formed value.
 *
 * Executed, not read: every assertion runs the shipped functions.
 */
import { readFileSync } from "fs";
import path from "path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let mockPlatformOS = "ios";
const mockShare = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockInvoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRpc = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
  Share: { share: (...args: unknown[]) => mockShare(...args) },
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
jest.mock("../../services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../services/appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));
jest.mock("../../analytics/webAnalytics", () => ({ captureWeb: jest.fn() }));
jest.mock("../../../server/supabaseRpc", () => ({
  requestRpcJson: (...args: unknown[]) => mockRpc(...args),
}));

// eslint-disable-next-line import/first
import { sharePublicUrl } from "../sharePublicUrl";
// eslint-disable-next-line import/first
import { adoptBusinessShareVersion, prepareBusinessContentShare } from "../../services/contentShareAdapter";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require("typescript") as typeof import("typescript");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharing = require("../../../../packages/sharing") as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require("../../../server/publicSearchDocument") as {
  handlePublicSearchDocument: (input: Record<string, unknown>) => Promise<void>;
};

const REPO = path.resolve(__dirname, "../../../..");
const CODE = "Zz9Yy8Xx7Ww6Vv5U";
const SHORT = `https://usemingla.com/s/${CODE}`;
const URL_RE = /https?:\/\/[^\s]+/g;

type Json = Record<string, any>;
type Payload = { title?: string; message?: string; url?: string };

/**
 * One fixture per public kind. `message` is the exact shape
 * `public.content_share_message_text` produces (migration 20270227001719):
 * concat_ws(E'\n', lead, detail+'.', plan, E'\n'||short link). Titles carry
 * `$&`, `$'`, `?`, `(`, `.` on purpose — a substitution built on
 * String.replace or a RegExp would corrupt them; split/join must not.
 */
const KINDS: Array<{ kind: string; destination: Json; message: string; publicUrl: string }> = [
  {
    kind: "event",
    destination: { kind: "event", brandSlug: "acme", eventSlug: "autumn-night", webPath: "/e/acme/autumn-night" },
    message: `Autumn Night $& Co. is Sat, Oct 4 at 8:00 PM.\nThe Loft (Rooftop).\n\n${SHORT}`,
    publicUrl: "https://host.usemingla.com/e/acme/autumn-night",
  },
  {
    kind: "rsvp_event",
    destination: { kind: "rsvp_event", brandSlug: "acme", eventSlug: "friday-drinks", webPath: "/e/acme/friday-drinks" },
    message: `Want to join Friday Drinks?\nRSVP closed.\n\n${SHORT}`,
    publicUrl: "https://host.usemingla.com/e/acme/friday-drinks",
  },
  {
    kind: "trip",
    destination: { kind: "trip", brandSlug: "acme", eventSlug: "lagos-weekend", webPath: "/t/acme/lagos-weekend" },
    message: `Take a look at Lagos Weekend in Lagos.\nOct 3 – Oct 5.\n\n${SHORT}`,
    publicUrl: "https://host.usemingla.com/t/acme/lagos-weekend",
  },
  {
    kind: "experience",
    destination: { kind: "experience", brandSlug: "acme", eventSlug: "pasta-class", webPath: "/exp/acme/pasta-class" },
    message: `How about Pasta Class $' in Brooklyn?\nSat, Oct 11.\n\n${SHORT}`,
    publicUrl: "https://host.usemingla.com/exp/acme/pasta-class",
  },
  {
    kind: "venue",
    destination: { kind: "venue", brandSlug: "acme", venueSlug: "the-loft", webPath: "/b/acme/v/the-loft" },
    message: `Check out The Loft in Williamsburg.\nBar.\n\n${SHORT}`,
    publicUrl: "https://host.usemingla.com/b/acme/v/the-loft",
  },
  {
    // No category -> no detail line: the shortest shape the formatter emits.
    kind: "brand",
    destination: { kind: "brand", brandSlug: "lanternroom", webPath: "/b/lanternroom" },
    message: `See what Lantern Room has coming up.\n\n${SHORT}`,
    publicUrl: "https://host.usemingla.com/b/lanternroom",
  },
];

/** Transpiles one real Explorer source file and runs it with ONLY the given imports. */
function loadTs(relative: string, stubs: Record<string, unknown>): Json {
  const source = readFileSync(path.join(REPO, relative), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: relative,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = { exports: {} as Json };
  const req = (id: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    throw new Error(`${relative} imported ${id}; the adversarial harness does not stub it`);
  };
  // eslint-disable-next-line no-new-func -- the shipped module's own source
  new Function("require", "module", "exports", outputText)(req, mod, mod.exports);
  return mod.exports;
}

function explorer(created: Json) {
  const calls: Payload[] = [];
  const rn = { Platform: { OS: "ios" }, Share: { share: async (payload: Payload) => { calls.push(payload); return {}; } } };
  const adapter = loadTs("app-mobile/src/services/contentShareAdapter.ts", {
    "react-native": rn,
    "@mingla/sharing": sharing,
    "./supabase": { supabase: { functions: { invoke: async () => ({ data: created, error: null }) } } },
    "./contentShareController": { openUnifiedContentShare: () => undefined },
    "./mixpanelService": { mixpanelService: { track: () => undefined } },
    "./appsFlyerService": { logAppsFlyerEvent: () => undefined },
  });
  return { adapter, rn, calls };
}

/** The share an edge returns for a link minted BEFORE #3187: an old version, its frozen /s/ text. */
const reShared = (fixture: (typeof KINDS)[number], version: number): Json => ({
  shortCode: CODE,
  version,
  versionCreated: false,
  message: fixture.message,
  facts: { schemaVersion: 1, kind: fixture.kind, title: "T" },
  media: null,
  destination: fixture.destination,
  publicDetails: null,
});

const proseOf = (text: string): string => text.replace(URL_RE, " ").replace(/\s+/g, " ").trim();

/**
 * THE paste invariant: exactly one link in the text, it is `expectedUrl`, no
 * `/s/` anywhere unless `/s/` is the expected link, the iOS url item agrees
 * with the text, Android carries no url item, and the prose is the server's
 * prose with nothing added or left behind.
 */
function assertOnePaste(payload: Payload, platform: "ios" | "android", expectedUrl: string, serverMessage: string, where: string): void {
  const text = payload.message ?? "";
  const links = text.match(URL_RE) ?? [];
  expect({ where, links }).toEqual({ where, links: [expectedUrl] });
  if (platform === "ios") expect({ where, url: payload.url }).toEqual({ where, url: expectedUrl });
  else expect({ where, hasUrlKey: Object.prototype.hasOwnProperty.call(payload, "url") }).toEqual({ where, hasUrlKey: false });
  if (!expectedUrl.includes("/s/")) expect({ where, s: JSON.stringify(payload).includes("usemingla.com/s/") }).toEqual({ where, s: false });
  expect({ where, prose: proseOf(text) }).toEqual({ where, prose: proseOf(serverMessage) });
}

const canonicalFor = (fixture: (typeof KINDS)[number], version: number): string =>
  `https://host.usemingla.com${fixture.destination.webPath}?ms=${CODE}.${version}`;

beforeEach(() => {
  mockPlatformOS = "ios";
  mockShare.mockReset();
  mockShare.mockResolvedValue({ action: "sharedAction" });
  mockInvoke.mockReset();
  mockRpc.mockReset();
});

describe("#3187 A — an old link, re-shared then re-versioned 9 -> 10 -> 99 -> 100, pastes ONE link on every surface", () => {
  const HOPS = [9, 10, 99, 100];

  test.each(KINDS.map((fixture) => [fixture.kind, fixture] as const))("%s — Explorer iOS + Android, every hop", async (_kind, fixture) => {
    const { adapter, rn, calls } = explorer(reShared(fixture, HOPS[0]));
    let prepared = await adapter.prepareContentShare(fixture.kind, {});
    for (const version of HOPS) {
      prepared = adapter.adoptContentShareVersion(prepared, version);
      const expected = canonicalFor(fixture, version);
      // Copy Link copies exactly `prepared.url`.
      expect({ version, copy: prepared.url }).toEqual({ version, copy: expected });
      // The server's own text is never rewritten, however many hops.
      expect(prepared.message).toBe(fixture.message);
      for (const platform of ["ios", "android"] as const) {
        rn.Platform.OS = platform;
        calls.length = 0;
        await adapter.sharePreparedContent(prepared);
        expect(calls).toHaveLength(1);
        assertOnePaste(calls[0], platform, expected, fixture.message, `explorer ${fixture.kind} v${version} ${platform}`);
      }
    }
    // Nothing to adopt (same or older version) is the same object — no silent re-derive.
    expect(adapter.adoptContentShareVersion(prepared, 100)).toBe(prepared);
    expect(adapter.adoptContentShareVersion(prepared, 50)).toBe(prepared);
  });

  test.each(KINDS.map((fixture) => [fixture.kind, fixture] as const))("%s — Host iOS + Android (the one ShareModal transport), every hop", async (_kind, fixture) => {
    mockInvoke.mockResolvedValue({ data: reShared(fixture, HOPS[0]), error: null });
    let prepared = await prepareBusinessContentShare(fixture.publicUrl);
    for (const version of HOPS) {
      prepared = adoptBusinessShareVersion(prepared, version);
      const expected = canonicalFor(fixture, version);
      expect({ version, copyAndQr: prepared.url }).toEqual({ version, copyAndQr: expected });
      expect(prepared.message).toBe(fixture.message);
      for (const platform of ["ios", "android"] as const) {
        mockPlatformOS = platform;
        mockShare.mockClear();
        // Exactly the call ShareModalContent makes.
        await sharePublicUrl({ title: prepared.title, url: prepared.url, description: (prepared as unknown as Json).shareMessage });
        expect(mockShare).toHaveBeenCalledTimes(1);
        assertOnePaste(mockShare.mock.calls[0][0] as Payload, platform, expected, fixture.message, `host ${fixture.kind} v${version} ${platform}`);
      }
    }
    expect(adoptBusinessShareVersion(prepared, 100)).toBe(prepared);
    expect(adoptBusinessShareVersion(prepared, 99)).toBe(prepared);
  });
});

describe("#3187 B — past the 9-digit version ceiling the share falls back to /s/ CONSISTENTLY", () => {
  test("Explorer + Host: version 999999999 is canonical; 1000000000 is the /s/ link in BOTH text and url item, still one link", async () => {
    const fixture = KINDS[0];
    const { adapter, rn, calls } = explorer(reShared(fixture, 999_999_998));
    const top = adapter.adoptContentShareVersion(await adapter.prepareContentShare(fixture.kind, {}), 999_999_999);
    expect(top.url).toBe(canonicalFor(fixture, 999_999_999));
    const over = adapter.adoptContentShareVersion(top, 1_000_000_000);
    expect(over.version).toBe(1_000_000_000);
    expect(over.url).toBe(SHORT);
    expect(over.canonicalShareUrl).toBeNull();
    for (const platform of ["ios", "android"] as const) {
      rn.Platform.OS = platform;
      calls.length = 0;
      await adapter.sharePreparedContent(over);
      assertOnePaste(calls[0], platform, SHORT, fixture.message, `explorer ceiling ${platform}`);
    }

    mockInvoke.mockResolvedValue({ data: reShared(fixture, 999_999_998), error: null });
    const hostTop = adoptBusinessShareVersion(await prepareBusinessContentShare(fixture.publicUrl), 999_999_999);
    expect(hostTop.url).toBe(canonicalFor(fixture, 999_999_999));
    const hostOver = adoptBusinessShareVersion(hostTop, 1_000_000_000);
    expect(hostOver.url).toBe(SHORT);
    for (const platform of ["ios", "android"] as const) {
      mockPlatformOS = platform;
      mockShare.mockClear();
      await sharePublicUrl({ title: hostOver.title, url: hostOver.url, description: (hostOver as unknown as Json).shareMessage });
      assertOnePaste(mockShare.mock.calls[0][0] as Payload, platform, SHORT, fixture.message, `host ceiling ${platform}`);
    }
  });
});

describe("#3187 C — hostile ms at the canonical page: rendered, never reflected, never recorded", () => {
  const response = () => {
    const headers: Record<string, string> = {};
    return {
      headers, statusCode: 0, body: "",
      setHeader(key: string, value: string) { headers[key.toLowerCase()] = String(value); },
      end(value?: string) { this.body = value ?? ""; },
    };
  };
  const EVENT_RESOLUTION = {
    valid: true, kind: "event", integrityOk: true, state: "public_noindex",
    facts: { kind: "event", eventType: "event", id: "evt-9", title: "Autumn Night", brandName: "Acme", brandSlug: "acme", actionAvailable: true, status: "upcoming" },
  };
  const render = async (query: string) => {
    mockRpc.mockResolvedValue(EVENT_RESOLUTION);
    const res = response();
    await publicSearch.handlePublicSearchDocument({ req: { method: "GET", url: `/e/acme/autumn-night${query}` }, res, kind: "event", slugs: ["acme", "autumn-night"] });
    return res;
  };
  const redirect = async (query: string) => {
    mockRpc.mockResolvedValue({ valid: true, kind: "event", integrityOk: true, state: "redirected", redirectTargetPath: "/e/acme/autumn-night-2" });
    const res = response();
    await publicSearch.handlePublicSearchDocument({ req: { method: "GET", url: `/e/acme/autumn-night${query}` }, res, kind: "event", slugs: ["acme", "autumn-night"] });
    return res;
  };

  const HOSTILE = [
    "?ms=", "?ms=garbage", `?ms=${CODE}`, `?ms=${CODE}.`, `?ms=${CODE}.0`, `?ms=${CODE}.01`, `?ms=${CODE}.-1`,
    `?ms=${CODE}.1e3`, `?ms=${CODE}.1.2`, `?ms=${CODE}.1000000000`, `?ms=${CODE.slice(0, 15)}.1`, `?ms=${CODE}Q.1`,
    `?ms=${CODE}.%EF%BC%91`, `?ms=${CODE}.%D9%A1`, `?ms=${CODE}.1+`, `?ms=${CODE}.1%0A`, `?ms=${CODE}.1%0D%0ALocation:%20https://evil.example`,
    `?ms=${CODE}.1%00`, "?ms=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E", `?ms=${CODE}.1%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E`,
    `?ms[]=${CODE}.1`, `?MS=${CODE}.1`, `?m%73x=${CODE}.1`, `?ms=${"A".repeat(10_000)}`, "?ms=__proto__", "?ms=constructor",
    `?ms=garbage&ms=${CODE}.2`,
  ];

  test("every hostile value renders 200, byte-identical to the unattributed page, and never reaches a 308 Location", async () => {
    const plain = await render("");
    expect(plain.statusCode).toBe(200);
    expect(plain.body).not.toContain("content-share-analytics");
    for (const query of HOSTILE) {
      const res = await render(query);
      expect({ query, status: res.statusCode }).toEqual({ query, status: 200 });
      expect({ query, identical: res.body === plain.body }).toEqual({ query, identical: true });
      const moved = await redirect(query);
      expect({ query, status: moved.statusCode }).toEqual({ query, status: 308 });
      expect({ query, location: moved.headers.location }).toEqual({ query, location: "https://host.usemingla.com/e/acme/autumn-night-2" });
    }
  });

  test("positive control: a valid ms is recorded once, with exactly {code, version, kind}, and is NOT leaked into canonical/og/CTA links", async () => {
    const res = await render(`?ms=${CODE}.7&utm_source=ig`);
    expect(res.statusCode).toBe(200);
    const scripts = res.body.match(/const base=(\{[^}]*\})/g) ?? [];
    expect(scripts).toEqual([`const base={"code":"${CODE}","version":7,"kind":"event"}`]);
    expect(res.body).toContain('data-share-destination="buy_tickets"');
    // Attribution must not be baked into anything a crawler, unfurler or a
    // re-sharing visitor would copy — or every re-share would credit the sender.
    expect(res.body).not.toMatch(/rel="canonical"[^>]*ms=/);
    expect(res.body).not.toMatch(/og:url"[^>]*ms=/);
    expect(res.body).not.toMatch(/href="[^"]*[?&]ms=/);
    // Encoded-but-valid is the same value.
    const encoded = await render(`?ms=${CODE}%2E7`);
    expect(encoded.body.match(/const base=(\{[^}]*\})/g)).toEqual([`const base={"code":"${CODE}","version":7,"kind":"event"}`]);
  });
});

describe("#3187 D — a duplicated ms: the app route and the web page attribute the SAME value", () => {
  const loadHook = () => {
    const recorded: unknown[] = [];
    const effects: Array<() => void> = [];
    const hook = loadTs("app-mobile/src/hooks/useCanonicalShareArrival.ts", {
      react: { useEffect: (fn: () => void) => { effects.push(fn); } },
      "../services/contentShareArrival": { recordCanonicalShareArrival: (raw: unknown) => { recorded.push(raw); return Promise.resolve("ignored"); } },
    });
    return { hook: hook.useCanonicalShareArrival as (ms: unknown) => void, effects, recorded };
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("expo-router's array for ?ms=a&ms=b and the page's searchParams.get pick the same element", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const page = require("../../../server/publicSharePageAnalytics") as { shareAttributionFromRequestUrl: (url: string, origin: string) => unknown };
    for (const [first, second] of [[`${CODE}.3`, "garbage"], ["garbage", `${CODE}.3`], [`${CODE}.3`, `${CODE}.4`]]) {
      const { hook, effects, recorded } = loadHook();
      hook([first, second]);
      effects.forEach((run) => run());
      await flush();
      const pageValue = page.shareAttributionFromRequestUrl(`/e/acme/x?ms=${first}&ms=${second}`, "https://host.usemingla.com");
      // The app hands the recorder the same raw value the page parses.
      expect({ first, second, app: recorded }).toEqual({ first, second, app: [first] });
      expect({ first, second, page: pageValue }).toEqual({ first, second, page: (sharing.parseShareAttributionValue as (v: unknown) => unknown)(first) });
    }
  });

  test("no ms, an empty ms or an empty array never loads the recorder at all", async () => {
    for (const value of [undefined, "", [], [""]]) {
      const { hook, effects, recorded } = loadHook();
      hook(value);
      effects.forEach((run) => run());
      await flush();
      expect({ value, recorded }).toEqual({ value, recorded: [] });
    }
  });
});

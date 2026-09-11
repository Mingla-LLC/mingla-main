/**
 * #3187 — a share sends the canonical page URL (with attribution), and the
 * pasted text carries it on both platforms.
 *
 * EXECUTED, NOT READ. Every transport assertion below runs the real shipped
 * code: the Business adapter and transport are imported directly; the Explorer
 * adapter and its arrival recorder are transpiled from their own source files
 * with their imports stubbed explicitly (an unstubbed import throws, so a new
 * dependency cannot be silently skipped). The page's analytics script is run
 * against a fake DOM and its request is fed to the real analytics handler.
 *
 * Lives in the required `mingla-business jest (full suite)` lane on purpose:
 * that lane runs every `__tests__` file on every PR, so this needs no new CI
 * lane (I-2148-CI-TOPOLOGY-BOUNDED) and no workflow edit.
 */
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

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

type SharingModule = typeof import("@mingla/sharing");
type Handler = (req: unknown, res: unknown) => Promise<unknown>;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require("typescript") as typeof import("typescript");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharing = require("../../../../packages/sharing") as SharingModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require("../../../server/publicSearchDocument") as {
  renderVisibleDocument: (input: Record<string, unknown>) => string;
  handlePublicSearchDocument: (input: Record<string, unknown>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createContentShareAnalyticsHandler } = require("../../../api/content-share-analytics") as {
  createContentShareAnalyticsHandler: (send?: (url: string, init: { body: string }) => Promise<unknown>) => Handler;
};

const REPO = path.resolve(__dirname, "../../../..");
const read = (relative: string): string => readFileSync(path.join(REPO, relative), "utf8");

const CODE = "Aa0Bb1Cc2Dd3Ee4F";
const SHORT = `https://usemingla.com/s/${CODE}`;
const CANONICAL_V1 = `https://host.usemingla.com/b/lanternroom?ms=${CODE}.1`;
// Exactly what `public.content_share_message_text` returns for kind 'brand',
// title 'Lantern Room', category 'Bar' (migration 20270227001719, line 39):
// concat_ws(E'\n', lead, detail, NULL, E'\n' || short link).
const SERVER_MESSAGE = `See what Lantern Room has coming up.\nBar.\n\n${SHORT}`;
const BRAND_DESTINATION = { kind: "brand", brandSlug: "lanternroom", webPath: "/b/lanternroom" };
const BRAND_FACTS = { schemaVersion: 1, kind: "brand", title: "Lantern Room", category: "Bar" };

/** Transpiles one real source file and evaluates it with ONLY the given imports. */
function loadSource(relative: string, stubs: Record<string, unknown>): Record<string, unknown> {
  const fileName = path.join(REPO, relative);
  const { outputText } = ts.transpileModule(read(relative), {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  });
  const sandboxModule = { exports: {} as Record<string, unknown> };
  const localRequire = (id: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    throw new Error(`${relative} imported ${id}, which this harness does not stub`);
  };
  // eslint-disable-next-line no-new-func -- the shipped module's own source, read from disk
  new Function("require", "module", "exports", outputText)(localRequire, sandboxModule, sandboxModule.exports);
  return sandboxModule.exports;
}

/** The Explorer adapter, executed from source over a controllable RN + edge. */
function loadExplorerAdapter(created: Record<string, unknown>) {
  const rn = { Platform: { OS: "ios" }, Share: { share: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})) } };
  const adapter = loadSource("app-mobile/src/services/contentShareAdapter.ts", {
    "react-native": rn,
    "@mingla/sharing": sharing,
    "./supabase": { supabase: { functions: { invoke: async () => ({ data: created, error: null }) } } },
    "./contentShareController": { openUnifiedContentShare: () => undefined },
    "./mixpanelService": { mixpanelService: { track: () => undefined } },
    "./appsFlyerService": { logAppsFlyerEvent: () => undefined },
  }) as {
    prepareContentShare: (kind: string, identity: Record<string, string>) => Promise<Record<string, any>>;
    sharePreparedContent: (prepared: Record<string, any>) => Promise<void>;
    adoptContentShareVersion: (prepared: Record<string, any>, version: number) => Record<string, any>;
  };
  return { adapter, rn };
}

const created = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  shortCode: CODE,
  version: 1,
  versionCreated: true,
  message: SERVER_MESSAGE,
  facts: BRAND_FACTS,
  media: null,
  destination: BRAND_DESTINATION,
  publicDetails: null,
  ...overrides,
});

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

beforeEach(() => {
  mockPlatformOS = "ios";
  mockShare.mockReset();
  mockShare.mockResolvedValue({ action: "sharedAction" });
  mockInvoke.mockReset();
  mockRpc.mockReset();
});

describe("#3187 package — one builder, scoped by destination.webPath", () => {
  test("T1 every kind with a public page gets its canonical URL plus attribution", () => {
    const destinations: Array<[Record<string, string>, string]> = [
      [{ kind: "event", brandSlug: "acme", eventSlug: "night", webPath: "/e/acme/night" }, "/e/acme/night"],
      [{ kind: "rsvp_event", brandSlug: "acme", eventSlug: "drinks", webPath: "/e/acme/drinks" }, "/e/acme/drinks"],
      [{ kind: "trip", brandSlug: "acme", eventSlug: "lagos", webPath: "/t/acme/lagos" }, "/t/acme/lagos"],
      [{ kind: "experience", brandSlug: "acme", eventSlug: "tasting", webPath: "/exp/acme/tasting" }, "/exp/acme/tasting"],
      [{ kind: "venue", brandSlug: "acme", venueSlug: "loft", webPath: "/b/acme/v/loft" }, "/b/acme/v/loft"],
      [BRAND_DESTINATION, "/b/lanternroom"],
    ];
    for (const [destination, webPath] of destinations) {
      expect(sharing.buildCanonicalShareUrl(destination, CODE, 7)).toBe(`https://host.usemingla.com${webPath}?ms=${CODE}.7`);
    }
  });

  test("T2 place and curated have no public page and fall back to null", () => {
    expect(sharing.buildCanonicalShareUrl({ kind: "place", placeId: "ChIJ" }, CODE, 1)).toBeNull();
    expect(sharing.buildCanonicalShareUrl({ kind: "curated" }, CODE, 1)).toBeNull();
  });

  test("T3 a hostile or malformed webPath yields null and never throws", () => {
    const hostile = [
      "//evil.example/p", "https://evil.example", "/b/x?next=https://evil.example", "/b/x#f", "/b/x%23f?", "",
      "safe/../../escape", "/b/../admin", "/b/%2e%2e/admin", "/b/./x", "/b/x\\y", "/b/x y", `/${"a".repeat(512)}`,
    ];
    for (const webPath of hostile) {
      expect(() => sharing.buildCanonicalShareUrl({ kind: "brand", webPath }, CODE, 1)).not.toThrow();
      expect(sharing.buildCanonicalShareUrl({ kind: "brand", webPath }, CODE, 1)).toBeNull();
    }
    for (const destination of [undefined, null, "string", [], { kind: "brand" }, { webPath: 42 }]) {
      expect(sharing.buildCanonicalShareUrl(destination, CODE, 1)).toBeNull();
    }
    expect(sharing.buildCanonicalShareUrl(BRAND_DESTINATION, "short", 1)).toBeNull();
    for (const version of [0, -1, 1.5, Number.NaN, 1_000_000_000]) {
      expect(sharing.buildCanonicalShareUrl(BRAND_DESTINATION, CODE, version)).toBeNull();
    }
  });

  test("T4 the attribution value round-trips exactly and rejects near-misses", () => {
    for (const version of [1, 2, 99, 999_999_999]) {
      expect(sharing.parseShareAttributionValue(sharing.buildShareAttributionValue(CODE, version))).toEqual({ code: CODE, version });
    }
    for (const value of [`${CODE}.0`, `${CODE}.`, ".1", `${CODE}.1.2`, "short.1", `${CODE}.01`, `${CODE}1.1`, ` ${CODE}.1`, 7, null, undefined]) {
      expect(sharing.parseShareAttributionValue(value)).toBeNull();
    }
    expect(() => sharing.buildShareAttributionValue(CODE, 0)).toThrow("invalid_share_attribution");
  });
});

describe("#3187 executed transports — what lands in the paste", () => {
  test("T5 Explorer iOS: text ends with the canonical link AND the url item is canonical; no /s/", async () => {
    const { adapter, rn } = loadExplorerAdapter(created());
    rn.Platform.OS = "ios";
    const prepared = await adapter.prepareContentShare("brand", { brandSlug: "lanternroom" });
    await adapter.sharePreparedContent(prepared);
    expect(rn.Share.share).toHaveBeenCalledTimes(1);
    expect(rn.Share.share.mock.calls[0][0]).toEqual({
      title: "Lantern Room",
      message: `See what Lantern Room has coming up.\nBar.\n${CANONICAL_V1}`,
      url: CANONICAL_V1,
    });
    const payload = rn.Share.share.mock.calls[0][0] as { message: string };
    expect(count(payload.message, CANONICAL_V1)).toBe(1);
    expect(JSON.stringify(rn.Share.share.mock.calls)).not.toContain("usemingla.com/s/");
  });

  test("T5 Explorer Android: the server prose verbatim, only the link replaced; no url key; no /s/", async () => {
    const { adapter, rn } = loadExplorerAdapter(created());
    rn.Platform.OS = "android";
    const prepared = await adapter.prepareContentShare("brand", { brandSlug: "lanternroom" });
    await adapter.sharePreparedContent(prepared);
    expect(rn.Share.share.mock.calls[0][0]).toEqual({
      title: "Lantern Room",
      message: `See what Lantern Room has coming up.\nBar.\n\n${CANONICAL_V1}`,
    });
    expect(JSON.stringify(rn.Share.share.mock.calls)).not.toContain("usemingla.com/s/");
    // The server's own text is still held verbatim — only the derived copy moved.
    expect(prepared.message).toBe(SERVER_MESSAGE);
  });

  test("T5 Business iOS (all 14 ShareModal sites): text ends with the canonical link AND url is canonical; no /s/", async () => {
    mockPlatformOS = "ios";
    mockInvoke.mockResolvedValue({ data: created(), error: null });
    const prepared = await prepareBusinessContentShare("https://host.usemingla.com/b/lanternroom");
    await sharePublicUrl({ title: prepared.title, url: prepared.url, description: prepared.shareMessage });
    expect(mockShare.mock.calls[0][0]).toEqual({
      title: "Lantern Room",
      message: `See what Lantern Room has coming up.\nBar.\n${CANONICAL_V1}`,
      url: CANONICAL_V1,
    });
    expect(count((mockShare.mock.calls[0][0] as { message: string }).message, CANONICAL_V1)).toBe(1);
    expect(JSON.stringify(mockShare.mock.calls)).not.toContain("usemingla.com/s/");
  });

  test("T5 Business Android: canonical link in the text once, no url key, no /s/", async () => {
    mockPlatformOS = "android";
    mockInvoke.mockResolvedValue({ data: created(), error: null });
    const prepared = await prepareBusinessContentShare("https://host.usemingla.com/b/lanternroom");
    await sharePublicUrl({ title: prepared.title, url: prepared.url, description: prepared.shareMessage });
    expect(mockShare.mock.calls[0][0]).toEqual({
      title: "Lantern Room",
      message: `See what Lantern Room has coming up.\nBar.\n${CANONICAL_V1}`,
    });
    expect(JSON.stringify(mockShare.mock.calls)).not.toContain("usemingla.com/s/");
  });

  test("SC-9 Copy Link copies the canonical URL on both apps — the field the sheets copy is `url`", async () => {
    mockInvoke.mockResolvedValue({ data: created(), error: null });
    const business = await prepareBusinessContentShare("https://host.usemingla.com/b/lanternroom");
    expect(business.url).toBe(CANONICAL_V1);
    const { adapter } = loadExplorerAdapter(created());
    const explorer = await adapter.prepareContentShare("brand", { brandSlug: "lanternroom" });
    expect(explorer.url).toBe(CANONICAL_V1);
    // Both sheets copy, QR-encode and share exactly `prepared.url`.
    const sheet = read("mingla-business/src/components/ui/ShareModalContent.tsx");
    expect(sheet).toContain("await copyPublicUrl(prepared.url)");
    expect(sheet).toContain("<QRCode value={prepared.url}");
    expect(sheet).toContain("url: prepared.url, description: prepared.shareMessage");
    expect(read("app-mobile/src/components/share/UnifiedShareProvider.tsx")).toContain("Clipboard.setString(prepared.url)");
  });

  test("SC-8 place and curated keep the /s/ link and the untouched server message", async () => {
    for (const [kind, destination] of [["place", { kind: "place", placeId: "ChIJ" }], ["curated", { kind: "curated" }]] as const) {
      const message = `How about Namu?\nKorean.\n\n${SHORT}`;
      const { adapter, rn } = loadExplorerAdapter(created({ message, destination, facts: { schemaVersion: 1, kind, title: "Namu" } }));
      const prepared = await adapter.prepareContentShare(kind, {});
      expect(prepared.url).toBe(SHORT);
      expect(prepared.canonicalShareUrl).toBeNull();
      expect(prepared.shareMessage).toBe(message);
      rn.Platform.OS = "android";
      await adapter.sharePreparedContent(prepared);
      expect(rn.Share.share.mock.calls[0][0]).toEqual({ title: "Namu", message });
    }
  });

  test("SC-10 a missing or hostile webPath falls back to exactly today's /s/ share", async () => {
    for (const destination of [{ kind: "brand", brandSlug: "x" }, { kind: "brand", webPath: "//evil.example/x" }, { kind: "brand", webPath: "/b/x?next=1" }]) {
      const { adapter } = loadExplorerAdapter(created({ destination }));
      const prepared = await adapter.prepareContentShare("brand", { brandSlug: "x" });
      expect(prepared.url).toBe(SHORT);
      expect(prepared.shareMessage).toBe(SERVER_MESSAGE);
      expect(prepared.shareMessage).not.toContain("evil.example");
    }
  });

  test("T8 adopting version N+1 re-derives the URL and text; nothing to adopt returns the same object", async () => {
    const { adapter } = loadExplorerAdapter(created({ version: 3 }));
    const explorer = await adapter.prepareContentShare("brand", { brandSlug: "lanternroom" });
    const explorerNext = adapter.adoptContentShareVersion(explorer, 4);
    expect(explorerNext.url).toBe(`https://host.usemingla.com/b/lanternroom?ms=${CODE}.4`);
    expect(explorerNext.shareMessage.endsWith(explorerNext.url)).toBe(true);
    expect(explorerNext.message).toBe(SERVER_MESSAGE);
    expect(adapter.adoptContentShareVersion(explorer, 3)).toBe(explorer);

    mockInvoke.mockResolvedValue({ data: created({ version: 3 }), error: null });
    const business = await prepareBusinessContentShare("https://host.usemingla.com/b/lanternroom");
    const businessNext = adoptBusinessShareVersion(business, 4);
    expect(businessNext.url).toBe(`https://host.usemingla.com/b/lanternroom?ms=${CODE}.4`);
    expect(businessNext.shareMessage.endsWith(businessNext.url)).toBe(true);
    expect(adoptBusinessShareVersion(business, 2)).toBe(business);
  });

  test("the #1615 semantic gate still passes over the whole repository", () => {
    const run = spawnSync(process.execPath, [path.join(REPO, "scripts/issue-1615/content-sharing-semantic-gate.mjs")], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).ok).toBe(true);
  });
});

describe("#3187 canonical page — the same share analytics the interstitial fires", () => {
  const eventFacts = (eventType: string): Record<string, unknown> => ({
    kind: "event", eventType, id: "evt-1", title: "Autumn Night", brandName: "Acme", brandSlug: "acme",
    actionAvailable: true, status: "upcoming",
  });

  const response = () => {
    const headers: Record<string, string> = {};
    return {
      headers, statusCode: 0, body: "",
      setHeader(key: string, value: string) { headers[key.toLowerCase()] = value; },
      end(value?: string) { this.body = value ?? ""; },
    };
  };

  /** Runs the page's analytics script against a fake DOM; returns what it posted. */
  const runPageScript = (html: string, consent: string | null) => {
    const match = html.match(/<script>(\(\(\)=>\{const base=[\s\S]*?)<\/script>/);
    if (!match) return { posted: [] as Array<Record<string, any>>, click: () => undefined };
    const posted: Array<Record<string, any>> = [];
    const listeners: Array<() => void> = [];
    const cta = html.match(/data-share-destination="([^"]+)"/);
    const nodes = cta ? [{ dataset: { shareDestination: cta[1] }, addEventListener: (_: string, fn: () => void) => listeners.push(fn) }] : [];
    const fetchStub = (url: string, init: Record<string, any>) => { posted.push({ url, ...init }); return Promise.resolve(); };
    // eslint-disable-next-line no-new-func -- the page's own emitted script
    new Function("localStorage", "document", "fetch", match[1])(
      { getItem: () => consent },
      { querySelectorAll: () => nodes },
      fetchStub,
    );
    return { posted, click: () => listeners.forEach((fn) => fn()) };
  };

  test("T9/SC-7 without ms the page is byte-identical and carries no share script or attribute", () => {
    const base = { facts: eventFacts("event"), state: "public_noindex", canonicalPath: "/e/acme/autumn-night" };
    const plain = publicSearch.renderVisibleDocument(base);
    expect(publicSearch.renderVisibleDocument({ ...base, shareAttribution: null })).toBe(plain);
    expect(plain).not.toContain("data-share-destination");
    expect(plain).not.toContain("content-share-analytics");
  });

  test("T9/T10/T11 with ms: the viewed + destination events reach the real handler with the exact keys it accepts", async () => {
    for (const [eventType, kind, action] of [["event", "event", "buy_tickets"], ["rsvp", "rsvp_event", "rsvp"]] as const) {
      const html = publicSearch.renderVisibleDocument({
        facts: eventFacts(eventType), state: "public_noindex", canonicalPath: "/e/acme/autumn-night",
        shareAttribution: { code: CODE, version: 3 },
      });
      expect(html).toContain(`data-share-destination="${action}"`);
      const page = runPageScript(html, JSON.stringify({ choice: "granted" }));
      page.click();
      expect(page.posted.map((request) => JSON.parse(request.body))).toEqual([
        { event: "share_public_page_viewed", code: CODE, version: 3, kind },
        { event: "share_destination_action", code: CODE, version: 3, kind, action },
      ]);
      for (const request of page.posted) {
        expect(request.url).toBe("/api/content-share-analytics");
        expect(request.keepalive).toBe(true);
        expect(request.headers).toEqual({ "content-type": "application/json" });
      }

      const previousKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
      process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_test3187";
      try {
        const forwarded: Array<Record<string, any>> = [];
        const handler = createContentShareAnalyticsHandler(async (_url, init) => { forwarded.push(JSON.parse(init.body)); return {}; });
        for (const request of page.posted) {
          const res = response();
          await handler({ method: "POST", headers: { origin: "https://host.usemingla.com" }, body: JSON.parse(request.body) }, res);
          expect(res.statusCode).toBe(204);
        }
        expect(forwarded.map((body) => [body.event, body.properties.short_code, body.properties.version, body.properties.content_kind])).toEqual([
          ["share_public_page_viewed", CODE, 3, kind],
          ["share_destination_action", CODE, 3, kind],
        ]);
        // The exact-keys contract is respected, not assumed: one extra key is refused.
        const res = response();
        await handler({ method: "POST", headers: { origin: "https://host.usemingla.com" }, body: { ...JSON.parse(page.posted[0].body), extra: 1 } }, res);
        expect(res.statusCode).toBe(400);
      } finally {
        if (previousKey === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
        else process.env.EXPO_PUBLIC_POSTHOG_KEY = previousKey;
      }
    }
  });

  test("consent absent, denied or malformed sends nothing", () => {
    const html = publicSearch.renderVisibleDocument({
      facts: { kind: "brand", id: "b-1", title: "Lantern Room" }, state: "public_noindex", canonicalPath: "/b/lanternroom",
      shareAttribution: { code: CODE, version: 1 },
    });
    for (const consent of [null, JSON.stringify({ choice: "denied" }), "not-json"]) {
      expect(runPageScript(html, consent).posted).toEqual([]);
    }
    expect(runPageScript(html, JSON.stringify({ value: "granted" })).posted.map((request) => JSON.parse(request.body))).toEqual([
      { event: "share_public_page_viewed", code: CODE, version: 1, kind: "brand" },
    ]);
  });

  test("the request's ms reaches the page, and survives a 308 to a renamed page", async () => {
    mockRpc.mockResolvedValue({
      valid: true, kind: "brand", integrityOk: true, state: "public_noindex",
      facts: { kind: "brand", id: "b-1", title: "Lantern Room" },
    });
    const res = response();
    await publicSearch.handlePublicSearchDocument({ req: { method: "GET", url: `/api/public-brand?brandSlug=lanternroom&ms=${CODE}.2` }, res, kind: "brand", slugs: ["lanternroom"] });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`"code":"${CODE}","version":2,"kind":"brand"`);

    const malformed = response();
    await publicSearch.handlePublicSearchDocument({ req: { method: "GET", url: `/b/lanternroom?ms=${CODE}.0` }, res: malformed, kind: "brand", slugs: ["lanternroom"] });
    expect(malformed.body).not.toContain("content-share-analytics");

    mockRpc.mockResolvedValue({ valid: true, kind: "brand", integrityOk: true, state: "redirected", redirectTargetPath: "/b/lantern-room" });
    const moved = response();
    await publicSearch.handlePublicSearchDocument({ req: { method: "GET", url: `/b/lanternroom?utm_source=x&ms=${CODE}.2` }, res: moved, kind: "brand", slugs: ["lanternroom"] });
    expect(moved.statusCode).toBe(308);
    expect(moved.headers.location).toBe(`https://host.usemingla.com/b/lantern-room?utm_source=x&ms=${CODE}.2`);
  });
});

describe("#3187 installed app — a canonical link records what /s/ recorded", () => {
  const loadArrival = () => {
    const attribution = loadSource("app-mobile/src/services/contentShareAttribution.ts", { "@mingla/sharing": sharing });
    const service = loadSource("app-mobile/src/services/contentShareService.ts", { "@mingla/sharing": sharing });
    return loadSource("app-mobile/src/services/contentShareArrival.ts", {
      "@react-native-async-storage/async-storage": { __esModule: true, default: {} },
      "@mingla/sharing": sharing,
      "./contentShareService": service,
      "./contentShareAttribution": attribution,
      "./mixpanelService": { mixpanelService: { track: () => undefined } },
      "./appsFlyerService": { logAppsFlyerEvent: () => undefined },
    }) as {
      recordCanonicalShareArrival: (raw: unknown, deps: Record<string, unknown>) => Promise<string>;
    } & { ContentShareReadError?: never };
  };

  const deps = (read: (code: string) => Promise<unknown>) => {
    const stored = new Map<string, string>();
    const captured: Array<[string, Record<string, unknown>]> = [];
    return {
      stored, captured,
      value: {
        read,
        storage: { getItem: async (k: string) => stored.get(k) ?? null, setItem: async (k: string, v: string) => { stored.set(k, v); }, removeItem: async (k: string) => { stored.delete(k); } },
        capture: (event: string, properties: Record<string, unknown>) => captured.push([event, properties]),
      },
    };
  };

  test("a valid ms persists {shortCode, version} and records share_native_opened, as /s/ does", async () => {
    const arrival = loadArrival();
    const calls: string[] = [];
    const harness = deps(async (code) => { calls.push(code); return { shortCode: code, version: 5, facts: { kind: "event" } }; });
    await expect(arrival.recordCanonicalShareArrival(`${CODE}.2`, harness.value)).resolves.toBe("recorded");
    expect(calls).toEqual([CODE]);
    expect(JSON.parse(harness.stored.get("@mingla_content_share_attribution") ?? "null")).toEqual({ shortCode: CODE, version: 5 });
    expect(harness.captured).toEqual([["share_native_opened", {
      kind: "event", version: 5, short_code: CODE, recipient_app: "consumer",
      recipient_surface: "native_content_share", outcome: "resolved", share_entry: "canonical_page",
    }]]);
  });

  test("no ms, or a malformed one, does nothing at all — no read, no event", async () => {
    const arrival = loadArrival();
    for (const raw of [undefined, "", `${CODE}.0`, "garbage", `${CODE}.1.1`]) {
      const harness = deps(async () => { throw new Error("must not read"); });
      await expect(arrival.recordCanonicalShareArrival(raw, harness.value)).resolves.toBe("ignored");
      expect(harness.captured).toEqual([]);
      expect(harness.stored.size).toBe(0);
    }
  });

  test("a revoked or unknown code persists nothing and records the resolver failure", async () => {
    const service = loadSource("app-mobile/src/services/contentShareService.ts", { "@mingla/sharing": sharing }) as {
      ContentShareReadError: new (code: string) => Error;
    };
    const arrival = loadArrival();
    const harness = deps(async () => { throw new service.ContentShareReadError("gone"); });
    await expect(arrival.recordCanonicalShareArrival(`${CODE}.1`, harness.value)).resolves.toBe("failed");
    expect(harness.stored.size).toBe(0);
    expect(harness.captured[0][0]).toBe("share_failure");
  });

  test("every route a canonical share link opens records the arrival before any early return", () => {
    const routes = [
      "app-mobile/app/b/[slug].tsx",
      "app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx",
      "app-mobile/app/e/[brandSlug]/[eventSlug].tsx",
      "app-mobile/app/t/[brandSlug]/[tripSlug].tsx",
      "app-mobile/app/exp/[brandSlug]/[experienceSlug].tsx",
    ];
    for (const route of routes) {
      const source = read(route);
      const body = source.slice(source.indexOf("export default function"));
      const hook = body.indexOf("useCanonicalShareArrival(params.ms)");
      expect(hook).toBeGreaterThan(-1);
      const firstReturn = body.search(/\n\s+return\b|\n\s+if \([^)]*\) return\b/);
      expect(firstReturn === -1 || hook < firstReturn).toBe(true);
    }
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

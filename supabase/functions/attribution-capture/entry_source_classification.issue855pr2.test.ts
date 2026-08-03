// ISSUE-855 PR-2 — entry_source classification in attribution-capture::recordTouch.
//
// NEW (append-only). Proves the forward-only source-tracking layer:
//   1. deriveReferrerHost reduces any referrer to a bare host (no path/query — SC-8).
//   2. classifyEntrySource buckets each source (ad / search / social / organic /
//      direct / unknown) with the correct precedence (ad click-id wins over a
//      social referrer).
//   3. recordTouch now stamps entry_source + referrer_host on the inserted touch
//      even when there is NO ad signal (an organic/search/social visit is recorded)
//      and forwards NO PII (only the referrer HOST reaches the row).
//
// fails-on-revert target: drop the referrer classification in recordTouch and the
// "social visit → entry_source:'social'" / "organic visit recorded" cases fail.
//
// Hermetic: an injected fake client (captures the ad_attribution_touches insert).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type CaptureDeps,
  classifyEntrySource,
  deriveReferrerHost,
  handleCapture,
} from "./index.ts";

// ── Capturing fake Supabase — records the inserted touch row ──────────────────
function fakeClient() {
  const inserted: Record<string, unknown>[] = [];
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    if (table === "ad_attribution_touches") {
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    const b = {
      select: () => b,
      eq: () => b,
      ilike: () => b,
      is: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    return b;
  };
  return {
    client: { from } as unknown as NonNullable<
      ReturnType<CaptureDeps["getClient"]>
    >,
    inserted,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://x/attribution-capture", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ═══ deriveReferrerHost — host only, no path/query/PII ════════════════════════
Deno.test("deriveReferrerHost: full URL → bare lowercased host, www stripped, no path", () => {
  assertEquals(
    deriveReferrerHost("https://www.Google.com/search?q=x"),
    "google.com",
  );
  assertEquals(
    deriveReferrerHost("https://l.instagram.com/?u=y"),
    "l.instagram.com",
  );
  assertEquals(deriveReferrerHost("HTTPS://T.CO/abc"), "t.co");
});

Deno.test("deriveReferrerHost: bare host tolerated; port/userinfo/path stripped", () => {
  assertEquals(deriveReferrerHost("google.com"), "google.com");
  assertEquals(
    deriveReferrerHost("news.google.com:443/foo"),
    "news.google.com",
  );
  assertEquals(deriveReferrerHost("user@evil.com/path"), "evil.com");
});

Deno.test("deriveReferrerHost: empty / non-string / non-host → null (never a path)", () => {
  assertEquals(deriveReferrerHost(""), null);
  assertEquals(deriveReferrerHost("   "), null);
  assertEquals(deriveReferrerHost(null), null);
  assertEquals(deriveReferrerHost(undefined), null);
  assertEquals(deriveReferrerHost(123), null);
});

// ═══ classifyEntrySource — one assertion per bucket + precedence ══════════════
Deno.test("classifyEntrySource: ad click-id wins even over a social referrer", () => {
  assertEquals(
    classifyEntrySource({ hasAdSignal: true, referrerHost: "instagram.com" }),
    "ad",
  );
});

Deno.test("classifyEntrySource: search hosts (multi-TLD) → 'search'", () => {
  for (
    const h of [
      "google.com",
      "google.co.uk",
      "news.google.com",
      "bing.com",
      "duckduckgo.com",
      "search.yahoo.com",
      "ecosia.org",
      "yandex.ru",
    ]
  ) {
    assertEquals(
      classifyEntrySource({ hasAdSignal: false, referrerHost: h }),
      "search",
      h,
    );
  }
});

Deno.test("classifyEntrySource: social hosts + shorteners → 'social'", () => {
  for (
    const h of [
      "instagram.com",
      "l.instagram.com",
      "tiktok.com",
      "m.facebook.com",
      "x.com",
      "t.co",
      "reddit.com",
      "youtube.com",
      "lnkd.in",
    ]
  ) {
    assertEquals(
      classifyEntrySource({ hasAdSignal: false, referrerHost: h }),
      "social",
      h,
    );
  }
});

Deno.test("classifyEntrySource: a Mingla host → 'organic' (internal navigation)", () => {
  for (
    const h of [
      "usemingla.com",
      "www.usemingla.com",
      "go.usemingla.com",
      "biz.usemingla.com",
    ]
  ) {
    assertEquals(
      classifyEntrySource({ hasAdSignal: false, referrerHost: h }),
      "organic",
      h,
    );
  }
});

Deno.test("classifyEntrySource: an uncategorised referrer → 'unknown' (never fabricated)", () => {
  assertEquals(
    classifyEntrySource({
      hasAdSignal: false,
      referrerHost: "some-blog.example.org",
    }),
    "unknown",
  );
  // Lookalikes must NOT match the brand label.
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "mygoogle.com" }),
    "unknown",
  );
  assertEquals(
    classifyEntrySource({
      hasAdSignal: false,
      referrerHost: "notgoogle-evil.com",
    }),
    "unknown",
  );
});

Deno.test("classifyEntrySource: no referrer + no ad signal → 'direct'", () => {
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: null }),
    "direct",
  );
});

// ═══ SECURITY: registrable-domain SUFFIX match, NEVER label-inclusion ══════════
// An attacker who owns 'attacker.net' can put 'google.com' anywhere as a LABEL;
// suffix matching means the REGISTRABLE domain must be ours. These MUST be 'unknown'.
Deno.test("classifyEntrySource: attacker lookalikes NEVER match a brand → 'unknown'", () => {
  for (
    const h of [
      "google.com.attacker.net", // brand label present, registrable = attacker.net
      "instagram.evil.com",
      "x.com.evil.net",
      "facebook.com.phish.io",
      "notgoogle-evil.com",
      "mygoogle.com",
      "l.instagram.com.evil.io",
      "xn--ggle-0nda.com", // punycode homoglyph lookalike, not our domain
      "xn--80ak6aa92e.com", // punycode, unrelated
    ]
  ) {
    assertEquals(
      classifyEntrySource({ hasAdSignal: false, referrerHost: h }),
      "unknown",
      h,
    );
  }
});

// Real subdomains of our brand domains MUST still classify (suffix match).
Deno.test("classifyEntrySource: real subdomains still classify (suffix match)", () => {
  assertEquals(
    classifyEntrySource({
      hasAdSignal: false,
      referrerHost: "l.instagram.com",
    }),
    "social",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "m.facebook.com" }),
    "social",
  );
  assertEquals(
    classifyEntrySource({
      hasAdSignal: false,
      referrerHost: "www.google.co.uk",
    }),
    "search",
  );
  assertEquals(
    classifyEntrySource({
      hasAdSignal: false,
      referrerHost: "news.google.com",
    }),
    "search",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "google.com.ng" }),
    "search",
  );
});

// ═══ recordTouch integration — organic/search/social visits now RECORDED ══════
Deno.test("recordTouch: a SOCIAL visit (no ad signal) records a touch with entry_source:'social' + host", async () => {
  const { client, inserted } = fakeClient();
  const res = await handleCapture(
    post({
      kind: "touch",
      network: "other",
      lane: "consumer",
      surface: "web",
      referrer: "https://l.instagram.com/?u=/e/brand/event",
    }),
    { getClient: () => client },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.kind, "touch");
  assertEquals(inserted.length, 1);
  const row = inserted[0];
  assertEquals(row.entry_source, "social");
  assertEquals(row.referrer_host, "l.instagram.com"); // host ONLY — no path/query
  // The minted click_id is returned for checkout threading (the organic link).
  assert(typeof body.click_id === "string" && body.click_id.length > 0);
});

Deno.test("recordTouch: a SEARCH visit records entry_source:'search'", async () => {
  const { client, inserted } = fakeClient();
  await handleCapture(
    post({
      kind: "touch",
      network: "other",
      surface: "web",
      referrer: "https://www.google.com/search?q=mingla",
    }),
    { getClient: () => client },
  );
  assertEquals(inserted[0].entry_source, "search");
  assertEquals(inserted[0].referrer_host, "google.com");
});

Deno.test("recordTouch: an AD visit (fbclid) stays entry_source:'ad' regardless of referrer", async () => {
  const { client, inserted } = fakeClient();
  await handleCapture(
    post({
      kind: "touch",
      network: "meta",
      surface: "web",
      external_click_id: "fbclidX",
      referrer: "https://instagram.com/",
    }),
    { getClient: () => client },
  );
  assertEquals(inserted[0].entry_source, "ad");
});

Deno.test("recordTouch: a bare direct touch records entry_source:'direct' + null host", async () => {
  const { client, inserted } = fakeClient();
  await handleCapture(
    post({ kind: "touch", network: "other", surface: "web" }),
    { getClient: () => client },
  );
  assertEquals(inserted[0].entry_source, "direct");
  assertEquals(inserted[0].referrer_host, null);
});

Deno.test("recordTouch: NO PII — only the referrer HOST reaches the row / response", async () => {
  const { client, inserted } = fakeClient();
  const res = await handleCapture(
    post({
      kind: "touch",
      network: "other",
      surface: "web",
      referrer: "https://google.com/search?q=someone%40example.com",
    }),
    { getClient: () => client },
  );
  const row = inserted[0];
  assertEquals(row.referrer_host, "google.com"); // the ?q=email query is stripped
  assert(
    !("referrer" in row),
    "raw referrer URL must never be a column on the row",
  );
  const rowText = JSON.stringify(row);
  assert(
    !rowText.includes("example.com"),
    "no path/query PII in the stored row",
  );
  const bodyText = await res.text();
  assert(!bodyText.includes("example.com"), "no PII echoed in the response");
});

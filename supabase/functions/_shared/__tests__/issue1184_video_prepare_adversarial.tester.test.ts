// ISSUE-1184 [Campaign Builder video Phase A] — INDEPENDENT TESTER adversarial
// regression. Written from a DIFFERENT angle than the implementor happy-path
// suite (issue1184_video_prepare.test.ts): that file proves the happy path and
// a handful of source strings; this file ATTACKS the seams — SSRF / media
// trust, DNS/redirect/size fail-close, MIME/hash identity, destination
// integrity, provider terminal/stop semantics, MD5 multi-block, and the exact
// SQL/edge state-machine + terminal-HTTP structure.
//
// HARD CONSTRAINTS honored: zero live provider/network calls (every fetch and
// DNS lookup is injected), zero ad objects, zero deploy/migration. The edge
// `serve()` handlers cannot be booted in a unit test (they bind a port), so the
// terminal-HTTP / create-safety / preview-parity invariants that live inside
// those handlers are asserted STRUCTURALLY against the real source and clearly
// labelled `[structural]`; every trust/adapter/destination invariant below is
// executed at runtime.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { AdConnectionRow } from "../adChannel.ts";
import type { AdCreativeRow } from "../adCreative.ts";
import { CreativeUploadError } from "../adCreative.ts";
import {
  boundedRetryAfterSeconds,
  CreativeTrustError,
  md5Hex,
  PREPARE_PROVIDER_ADAPTERS,
  probeTrustedVideoSources,
  type TrustedFetchDeps,
  verifyCreativeBytes,
} from "../adCreativePrepare.ts";
import { AdDestinationError, resolveAdDestination } from "../adDestination.ts";
import { sha256Hex } from "../adCreativeProbe.ts";

const CDN = "cdn.example.com";
const enc = (s: string) => new TextEncoder().encode(s);
const bin = (bytes: Uint8Array, init?: ResponseInit): Response =>
  new Response(bytes as unknown as BodyInit, init);

function setCdn(value: string | null): void {
  if (value === null) Deno.env.delete("BUNNY_STREAM_CDN_HOSTNAME");
  else Deno.env.set("BUNNY_STREAM_CDN_HOSTNAME", value);
}

// ── byte builders (real, probe-parseable media) ─────────────────────────────
function box(type: string, payload: Uint8Array): Uint8Array {
  const size = 8 + payload.length;
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
/** Minimal but real ISO-BMFF MP4: ftyp(isom) + moov{mvhd, trak{tkhd, mdia{hdlr vide}}}. */
function validMp4(): Uint8Array {
  const ftyp = box("ftyp", concat([enc("isom"), new Uint8Array(4)]));
  const mvhd = new Uint8Array(20);
  new DataView(mvhd.buffer).setUint32(12, 1000); // timescale
  new DataView(mvhd.buffer).setUint32(16, 1000); // duration => 1.0s
  const hdlr = box("hdlr", concat([new Uint8Array(8), enc("vide")]));
  const mdia = box("mdia", hdlr);
  const tkhd = new Uint8Array(84);
  new DataView(tkhd.buffer).setUint32(76, 2 * 65536); // width 2.0
  new DataView(tkhd.buffer).setUint32(80, 2 * 65536); // height 2.0
  const trak = box("trak", concat([box("tkhd", tkhd), mdia]));
  return concat([ftyp, box("moov", concat([box("mvhd", mvhd), trak]))]);
}
function validJpeg(): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x00,
    0x02,
    0x00,
    0x02,
    0x03,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0xff,
    0xd9,
  ]);
}
function validPng(): Uint8Array {
  const out = new Uint8Array(24);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(out.buffer).setUint32(16, 2);
  new DataView(out.buffer).setUint32(20, 2);
  return out;
}

function asset(overrides: Partial<AdCreativeRow> = {}): AdCreativeRow {
  return {
    id: "creative",
    kind: "video",
    name: "clip",
    source_url: null,
    storage_bucket: null,
    storage_path: null,
    bunny_video_id: "vid123",
    poster_url: `https://${CDN}/vid123/thumbnail.jpg`,
    mp4_master_url: `https://${CDN}/vid123/master.mp4`,
    place_id: null,
    brand_id: null,
    width: 2,
    height: 2,
    aspect_ratio: 1,
    duration_seconds: 1,
    mime_type: "video/mp4",
    byte_size: 3,
    has_audio: true,
    content_hash: "hash",
    poster_content_hash: "poster-hash",
    ai_generated: false,
    variants: {},
    status: "active",
    ...overrides,
  };
}

/** A deps object whose network + DNS both throw — proves a rejection is pre-fetch. */
const noNetwork: TrustedFetchDeps = {
  resolveDns: () => Promise.reject(new Error("DNS must not be called")),
  fetchImpl: (() => {
    throw new Error("network must not be called");
  }) as typeof fetch,
};

function deps(opts: {
  video?: () => Response;
  poster?: () => Response;
  dns?: string[];
} = {}): TrustedFetchDeps {
  return {
    resolveDns: (_h: string, type: "A" | "AAAA") =>
      Promise.resolve(type === "A" ? (opts.dns ?? ["93.184.216.34"]) : []),
    fetchImpl: ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const make = url.pathname.endsWith("thumbnail.jpg")
        ? opts.poster
        : opts.video;
      return Promise.resolve(
        make ? make() : bin(new Uint8Array([0])),
      );
    }) as typeof fetch,
  };
}

async function trustCode(
  fn: () => Promise<unknown>,
): Promise<{ code: string; status: number }> {
  const error = await assertRejects(fn, CreativeTrustError);
  const e = error as CreativeTrustError;
  return { code: e.code, status: e.status };
}

// ── 1. CDN config fail-close matrix ─────────────────────────────────────────
Deno.test("ISSUE-1184 adversarial: BUNNY_STREAM_CDN_HOSTNAME is validated fail-close", async () => {
  const good = () => bin(new Uint8Array([0]));
  for (
    const bad of [
      null, // absent
      "",
      "   ",
      "CDN.Example.com", // non-lowercase
      "https://cdn.example.com", // scheme
      "cdn.example.com:443", // port
      "cdn.example.com/x", // path
      "user@cdn.example.com", // credential
      "cdn", // single label
      "-cdn.example.com", // leading dash label
      "cdn.example.com-", // trailing dash label
      `${"a".repeat(254)}.com`, // > 253 chars
      "cdn..example.com", // empty label
    ]
  ) {
    setCdn(bad);
    const { code, status } = await trustCode(() =>
      probeTrustedVideoSources(asset(), deps({ video: good, poster: good }))
    );
    assertEquals(code, "creative_cdn_config_missing");
    assertEquals(status, 503);
  }
  // A valid host clears the config gate (fails later, NOT on config).
  setCdn(CDN);
  const { code } = await trustCode(() =>
    probeTrustedVideoSources(
      asset({ mp4_master_url: `https://${CDN}/vid123/master.mp4` }),
      noNetwork, // DNS/fetch throw — but URL trust passes, so it reaches DNS
    )
  );
  assert(code !== "creative_cdn_config_missing");
});

// ── 2. SSRF / URL-identity rejection (pre-fetch — no network touched) ────────
Deno.test("ISSUE-1184 adversarial: untrusted source URLs are rejected before any fetch", async () => {
  setCdn(CDN);
  const cases: Array<[Partial<AdCreativeRow>, string]> = [
    [
      { mp4_master_url: "https://evil.attacker.test/vid123/master.mp4" },
      "creative_source_untrusted",
    ],
    [
      { mp4_master_url: `http://${CDN}/vid123/master.mp4` },
      "creative_source_untrusted",
    ],
    [
      { mp4_master_url: `https://${CDN}:8443/vid123/master.mp4` },
      "creative_source_untrusted",
    ],
    [
      { mp4_master_url: `https://user:pass@${CDN}/vid123/master.mp4` },
      "creative_source_untrusted",
    ],
    [
      { mp4_master_url: `https://${CDN}/vid123/master.mp4?x=1` },
      "creative_source_untrusted",
    ],
    [
      { mp4_master_url: `https://${CDN}/vid123/master.mp4#frag` },
      "creative_source_untrusted",
    ],
    [
      { mp4_master_url: "https://93.184.216.34/vid123/master.mp4" },
      "creative_source_untrusted",
    ],
    [{ bunny_video_id: "has/slash" }, "creative_source_untrusted"],
    [{ bunny_video_id: "has space" }, "creative_source_untrusted"],
    [{ bunny_video_id: "x".repeat(129) }, "creative_source_untrusted"],
    // valid host + valid id but the id is NOT a path segment of the video URL
    [
      { mp4_master_url: `https://${CDN}/other/master.mp4` },
      "creative_source_untrusted",
    ],
    // poster path is not exactly /<id>/thumbnail.jpg
    [
      { poster_url: `https://${CDN}/vid123/wrong.jpg` },
      "creative_source_untrusted",
    ],
    [
      { poster_url: `https://${CDN}/vid123/thumbnail.png` },
      "creative_source_untrusted",
    ],
    // missing source files
    [{ mp4_master_url: null }, "creative_source_missing"],
    [{ poster_url: null }, "creative_source_missing"],
  ];
  for (const [override, expected] of cases) {
    const { code, status } = await trustCode(() =>
      probeTrustedVideoSources(asset(override), noNetwork)
    );
    assertEquals(code, expected, `override ${JSON.stringify(override)}`);
    assertEquals(status, 422);
  }
});

// ── 3. DNS / redirect / size / reachability fail-close ───────────────────────
Deno.test("ISSUE-1184 adversarial: DNS/redirect/size/unreachable all fail closed", async () => {
  setCdn(CDN);
  const good = () => bin(validMp4());
  // Private / reserved / metadata / CGNAT DNS answers are rejected.
  for (
    const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
    ]
  ) {
    const { code, status } = await trustCode(() =>
      probeTrustedVideoSources(asset(), deps({ video: good, dns: [ip] }))
    );
    assertEquals(code, "creative_source_untrusted", ip);
    assertEquals(status, 422);
  }
  // No DNS answer at all → untrusted.
  {
    const { code } = await trustCode(() =>
      probeTrustedVideoSources(asset(), deps({ video: good, dns: [] }))
    );
    assertEquals(code, "creative_source_untrusted");
  }
  // Any 3xx redirect is refused.
  {
    const { code } = await trustCode(() =>
      probeTrustedVideoSources(
        asset(),
        deps({
          video: () =>
            new Response(null, {
              status: 302,
              headers: { location: "https://x" },
            }),
        }),
      )
    );
    assertEquals(code, "creative_source_redirect_forbidden");
  }
  // Declared content-length beyond the 64 MiB cap is refused before download.
  {
    const oversize = () => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]));
          c.close();
        },
      });
      return new Response(stream, {
        headers: { "content-length": "99999999999" },
      });
    };
    const { code } = await trustCode(() =>
      probeTrustedVideoSources(asset(), deps({ video: oversize }))
    );
    assertEquals(code, "creative_source_too_large");
  }
  // A thrown fetch and a non-2xx are both "unreachable".
  {
    const { code } = await trustCode(() =>
      probeTrustedVideoSources(
        asset(),
        deps({
          video: () => {
            throw new Error("boom");
          },
        }),
      )
    );
    assertEquals(code, "creative_source_unreachable");
  }
  {
    const { code } = await trustCode(() =>
      probeTrustedVideoSources(
        asset(),
        deps({ video: () => new Response("no", { status: 404 }) }),
      )
    );
    assertEquals(code, "creative_source_unreachable");
  }
});

// ── 4. MIME / probe / identity-hash fail-close (real bytes) ──────────────────
Deno.test("ISSUE-1184 adversarial: MIME mismatch and identity-hash mismatch fail closed", async () => {
  setCdn(CDN);
  // Video bytes are actually a JPEG → not a supported video.
  {
    const { code } = await trustCode(() =>
      probeTrustedVideoSources(
        asset(),
        deps({
          video: () => bin(validJpeg()),
          poster: () => bin(validJpeg()),
        }),
      )
    );
    assertEquals(code, "creative_video_probe_failed");
  }
  // Poster bytes are a PNG, not JPEG → poster probe fails.
  {
    const { code } = await trustCode(() =>
      probeTrustedVideoSources(
        asset(),
        deps({
          video: () => bin(validMp4()),
          poster: () => bin(validPng()),
        }),
      )
    );
    assertEquals(code, "creative_poster_probe_failed");
  }
  // verifyCreativeBytes: absent poster identity hash → refuse before any fetch.
  {
    const { code, status } = await trustCode(() =>
      verifyCreativeBytes(asset({ poster_content_hash: null }), noNetwork)
    );
    assertEquals(code, "creative_poster_identity_missing");
    assertEquals(status, 422);
  }
  // verifyCreativeBytes: bytes probe fine but their hash != recorded → changed.
  {
    const { code, status } = await trustCode(() =>
      verifyCreativeBytes(
        asset({ content_hash: "deadbeef", poster_content_hash: "deadbeef" }),
        deps({
          video: () => bin(validMp4()),
          poster: () => bin(validJpeg()),
        }),
      )
    );
    assertEquals(code, "creative_identity_changed");
    assertEquals(status, 409);
  }
  // Control: correct hashes → the trusted bytes are returned.
  {
    const video = validMp4();
    const poster = validJpeg();
    const bytes = await verifyCreativeBytes(
      asset({
        content_hash: await sha256Hex(video),
        poster_content_hash: await sha256Hex(poster),
      }),
      deps({
        video: () => bin(video),
        poster: () => bin(poster),
      }),
    );
    assertEquals(bytes.video.length, video.length);
    assertEquals(bytes.poster.length, poster.length);
  }
});

// ── 5. boundedRetryAfterSeconds boundaries (angle beyond happy path) ─────────
Deno.test("ISSUE-1184 adversarial: Retry-After parsing is clamped to [1,60]", () => {
  assertEquals(boundedRetryAfterSeconds("0"), 1);
  assertEquals(boundedRetryAfterSeconds("-5"), 1);
  assertEquals(boundedRetryAfterSeconds("45"), 45);
  assertEquals(boundedRetryAfterSeconds("9999"), 60);
  assertEquals(boundedRetryAfterSeconds("1.2"), 2); // ceil
  assertEquals(boundedRetryAfterSeconds(""), 10); // fallback
  assertEquals(boundedRetryAfterSeconds("   "), 10);
  assertEquals(boundedRetryAfterSeconds(null), 10);
  assertEquals(boundedRetryAfterSeconds("not-a-number"), 10);
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  assertEquals(
    boundedRetryAfterSeconds("Fri, 24 Jul 2026 11:59:00 GMT", now),
    1,
  ); // past → 1
  assertEquals(
    boundedRetryAfterSeconds("Fri, 24 Jul 2026 13:00:00 GMT", now),
    60,
  ); // far future → 60
});

// ── 6. Destination integrity — only page-type + slugs, never a client URL ────
Deno.test("ISSUE-1184 adversarial: destination resolver rejects non-public and arbitrary URLs", async () => {
  Deno.env.set("BUSINESS_WEB_ORIGIN", "https://business.usemingla.com");
  const db = (
    result: {
      data?: Record<string, unknown> | null;
      error?: { message: string } | null;
    },
  ) => {
    const q: Record<string, unknown> = {};
    q.eq = () => q;
    q.in = () => q;
    q.maybeSingle = () =>
      Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
      });
    return { from: () => ({ select: () => q }) };
  };
  const expect = async (
    dbArg: unknown,
    input: unknown,
    code: string,
    status: number,
  ) => {
    const e = await assertRejects(
      () => resolveAdDestination(dbArg, input),
      AdDestinationError,
    ) as AdDestinationError;
    assertEquals(e.code, code, code);
    assertEquals(e.status, status, code);
  };
  // A public-but-missing row is a typed 422, a DB fault is a 503.
  await expect(
    db({ data: null }),
    { page_type: "event", brand_slug: "a", entity_slug: "b" },
    "destination_not_public",
    422,
  );
  await expect(
    db({ error: { message: "x" } }),
    { page_type: "brand", brand_slug: "a" },
    "destination_lookup_failed",
    503,
  );
  // Descriptor shape rules.
  await expect(
    db({}),
    { page_type: "brand", brand_slug: "a", entity_slug: "b" },
    "destination_entity_slug_forbidden",
    400,
  );
  await expect(
    db({}),
    { page_type: "event", brand_slug: "a" },
    "destination_entity_slug_required",
    400,
  );
  await expect(
    db({}),
    { page_type: "brand", brand_slug: "NoUpper" },
    "destination_brand_slug_invalid",
    400,
  );
  await expect(
    db({}),
    { page_type: "event", brand_slug: "a", entity_slug: "Bad_Slug" },
    "destination_entity_slug_invalid",
    400,
  );
  await expect(
    db({}),
    { page_type: "trip", brand_slug: "a" },
    "destination_page_type_invalid",
    400,
  );
  await expect(db({}), ["brand", "a"], "destination_page_type_invalid", 400);
  await expect(
    db({}),
    "https://attacker.test/",
    "destination_page_type_invalid",
    400,
  );
  // The resolver NEVER accepts a caller-supplied URL/id — any extra key is rejected.
  await expect(
    db({}),
    {
      page_type: "brand",
      brand_slug: "a",
      canonical_url: "https://attacker.test/",
    },
    "destination_descriptor_unknown_field",
    400,
  );
  await expect(
    db({}),
    {
      page_type: "brand",
      brand_slug: "a",
      destination_url: "https://attacker.test/",
    },
    "destination_descriptor_unknown_field",
    400,
  );
  await expect(
    db({}),
    {
      page_type: "event",
      brand_slug: "a",
      entity_slug: "b",
      event_id: "forced",
    },
    "destination_descriptor_unknown_field",
    400,
  );
  // Control: a public brand resolves to the server-built canonical URL only.
  const resolved = await resolveAdDestination(
    db({ data: { id: "b1", slug: "a" } }),
    { page_type: "brand", brand_slug: "a" },
  );
  assertEquals(resolved.canonical_url, "https://business.usemingla.com/b/a");
  assertEquals(resolved.entity_slug, null);
  assert(!resolved.canonical_url.includes("attacker"));
});

// ── 7. Provider adapters — terminal, stop-on-stale, unknown, throttle angles ─
const META_CONN: AdConnectionRow = {
  id: "c",
  platform: "meta",
  lane: "consumer",
  display_name: "Meta",
  external_account_id: "acc",
  external_org_id: null,
  auth_kind: "system_user_token",
  token_env_var: "META_SYSTEM_USER_TOKEN",
  extra: { graph_api_version: "v23.0" },
  status: "connected",
  currency: "USD",
  timezone: "UTC",
  min_daily_budget_cents: 100,
  account_status: "ACTIVE",
  token_last_verified_at: null,
  connected: true,
};
const okJson = (obj: unknown): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(obj), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

Deno.test("ISSUE-1184 adversarial: Meta check maps error→terminal, unknown/missing→processing, never fabricates ready", async () => {
  Deno.env.set("META_SYSTEM_USER_TOKEN", "t");
  Deno.env.set("META_AD_ACCOUNT_ID", "acc");
  Deno.env.set("META_PAGE_ID", "page");
  const check = (status: unknown) =>
    PREPARE_PROVIDER_ADAPTERS.meta.check("vid", {}, META_CONN, {
      fetchImpl: (() =>
        okJson(
          status === undefined ? {} : { status: { video_status: status } },
        )) as typeof fetch,
    });
  const terminal = await check("error");
  assertEquals(terminal.state, "terminal");
  assertEquals(terminal.terminalCode, "meta_video_processing_failed");
  assertEquals((await check("processing")).state, "processing");
  assertEquals((await check("weird-unknown")).state, "processing");
  assertEquals((await check(undefined)).state, "processing");
});

Deno.test("ISSUE-1184 adversarial: Meta initiate refuses a response with no video id", async () => {
  Deno.env.set("META_SYSTEM_USER_TOKEN", "t");
  const error = await assertRejects(
    () =>
      PREPARE_PROVIDER_ADAPTERS.meta.initiate(
        asset(),
        META_CONN,
        { video: new Uint8Array([1]), poster: new Uint8Array([2]) },
        {
          saveProviderRef: () => Promise.resolve(true),
          mergeProviderExtra: () => Promise.resolve(true),
          markProcessing: () => Promise.resolve(true),
        },
        { fetchImpl: (() => okJson({})) as typeof fetch },
      ),
    CreativeUploadError,
  );
  assertStringIncludes((error as CreativeUploadError).message, "video id");
});

Deno.test("ISSUE-1184 adversarial: a losing (stale-CAS) initiate STOPS — no processing after ownership lost", async () => {
  // TikTok: saveProviderRef returns false (a concurrent attempt won). The
  // adapter must return immediately and never mark processing.
  Deno.env.set("TIKTOK_TEST_TOKEN", "t");
  const conn: AdConnectionRow = {
    ...META_CONN,
    platform: "tiktok",
    token_env_var: "TIKTOK_TEST_TOKEN",
    external_account_id: "adv",
  };
  const calls: string[] = [];
  await PREPARE_PROVIDER_ADAPTERS.tiktok.initiate(
    asset(),
    conn,
    { video: new Uint8Array([1, 2, 3]), poster: new Uint8Array([4]) },
    {
      saveProviderRef: () => {
        calls.push("save");
        return Promise.resolve(false); // lost the race
      },
      mergeProviderExtra: () => {
        calls.push("merge");
        return Promise.resolve(true);
      },
      markProcessing: () => {
        calls.push("process");
        return Promise.resolve(true);
      },
    },
    {
      fetchImpl: (() =>
        okJson({
          code: 0,
          data: { list: [{ material_id: "m1", video_id: "v1" }] },
        })) as typeof fetch,
    },
  );
  assertEquals(calls, ["save"]); // stopped right after the losing CAS
});

Deno.test("ISSUE-1184 adversarial: Snap check clamps unknown-status Retry-After to [5,60] and never fabricates ready", async () => {
  Deno.env.set("SNAPCHAT_REFRESH_TOKEN", "r");
  Deno.env.set("SNAPCHAT_CLIENT_ID", "c");
  Deno.env.set("SNAPCHAT_CLIENT_SECRET", "s");
  const conn: AdConnectionRow = {
    ...META_CONN,
    platform: "snapchat",
    token_env_var: "SNAPCHAT_REFRESH_TOKEN",
    auth_kind: "refresh_token",
  };
  const check = (retryAfter: string | null) => {
    let n = 0;
    return PREPARE_PROVIDER_ADAPTERS.snapchat.check("media", {}, conn, {
      fetchImpl: (() => {
        n += 1;
        if (n === 1) return okJson({ access_token: "minted" });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              media: [{ media: { media_status: "PENDING_UPLOAD" } }],
            }),
            {
              status: 200,
              headers: retryAfter === null
                ? { "content-type": "application/json" }
                : {
                  "content-type": "application/json",
                  "retry-after": retryAfter,
                },
            },
          ),
        );
      }) as typeof fetch,
    });
  };
  assertEquals((await check(null)).state, "processing");
  assertEquals((await check(null)).retryAfterSeconds, 10);
  assertEquals((await check("2")).retryAfterSeconds, 5); // floor 5
  assertEquals((await check("900")).retryAfterSeconds, 60); // cap 60
});

Deno.test("ISSUE-1184 adversarial: TikTok check with a missing stored video id is terminal, not a false ready", async () => {
  Deno.env.set("TIKTOK_TEST_TOKEN", "t");
  const conn: AdConnectionRow = {
    ...META_CONN,
    platform: "tiktok",
    token_env_var: "TIKTOK_TEST_TOKEN",
    external_account_id: "adv",
  };
  const result = await PREPARE_PROVIDER_ADAPTERS.tiktok.check(
    "material",
    { video_id: "" },
    conn,
    {
      fetchImpl: (() => {
        throw new Error("info GET must not run without a video id");
      }) as typeof fetch,
    },
  );
  assertEquals(result.state, "terminal");
  assertEquals(result.terminalCode, "tiktok_video_id_missing");
});

// ── 8. MD5 multi-block correctness (TikTok video_signature depends on it) ────
Deno.test("ISSUE-1184 adversarial: MD5 is correct across block boundaries", () => {
  // 43 bytes (one block, non-empty message).
  assertEquals(
    md5Hex(enc("The quick brown fox jumps over the lazy dog")),
    "9e107d9d372bb6826bd81d3542a419d6",
  );
  // 80 bytes → forces a SECOND 64-byte block (RFC 1321 A.5 vector #7).
  assertEquals(
    md5Hex(
      enc(
        "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      ),
    ),
    "57edf4a22be3c955ac49da2e2107b67a",
  );
});

// ── 9. [structural] Terminal-HTTP semantics inside the prepare handler ───────
Deno.test("ISSUE-1184 adversarial [structural]: prepare returns cached 200 for stored terminal and 502 only for newly-discovered terminal", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );
  // A stored failed/timed_out read is cached=true and returns 200/202 WITHOUT
  // reaching the adapter (the adapter lives after this early-return block).
  assertStringIncludes(src, 'row.current_status === "failed"');
  assertStringIncludes(src, 'row.current_status === "timed_out"');
  assert(
    src.indexOf('row.decision === "return_terminal"') <
      src.indexOf("const adapter = PREPARE_PROVIDER_ADAPTERS[platform]"),
    "return_terminal must be handled before the adapter is resolved",
  );
  // The adapter check is reachable ONLY under check_existing.
  assertMatch(
    src,
    /row\.decision === "check_existing"[\s\S]*?adapter\.check\(/,
  );
  // Newly-discovered provider terminal: attempt-scoped proof + 502 + cached false.
  assertMatch(
    src,
    /checked\.state === "terminal"[\s\S]*?provider_terminal_attempt_id: row\.current_attempt_id[\s\S]*?cached: false[\s\S]*?502/,
  );
  // Provider-initiation failure: 502 with provider_init_failed.
  assertMatch(src, /error_code: "provider_init_failed"[\s\S]*?502/);
  // Terminal proof is NEVER asserted from a client field; only the server check
  // path sets provider_terminal_attempt_id to the CURRENT attempt id.
  assertEquals(
    src.match(/provider_terminal_attempt_id: row\.current_attempt_id/g)?.length,
    1,
  );
});

// ── 10. [structural] Create-path safety: Meta/Snap/TikTok/Google, all PAUSED ───
Deno.test("ISSUE-1184 adversarial [structural]: create is Meta/Snap/TikTok/Google/Reddit video, all PAUSED", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  // [TEST-MOD-APPROVED ORCH-1185] #1185 wired Reddit paused-video create — the LAST
  // platform still fail-closed. #997 C/D2 had already wired TikTok + Google; Reddit
  // was the final blanket phase-A 422. It is now GONE, so NO
  // video_create_not_available_phase_a seam remains anywhere. Reddit video resolves
  // the #866 clip (mp4_master_url + poster) into a type:"VIDEO" post.
  assert(
    !src.includes("video_create_not_available_phase_a"),
    "no video-create phase-A 422 may remain — every platform is wired",
  );
  assertStringIncludes(
    src,
    'const creativeKindR = creativeR.kind === "video" ? "video" : "image";',
  );
  assertStringIncludes(src, "reddit_video_library_required");
  // TikTok video now resolves a READY ref (video_id + cover) instead of failing closed.
  assertStringIncludes(src, 'const creativeKindT = creativeT.kind === "video" ? "video" : "image";');
  assertStringIncludes(src, "creative_ref_incomplete");
  // Google video now resolves a READY google ref (youtube_video_id) → Demand Gen.
  assertStringIncludes(src, "googleCreateDemandGenVideoCampaign");
  assertStringIncludes(src, "youtube_video_id");
  // Meta + Snap + TikTok + Google video all require an exact current-hash READY ref.
  assertStringIncludes(src, '.eq("status", "ready")');
  assertStringIncludes(src, "video_preparation_required");
  assertStringIncludes(src, '.eq("external_kind", "video")');
  // validate_only creates and persists nothing.
  assertMatch(
    src,
    /validate_only[\s\S]*?nothing (created|persisted|was validated)/,
  );
  // The video-wired create persists PAUSED campaigns and ads.
  assertStringIncludes(src, 'status: "PAUSED"');
});

// ── 11. [structural] Preview shares the create destination resolver ──────────
Deno.test("ISSUE-1184 adversarial [structural]: preview uses the shared resolver, never a client URL, and guards the Meta iframe", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-preview/index.ts", import.meta.url),
  );
  assertStringIncludes(src, "resolveAdDestination(supabase, body.destination)");
  assertStringIncludes(src, "destUrl: destination.canonical_url");
  // Never accepts a client destination URL.
  assert(!src.includes("destination_url"));
  // The Meta iframe extractor refuses executable / non-facebook payloads.
  assertStringIncludes(src, "srcdoc");
  assertMatch(src, /<script/);
  assertStringIncludes(src, "facebook.com");
  assertStringIncludes(src, "fbcdn.net");
  assertStringIncludes(src, "preview_contract_unrecognized");
});

// ── 12. [structural] Migration/RPC/RLS state-machine + audit contract ────────
Deno.test("ISSUE-1184 adversarial [structural]: RPC enforces terminal-proof replacement, timeout write, and pre-mutation validation", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270111001184_issue_1184_video_prepare_lifecycle.sql",
      import.meta.url,
    ),
  );
  // A failed row is only replaced when the server-owned terminal proof matches
  // the current attempt — a client can never assert terminality.
  assertMatch(
    sql,
    /v_ref\.status = 'failed'[\s\S]*?provider_terminal_attempt_id = v_ref\.attempt_id/,
  );
  // The provider id is cleared on replace ONLY for null-ref or proven-terminal
  // rows — a timed_out(ID) is never dropped before proof.
  assertMatch(
    sql,
    /external_ref = CASE[\s\S]*?external_ref IS NULL[\s\S]*?provider_terminal_attempt_id = v_ref\.attempt_id/,
  );
  // Endpoint-owned 60-minute deadline: the RPC CAS-marks timed_out at/after it.
  assertMatch(
    sql,
    /p_now >= v_ref\.deadline_at[\s\S]*?status = 'timed_out'[\s\S]*?preparation_deadline_exceeded/,
  );
  // Invalid direct calls raise SQLSTATE 22023 BEFORE any row mutation.
  const firstRaise = sql.indexOf("ERRCODE = '22023'");
  const firstInsert = sql.indexOf(
    "INSERT INTO public.ad_creative_platform_refs",
  );
  assert(firstRaise > -1 && firstInsert > -1 && firstRaise < firstInsert);
  // Absent-row race: INSERT ... ON CONFLICT DO NOTHING precedes SELECT FOR UPDATE.
  assert(
    sql.indexOf(
      "ON CONFLICT ON CONSTRAINT ad_creative_platform_refs_uniq DO NOTHING",
    ) <
      sql.indexOf("FOR UPDATE"),
  );
  // Only a winner initiates.
  assertMatch(sql, /won := true;\s*decision := 'initiate';/);
});

Deno.test("ISSUE-1184 adversarial [structural]: audit CHECK accepts the prepare/preview allowlist and REJECTS stale_attempt_reload as an action", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270111001184_issue_1184_video_prepare_lifecycle.sql",
      import.meta.url,
    ),
  );
  const match = sql.match(
    /ad_status_events_action_check\s+CHECK \(action IN \(([\s\S]*?)\)\)/,
  );
  assert(match, "action CHECK constraint must be present");
  const allowed = match![1];
  for (
    const action of [
      "prepare_begin",
      "prepare_ref_saved",
      "prepare_check",
      "prepare_ready",
      "prepare_failed",
      "prepare_timeout",
      "preview_request",
      "preview_ready",
      "preview_failed",
    ]
  ) {
    assertStringIncludes(allowed, `'${action}'`);
  }
  // stale_attempt_reload is a provider_response.decision, NEVER an action value.
  assert(!allowed.includes("stale_attempt_reload"));
  // The migration's own runtime probe proves accept(prepare_check) + reject(stale_attempt_reload).
  assertMatch(
    sql,
    /VALUES \('stale_attempt_reload', 'creative_ref'\)[\s\S]*?EXCEPTION WHEN check_violation/,
  );
  assertStringIncludes(sql, "prepare_check action must be accepted");
  assertStringIncludes(sql, "stale_attempt_reload must not be an audit action");
});

Deno.test("ISSUE-1184 adversarial [structural]: RPC is service-role-only, owned by postgres, with runtime privilege probes", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270111001184_issue_1184_video_prepare_lifecycle.sql",
      import.meta.url,
    ),
  );
  assertMatch(
    sql,
    /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/,
  );
  assertStringIncludes(sql, "OWNER TO postgres");
  assertMatch(
    sql,
    /REVOKE EXECUTE ON FUNCTION[\s\S]*?FROM PUBLIC, anon, authenticated/,
  );
  assertMatch(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role/);
  // Runtime privilege assertions in the migration DO block.
  assertStringIncludes(sql, "has_function_privilege('anon'");
  assertStringIncludes(sql, "has_function_privilege('authenticated'");
  assertStringIncludes(sql, "has_function_privilege('service_role'");
  assertStringIncludes(sql, "prepare RPC privileges incorrect");
  // Touched tables must keep RLS.
  assertStringIncludes(sql, "NOT relrowsecurity");
});

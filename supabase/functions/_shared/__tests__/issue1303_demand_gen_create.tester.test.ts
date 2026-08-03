/**
 * ISSUE-1303 [Google Demand Gen video CREATE fix] — INDEPENDENT TESTER adversarial
 * suite. A DIFFERENT ANGLE from BOTH existing #997-D2 suites
 * (issue997_google_video_create.test.ts happy-path + .adversarial.tester.test.ts):
 * this file attacks the THREE #1303 fixes at seams neither existing suite touches.
 *
 * #1303 pinned three faults in the doc-sourced-but-never-live-validated #997-D2
 * shape and fixed all three (each live-validated to HTTP 200 via validateOnly:true,
 * zero objects, on Google Ads v24 AND v25):
 *   RC-1 geo criteria belong at the AD-GROUP level (campaign-level geo → the masked
 *        requestError.UNKNOWN symptom).
 *   RC-2 the ad REQUIRES a non-empty ad.name.
 *   RC-3 logoImages is REQUIRED (>=1) — a square imageAsset must ride and be
 *        referenced.
 *
 * The angles THIS suite owns (not covered by the two existing suites):
 *   1. LOGO BYTE INTEGRITY — the embedded base64 constant decodes to bytes whose
 *      sha256 == the declared MINGLA_SQUARE_LOGO_PNG_SHA256 == the exact
 *      "bfa1260…" hash forensics live-validated to HTTP 200, with valid PNG magic
 *      bytes and the exact 50119-byte length. A tampered/corrupted constant is
 *      caught here (neither existing suite hashes the bytes).
 *   2. ASSET CROSS-WIRING — the ad's `videos[]` resolves to the youtubeVideoAsset
 *      op (-3) and `logoImages[]` resolves to the imageAsset op (-5); a swap of the
 *      two asset refs (a plausible regression) is caught, which the existing suites
 *      (which only look the logo up BY imageAsset) do not fully pin.
 *   3. FAIL-CLOSED EXHAUSTIVE + BASE64 TRUST BOUNDARY — empty "", whitespace, tab/
 *      newline, and a missing (undefined-cast) logoImageData each throw
 *      demand_gen_logo_missing; and the guard is emptiness-only (a non-empty
 *      non-base64 string is NOT rejected by the builder — base64 validity is
 *      enforced by the sha256'd constant + Google's real validate, documented here
 *      so the trust boundary is explicit).
 *   4. MULTI-GEO SCALE — N=5 geo criteria all land at ad-group level as `location`
 *      criteria (not language/proximity), ZERO at campaign level, each bound to the
 *      SAME ad-group temp resource.
 *   5. VALIDATE-ACCEPT SHAPE — a real Google 200 that returns an EMPTY-ARRAY
 *      `mutateOperationResponses: []` (a different accept shape than the existing
 *      suites' `{}`) is treated as validated:true, and the wired body carries the
 *      corrected geo/name/logo shape + validateOnly:true.
 *
 * fails-on-revert: recorded in the tester QA report.
 * Pure/mocked-runtime only. NO live provider/network call, NO ad object, NO spend.
 *
 * Run: deno test --allow-env --allow-read \
 *   supabase/functions/_shared/__tests__/issue1303_demand_gen_create.tester.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { AdApiError, type AdConnectionRow } from "../adChannel.ts";
import {
  buildGoogleDemandGenMutateOperations,
  googleCreateDemandGenVideoCampaign,
  type GoogleDemandGenVideoInput,
  resetGoogleTokenCacheForTests,
} from "../google.ts";
import {
  MINGLA_SQUARE_LOGO_PNG_BASE64,
  MINGLA_SQUARE_LOGO_PNG_SHA256,
} from "../adDemandGenLogo.ts";

const CUSTOMER_ID = "3623860476";

// The exact hash forensics live-validated to HTTP 200 on Google Ads v24 AND v25.
const FORENSICS_VALIDATED_SHA256 =
  "bfa1260dc23f55e59716c726a90cfaf393ae92cb81013769cdc07415b04eb986";
const FORENSICS_VALIDATED_BYTES = 50119;

const INPUT: GoogleDemandGenVideoInput = {
  name: "1303 Tester DG Video",
  dailyBudgetCents: 2000,
  finalUrl: "https://usemingla.com/e/test-brand/test-event",
  trackingUrlTemplate: "https://go.usemingla.com/w36m?pid=google_ads",
  businessName: "Test Brand",
  headlines: ["Book Test Event", "Live in London"],
  longHeadlines: ["Book the long-form headline that runs a little longer here"],
  descriptions: ["A real Mingla event you can book today.", "Limited."],
  youtubeVideoId: "dQw4w9WgXcQ",
  logoImageData: MINGLA_SQUARE_LOGO_PNG_BASE64,
  geoTargetCriterionIds: ["1006886"],
};

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function assetCreateByField(
  ops: Record<string, unknown>[],
  field: string,
): Record<string, unknown> {
  const found = ops
    .filter((o) => "assetOperation" in o)
    .map((o) =>
      (o.assetOperation as Record<string, unknown>).create as Record<
        string,
        unknown
      >
    )
    .find((c) => field in c);
  assert(found !== undefined, `no assetOperation with field ${field}`);
  return found;
}

function adOf(ops: Record<string, unknown>[]): Record<string, unknown> {
  const adOp = ops.find((o) => "adGroupAdOperation" in o)!;
  return ((adOp.adGroupAdOperation as Record<string, unknown>)
    .create as Record<string, unknown>).ad as Record<string, unknown>;
}

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-000000000002",
  platform: "google",
  lane: "consumer",
  display_name: "Google Ads · Consumer",
  external_account_id: "3623860476",
  external_org_id: "8280000000",
  auth_kind: "dev_token_oauth",
  token_env_var: "GOOGLE_ADS_REFRESH_TOKEN",
  extra: {},
  status: "connected",
  currency: "USD",
  timezone: "America/New_York",
  min_daily_budget_cents: null,
  account_status: "ENABLED",
  token_last_verified_at: null,
  connected: true,
};

const GOOGLE_ENV = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_OAUTH_CLIENT_ID",
  "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "GOOGLE_ADS_CUSTOMER_ID",
];

async function withMockedGoogle(
  mutateResponse: unknown,
  body: (captured: { mutateBody: Record<string, unknown> | null }) => Promise<
    void
  >,
): Promise<void> {
  const prior = new Map<string, string | undefined>();
  for (const n of GOOGLE_ENV) {
    prior.set(n, Deno.env.get(n));
    Deno.env.set(n, n === "GOOGLE_ADS_CUSTOMER_ID" ? CUSTOMER_ID : `test-${n}`);
  }
  resetGoogleTokenCacheForTests();
  const originalFetch = globalThis.fetch;
  const captured: { mutateBody: Record<string, unknown> | null } = {
    mutateBody: null,
  };
  globalThis.fetch = ((
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }),
          { status: 200 },
        ),
      );
    }
    if (url.includes("googleAds:mutate")) {
      captured.mutateBody = JSON.parse(String(init?.body ?? "{}"));
      return Promise.resolve(
        new Response(JSON.stringify(mutateResponse), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await body(captured);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [n, v] of prior) {
      if (v !== undefined) Deno.env.set(n, v);
      else Deno.env.delete(n);
    }
    resetGoogleTokenCacheForTests();
  }
}

// ── 1. Logo byte integrity ────────────────────────────────────────────────────

Deno.test("TESTER-1303 logo integrity: the embedded base64 decodes to the EXACT bytes forensics validated (sha256 bfa1260…, 50119 bytes, PNG magic)", async () => {
  const bytes = decodeBase64ToBytes(MINGLA_SQUARE_LOGO_PNG_BASE64);
  // Byte length must equal the source PNG forensics used.
  assertEquals(bytes.length, FORENSICS_VALIDATED_BYTES);
  // Valid PNG magic: 89 50 4E 47 0D 0A 1A 0A.
  assertEquals(
    Array.from(bytes.slice(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  const hex = await sha256Hex(bytes);
  // The decoded bytes hash to the declared constant AND the forensics-validated
  // hash. A tampered/corrupted MINGLA_SQUARE_LOGO_PNG_BASE64 fails HERE — meaning
  // the create would no longer ship the exact bytes Google accepted at HTTP 200.
  assertEquals(hex, MINGLA_SQUARE_LOGO_PNG_SHA256);
  assertEquals(hex, FORENSICS_VALIDATED_SHA256);
});

Deno.test("TESTER-1303 logo integrity: a single flipped byte is DETECTED by the declared sha256 (the constant self-guards)", async () => {
  const bytes = decodeBase64ToBytes(MINGLA_SQUARE_LOGO_PNG_BASE64);
  const tampered = bytes.slice();
  tampered[100] = tampered[100] ^ 0xff; // flip one byte
  const tamperedHex = await sha256Hex(tampered);
  // The declared hash must NOT match the tampered bytes — proving the sha256
  // constant is a real integrity anchor, not a coincidental string.
  assert(
    tamperedHex !== MINGLA_SQUARE_LOGO_PNG_SHA256,
    "declared sha256 must differ from tampered bytes",
  );
});

// ── 2. Asset cross-wiring (video ↔ logo swap guard) ───────────────────────────

Deno.test("TESTER-1303 cross-wiring: videos[] → the youtubeVideoAsset op (-3); logoImages[] → the imageAsset op (-5) — a swap is caught", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, INPUT);
  const videoAsset = assetCreateByField(ops, "youtubeVideoAsset");
  const logoAsset = assetCreateByField(ops, "imageAsset");
  // The two assets are DISTINCT temp resources (-3 video, -5 logo).
  assertStringIncludes(videoAsset.resourceName as string, "/assets/-3");
  assertStringIncludes(logoAsset.resourceName as string, "/assets/-5");
  assert(
    videoAsset.resourceName !== logoAsset.resourceName,
    "video and logo must be distinct asset ops",
  );
  const dg = adOf(ops).demandGenVideoResponsiveAd as Record<string, unknown>;
  // videos[] points at the VIDEO asset, logoImages[] at the LOGO asset — never
  // swapped (a swap would ship a YouTube ref as a logo image and vice-versa).
  assertEquals(dg.videos, [{ asset: videoAsset.resourceName }]);
  assertEquals(dg.logoImages, [{ asset: logoAsset.resourceName }]);
  // And the logo bytes actually embedded are the Mingla square logo constant.
  assertEquals(logoAsset.imageAsset, { data: MINGLA_SQUARE_LOGO_PNG_BASE64 });
  // The video asset carries the prepared youtube id, not the logo.
  assertEquals(videoAsset.youtubeVideoAsset, { youtubeVideoId: "dQw4w9WgXcQ" });
});

// ── 3. Fail-closed exhaustive + base64 trust boundary ─────────────────────────

Deno.test("TESTER-1303 fail-closed: empty / whitespace / tab-newline / missing logoImageData ALL throw demand_gen_logo_missing", () => {
  const bad = ["", "   ", "\t\n ", " "]; // incl. a non-breaking space
  for (const v of bad) {
    const err = assertThrows(
      () =>
        buildGoogleDemandGenMutateOperations(CUSTOMER_ID, {
          ...INPUT,
          logoImageData: v,
        }),
      AdApiError,
      undefined,
      `logoImageData ${JSON.stringify(v)} must fail closed`,
    );
    assertEquals((err as AdApiError).code, "demand_gen_logo_missing");
    assertEquals((err as AdApiError).platform, "google");
  }
  // A MISSING field (undefined) also fails closed (input.logoImageData?.trim()).
  const missing = { ...INPUT } as Record<string, unknown>;
  delete missing.logoImageData;
  const err = assertThrows(
    () =>
      buildGoogleDemandGenMutateOperations(
        CUSTOMER_ID,
        missing as unknown as GoogleDemandGenVideoInput,
      ),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "demand_gen_logo_missing");
});

Deno.test("TESTER-1303 trust boundary: the guard is emptiness-ONLY — a non-empty non-base64 logo is NOT rejected by the builder (base64 validity is the constant's + Google's job)", () => {
  // This documents the trust boundary explicitly: the builder does not validate
  // base64. In production the ONLY caller passes the sha256'd constant, so this
  // path cannot occur — but the builder must not silently "succeed-look" on junk
  // by throwing the WRONG error. It emits the junk verbatim for Google to reject.
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, {
    ...INPUT,
    logoImageData: "not-valid-base64!!!",
  });
  const logoAsset = assetCreateByField(ops, "imageAsset");
  assertEquals(logoAsset.imageAsset, { data: "not-valid-base64!!!" });
});

// ── 4. Multi-geo scale — all ad-group-level location criteria ─────────────────

Deno.test("TESTER-1303 multi-geo: N=5 geo → 5 AD-GROUP location criteria, ZERO campaign-level, each bound to the SAME ad-group temp resource", () => {
  const ids = ["1006886", "1013962", "2840", "2826", "2704"];
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, {
    ...INPUT,
    geoTargetCriterionIds: ids,
  });
  // RC-1: NOTHING at campaign level.
  assertEquals(ops.filter((o) => "campaignCriterionOperation" in o).length, 0);
  const criterionOps = ops.filter((o) => "adGroupCriterionOperation" in o);
  assertEquals(criterionOps.length, 5);
  const adGroupRes = (ops.find((o) => "adGroupOperation" in o)!
    .adGroupOperation as Record<string, unknown>).create as Record<
      string,
      unknown
    >;
  const seen: string[] = [];
  for (const c of criterionOps) {
    const create = (c.adGroupCriterionOperation as Record<string, unknown>)
      .create as Record<string, unknown>;
    // Every criterion binds to the ad group (define-before-reference).
    assertEquals(create.adGroup, adGroupRes.resourceName);
    // It is a LOCATION criterion — not language / proximity / anything else.
    assertEquals(Object.keys(create).sort(), ["adGroup", "location"]);
    const loc = create.location as Record<string, unknown>;
    assertStringIncludes(
      loc.geoTargetConstant as string,
      "geoTargetConstants/",
    );
    seen.push(loc.geoTargetConstant as string);
  }
  // All five ids threaded, in order, none dropped or duplicated.
  assertEquals(
    seen,
    ids.map((id) => `geoTargetConstants/${id}`),
  );
});

// ── 5. Validate-accept shape — empty-ARRAY mutateOperationResponses ───────────

Deno.test("TESTER-1303 validate accept: a real 200 with mutateOperationResponses:[] (empty array) is validated:true, and the wired body is the corrected shape", async () => {
  await withMockedGoogle({ mutateOperationResponses: [] }, async (captured) => {
    const result = await googleCreateDemandGenVideoCampaign(CONN, {
      ...INPUT,
      geoTargetCriterionIds: ["1006886", "1013962"],
      validateOnly: true,
    });
    assertEquals(result.validated, true);
    assertEquals(result.externalCampaignId, "");
    assertEquals(result.externalAdId, "");
    const body = captured.mutateBody as Record<string, unknown>;
    assertEquals(body.validateOnly, true);
    assertEquals(body.partialFailure, false);
    const bodyOps = body.mutateOperations as Record<string, unknown>[];
    // Corrected shape crossed the wire: ad-group geo (×2), no campaign geo.
    assertEquals(
      bodyOps.filter((o) => "campaignCriterionOperation" in o).length,
      0,
    );
    assertEquals(
      bodyOps.filter((o) => "adGroupCriterionOperation" in o).length,
      2,
    );
    const ad = ((bodyOps.find((o) => "adGroupAdOperation" in o)!
      .adGroupAdOperation as Record<string, unknown>).create as Record<
        string,
        unknown
      >).ad as Record<string, unknown>;
    assert(typeof ad.name === "string" && (ad.name as string).length > 0);
    const dg = ad.demandGenVideoResponsiveAd as Record<string, unknown>;
    assert(
      Array.isArray(dg.logoImages) && (dg.logoImages as unknown[]).length >= 1,
    );
  });
});

Deno.test("TESTER-1303 create fail-closed: a real (validateOnly:false) 200 missing the ad ids throws unexpected_mutate_response (never persists an unverifiable create)", async () => {
  await withMockedGoogle(
    {
      mutateOperationResponses: [
        {
          campaignBudgetResult: {
            resourceName: "customers/3623860476/campaignBudgets/1",
          },
        },
      ],
    },
    async () => {
      const err = await assertRejects(
        () =>
          googleCreateDemandGenVideoCampaign(CONN, {
            ...INPUT,
            validateOnly: false,
          }),
        AdApiError,
      );
      assertEquals((err as AdApiError).code, "unexpected_mutate_response");
    },
  );
});

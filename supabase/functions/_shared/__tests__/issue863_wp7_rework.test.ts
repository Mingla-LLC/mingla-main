/**
 * ISSUE-863 WP7 REWORK — regression suite for the QA findings
 * (Mingla_Artifacts/reports/QA_ISSUE-863_WP7.md §3, QA commit 8f8194de0).
 *
 * Append-only NEW file — the tester's issue863_wp7_tester_adversarial.test.ts
 * is untouched (its T-1/T-3 headers deliberately reserve room for these).
 *
 *   R-1 (F-1 · P1): the 'unconfigured' sentinel — or ANY persisted
 *       external_account_id that is not a real numeric advertiser id — is
 *       ABSENCE, never a pin. Proves the exact bricking sequence heals with
 *       NO DB surgery: failed connect (no secrets, sentinel persisted) →
 *       secrets set → resolveTikTokClient succeeds on the SAME poisoned row.
 *       Cross-adapter bug CLASS (WP6 reddit fixed with the same idiom).
 *       Fails-on-revert: TRUE LINE DELETION of the
 *       `if (!NUMERIC_ID_REGEX.test(connAdvertiserId)) connAdvertiserId = "";`
 *       guard in resolveTikTokClient makes R-1b/R-1d fail.
 *   R-2 (F-2 · P2): lone skin-tone modifiers (U+1F3FB–FF) are emoji — both
 *       detected AND stripped; the strip→validate round trip is airtight.
 *   R-3 (F-3 · P2): parseTikTokRegions honors its tolerant-parser contract —
 *       null / non-object elements are skipped, never a raw TypeError.
 *   R-4 (F-4 · P3): TAG characters (U+E0020–E007F) never survive stripEmoji
 *       as invisible junk.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/issue863_wp7_rework.test.ts
 */

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { type AdConnectionRow, AdApiError, AdNotConnectedError } from "../adChannel.ts";
import {
  containsEmoji,
  parseTikTokRegions,
  resolveTikTokClient,
  stripEmoji,
  validateTikTokAdText,
} from "../tiktok.ts";

const REAL_ADVERTISER = "7627974536397766673";
const OTHER_ADVERTISER = "7627974536397766999";
/** Unique names so this file can never collide with other suites' env state. */
const TOKEN_ENV = "TIKTOK_ACCESS_TOKEN_WP7_REWORK_TEST";
const ADVERTISER_ENV = "TIKTOK_ADVERTISER_ID";

/** The exact poisoned row a failed pre-secrets connect persists (QA §5 leg 5). */
function poisonedRow(externalAccountId: string): AdConnectionRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    platform: "tiktok",
    lane: "consumer",
    display_name: "TikTok · Consumer",
    external_account_id: externalAccountId,
    external_org_id: null,
    auth_kind: "system_user_token",
    token_env_var: TOKEN_ENV,
    extra: {},
    status: "invalid",
    currency: null,
    timezone: null,
    min_daily_budget_cents: null,
    account_status: null,
    token_last_verified_at: null,
    connected: false,
  };
}

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const prior = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    prior.set(key, Deno.env.get(key));
    Deno.env.set(key, value);
  }
  try {
    fn();
  } finally {
    for (const [key, previous] of prior) {
      if (previous === undefined) Deno.env.delete(key);
      else Deno.env.set(key, previous);
    }
  }
}

// ── R-1 (F-1): the sentinel is ABSENCE — the bricking sequence heals ──────────

Deno.test("R-1a (F-1): pre-secrets, the poisoned sentinel row still fail-closes as NOT_CONNECTED — never advertiser_mismatch", () => {
  // Step 1 of the QA sequence: secrets absent; the sentinel row must produce
  // the recoverable 424-class error, not the mismatch dead-end.
  assertThrows(() => resolveTikTokClient(poisonedRow("unconfigured")), AdNotConnectedError);
});

Deno.test("R-1b (F-1): THE bricking sequence heals — failed connect persisted 'unconfigured', then secrets land, then resolve SUCCEEDS on the same row (no DB surgery)", () => {
  withEnv({ [TOKEN_ENV]: "fake-token-for-resolution-only", [ADVERTISER_ENV]: REAL_ADVERTISER }, () => {
    // QA §5 legs 8–13 replayed: this exact call returned 424 advertiser_mismatch
    // forever ("TIKTOK_ADVERTISER_ID (…) does not match … (unconfigured)").
    const client = resolveTikTokClient(poisonedRow("unconfigured"));
    assertEquals(client.advertiserId, REAL_ADVERTISER, "the env advertiser must win over the sentinel");
    assertEquals(client.platform, "tiktok");
  });
});

Deno.test("R-1c (F-1 guard retained): a REAL numeric persisted id that differs from env still hard-fails advertiser_mismatch", () => {
  withEnv({ [TOKEN_ENV]: "fake-token-for-resolution-only", [ADVERTISER_ENV]: REAL_ADVERTISER }, () => {
    const err = assertThrows(
      () => resolveTikTokClient(poisonedRow(OTHER_ADVERTISER)),
      AdApiError,
    );
    assertEquals((err as AdApiError).code, "advertiser_mismatch");
  });
});

Deno.test("R-1d (F-1): ANY non-numeric persisted id is absence, never a pin (the bug CLASS, not just the one sentinel)", () => {
  withEnv({ [TOKEN_ENV]: "fake-token-for-resolution-only", [ADVERTISER_ENV]: REAL_ADVERTISER }, () => {
    for (const garbage of ["unconfigured", "pending", "act_123", " 762797453639776667x", "—"]) {
      const client = resolveTikTokClient(poisonedRow(garbage));
      assertEquals(
        client.advertiserId,
        REAL_ADVERTISER,
        `persisted "${garbage}" must be treated as absence`,
      );
    }
  });
});

Deno.test("R-1e (F-1): with secrets set and a HEALTHY matching row, resolution is unchanged", () => {
  withEnv({ [TOKEN_ENV]: "fake-token-for-resolution-only", [ADVERTISER_ENV]: REAL_ADVERTISER }, () => {
    const client = resolveTikTokClient(poisonedRow(REAL_ADVERTISER));
    assertEquals(client.advertiserId, REAL_ADVERTISER);
  });
});

// ── R-2 (F-2): skin-tone modifiers are emoji — detect + strip + round trip ────

Deno.test("R-2a (F-2): a lone skin-tone modifier IS emoji (contains + validate reject)", () => {
  assertEquals(containsEmoji("\u{1F3FD}"), true);
  const rejected = validateTikTokAdText("\u{1F3FD} nice event");
  assertEquals(rejected.ok, false);
  if (!rejected.ok) assertEquals(rejected.detail, "ad_text_emoji");
});

Deno.test("R-2b (F-2): stripEmoji strips the WHOLE skin-toned emoji — no stranded modifier", () => {
  assertEquals(stripEmoji("\u{1F44D}\u{1F3FD}"), ""); // 👍🏽 → nothing, not 🏽
  assertEquals(stripEmoji("Great vibes \u{1F44B}\u{1F3FB} tonight"), "Great vibes tonight");
  for (const tone of ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"]) {
    assertEquals(containsEmoji(tone), true, `tone ${tone.codePointAt(0)?.toString(16)} must be detected`);
    assertEquals(stripEmoji(tone), "", `tone must be stripped`);
  }
});

Deno.test("R-2c (F-2/F-4): strip→validate round trip is airtight — stripped output never still 'contains'", () => {
  const hostile = [
    "Party tonight \u{1F389}",
    "\u{1F44D}\u{1F3FD} approved",
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} England",
    "Family \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466} night",
    "London \u{1F1EC}\u{1F1E7} calling",
    "1\u{FE0F}\u{20E3} spot left \u{1F3FF}",
  ];
  for (const input of hostile) {
    const stripped = stripEmoji(input);
    assertEquals(containsEmoji(stripped), false, `strip output of "${input}" must not contain emoji`);
    assertEquals(
      validateTikTokAdText(stripped).ok,
      true,
      `strip output of "${input}" must pass validation`,
    );
  }
});

// ── R-3 (F-3): tolerant parser — non-object elements are skipped ──────────────

Deno.test("R-3 (F-3): parseTikTokRegions skips null / non-object elements instead of throwing", () => {
  const regions = parseTikTokRegions({
    region_info: [
      null,
      42,
      "US",
      [],
      undefined,
      { location_id: "6252001", region_code: "US", name: "United States", level: "COUNTRY" },
    ],
  });
  assertEquals(regions.length, 1);
  assertEquals(regions[0].locationId, "6252001");
  assertEquals(regions[0].regionCode, "US");
  // Whole-payload garbage still degrades to empty, never a throw.
  assertEquals(parseTikTokRegions({ region_info: [null, null] }), []);
});

// ── R-4 (F-4): TAG characters never survive as invisible junk ─────────────────

Deno.test("R-4 (F-4): TAG characters (U+E0020–E007F) are detected and stripped — zero invisible residue", () => {
  const englandTagFlag = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
  assertEquals(containsEmoji(englandTagFlag), true);
  assertEquals(stripEmoji(englandTagFlag), "", "no invisible tag residue");
  // A bare tag char (no base) is also plumbing → detected + stripped.
  assertEquals(containsEmoji("\u{E0067}"), true);
  assertEquals(stripEmoji("ok\u{E0067}ok"), "okok");
  assert(stripEmoji(`before ${englandTagFlag} after`) === "before after");
});

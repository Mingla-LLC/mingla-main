/**
 * ISSUE-927 — admin-ad-create-campaign gains the TikTok + Reddit create
 * branches (the last two channels routed through the Meta-shaped generic
 * path, which structurally 422/424'd them — the WP4 endpoint gap).
 *
 * Source-contract suite over the edge function (the adapters' wire behavior
 * is already pinned by the WP7/WP6 suites; these tests pin what the EDGE
 * BRANCH does with them). Provenance rule (COMMS-0106): every sliced marker
 * is asserted to appear EXACTLY ONCE before any containment assertion runs.
 *
 * Pins:
 *   1. Both branches exist and are self-contained (house pattern).
 *   2. VALIDATE GATES: neither platform has a validate-only mode — each
 *      branch returns the explicit named-skipped-layers response BEFORE any
 *      adapter/chain/upload call (the generic block would create REAL
 *      objects — Snapchat WP2 §10 precedent).
 *   3. T-7 NON-COLLISION: the OneLink identifiers stay platform-suffixed
 *      (tiktokSmartLink / redditSmartLink); the WP1 destSmartLink contract
 *      (exactly 1 declaration + 1 DB-insert use) is undisturbed; the ad-
 *      visible destination is the canonical dest_url on both branches.
 *   4. REDDIT-PAUSED: the reddit branch persists status:"PAUSED" on all
 *      three rows and routes creation ONLY through redditCreateFullChain
 *      (G-1: create bodies are built in the three reddit.ts builders — the
 *      edge fn never hand-rolls one, so configured_status:"PAUSED" ×3 and
 *      the unconditional conversion_pixel_id injection are structural).
 *   5. TIKTOK: identity fail-close (T-6) runs BEFORE the atomic create; geo
 *      resolves LIVE via resolveTikTokGeo with geo_unavailable → 422
 *      (AC-13); the create goes through createFullCampaignAtomic with the
 *      tiktok adapter (operation_status=DISABLE ×3 lives in the builders —
 *      A1.0-4, pinned by the WP7 suite); PAUSED persisted ×3.
 *
 * Run: deno test --allow-read supabase/functions/_shared/__tests__/issue927_create_fn_tiktok_reddit_branches.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const CREATE_FN_PATH = new URL(
  "../../admin-ad-create-campaign/index.ts",
  import.meta.url,
);

async function readCreateFn(): Promise<string> {
  return await Deno.readTextFile(CREATE_FN_PATH);
}

/** Asserts the marker appears exactly once (slice provenance — COMMS-0106). */
function indexOfUnique(src: string, marker: string): number {
  const first = src.indexOf(marker);
  assert(first >= 0, `marker not found: ${marker}`);
  assertEquals(
    src.indexOf(marker, first + 1),
    -1,
    `marker appears more than once (slice provenance broken): ${marker}`,
  );
  return first;
}

const TIKTOK_BRANCH_MARKER = 'if (platform === "tiktok") {';
const REDDIT_BRANCH_MARKER = 'if (platform === "reddit") {';
const GENERIC_PATH_MARKER = "// QA P1-1: WP1 accepts ONLY the §4.4b default bid strategy";

async function branchSlices(): Promise<{ tiktok: string; reddit: string; src: string }> {
  const src = await readCreateFn();
  const tiktokStart = indexOfUnique(src, TIKTOK_BRANCH_MARKER);
  const redditStart = indexOfUnique(src, REDDIT_BRANCH_MARKER);
  const genericStart = indexOfUnique(src, GENERIC_PATH_MARKER);
  assert(tiktokStart < redditStart, "tiktok branch precedes reddit branch");
  assert(redditStart < genericStart, "reddit branch precedes the generic (Meta) path");
  return {
    tiktok: src.slice(tiktokStart, redditStart),
    reddit: src.slice(redditStart, genericStart),
    src,
  };
}

// ── 1. Branches exist, self-contained, before the generic Meta path ───────────

Deno.test("927: tiktok + reddit branches exist ahead of the generic Meta path", async () => {
  const { tiktok, reddit } = await branchSlices();
  assert(tiktok.includes('getAdapter("tiktok")'), "tiktok branch resolves its own adapter");
  assert(reddit.includes("redditCreateFullChain("), "reddit branch calls the WP6 full chain");
});

// ── 2. Validate gates — named-skipped-layers BEFORE any platform write ────────

Deno.test("927: tiktok validate gate returns named-skipped-layers before ANY adapter call or upload", async () => {
  const { tiktok } = await branchSlices();
  const gate = tiktok.indexOf("tiktok_no_validate_only");
  assert(gate >= 0, "tiktok branch must carry the no-validate-only gate");
  for (const call of ["createFullCampaignAtomic(", "tiktokUploadImage(", "resolveTikTokGeo("]) {
    const at = tiktok.indexOf(call);
    assert(at > gate, `${call} must come AFTER the validate gate (a validate_only run may never reach it)`);
  }
  assert(tiktok.includes("skipped_layers"), "the response names the skipped layers");
  assert(
    tiktok.includes('{ layer: "campaign"') && tiktok.includes('{ layer: "ad_group"') &&
      tiktok.includes('{ layer: "ad"'),
    "all three TikTok layers are named-skipped",
  );
});

Deno.test("927: reddit validate gate returns named-skipped-layers before the chain (a t3_ post is a REAL object)", async () => {
  const { reddit } = await branchSlices();
  const gate = reddit.indexOf("reddit_no_validate_only");
  assert(gate >= 0, "reddit branch must carry the no-validate-only gate");
  const chainAt = reddit.indexOf("redditCreateFullChain(");
  assert(chainAt > gate, "redditCreateFullChain must come AFTER the validate gate");
  for (const layer of ['{ layer: "campaign"', '{ layer: "ad_group"', '{ layer: "creative"', '{ layer: "ad"']) {
    assert(reddit.includes(layer), `reddit skipped layers must name ${layer}`);
  }
});

// ── 3. T-7 non-collision + destination policy on both branches ────────────────

Deno.test("927: the WP1 T-7 destSmartLink contract is undisturbed (1 declaration + 1 DB insert; new branches use suffixed identifiers)", async () => {
  const { tiktok, reddit, src } = await branchSlices();
  // The exact WP1 T-7 assertions, re-run here so a future rename-back fails
  // THIS suite too, not just the WP1 one.
  assertEquals((src.match(/const destSmartLink\s*=/g) ?? []).length, 1);
  assertEquals((src.match(/dest_smart_link:\s*destSmartLink/g) ?? []).length, 1);
  assertEquals((src.match(/destSmartLink/g) ?? []).length, 2);
  // The new branches carry their own identifiers into the DB slot only.
  assert(tiktok.includes("dest_smart_link: tiktokSmartLink"), "tiktok smart link goes to the DB slot");
  assert(reddit.includes("dest_smart_link: redditSmartLink"), "reddit smart link goes to the DB slot");
  assertEquals(
    (tiktok.match(/tiktokSmartLink/g) ?? []).length,
    2,
    "tiktokSmartLink = declaration + DB insert ONLY (never adapter input)",
  );
  assertEquals(
    (reddit.match(/redditSmartLink/g) ?? []).length,
    2,
    "redditSmartLink = declaration + DB insert ONLY (never adapter input)",
  );
});

Deno.test("927: the ad-visible destination is the canonical dest_url on both branches (A1.0-5 / D-P1 — never the OneLink)", async () => {
  const { tiktok, reddit } = await branchSlices();
  assert(tiktok.includes("landingPageUrl: destUrlT"), "tiktok landing_page_url = canonical page");
  assert(!tiktok.includes("landingPageUrl: tiktokSmartLink"), "the OneLink may never be the TikTok landing page");
  assert(reddit.includes("clickUrl: destUrlR"), "reddit click_url = canonical page");
  assert(!reddit.includes("clickUrl: redditSmartLink"), "the OneLink may never be the Reddit click_url");
  assert(reddit.includes("destinationUrl: destUrlR"), "reddit creative destination = canonical page");
});

// ── 4. Reddit-PAUSED + chain-only body construction ───────────────────────────

Deno.test("927: the reddit branch persists status: \"PAUSED\" on all three rows (fails-on-revert target)", async () => {
  const { reddit } = await branchSlices();
  // NB: the matcher must NOT count `to_status: "PAUSED"` (the audit field) —
  // a loose /status:/ regex is exactly the orphaned-test trap (COMMS-0106).
  const paused = reddit.match(/(?<![a-z_])status:\s*"PAUSED"/g) ?? [];
  assert(
    paused.length >= 3,
    `reddit branch must persist PAUSED on the campaign+ad_set+ad rows; found ${paused.length} bare status:"PAUSED" sites`,
  );
  assert(reddit.includes('to_status: "PAUSED"'), "the create audit row records PAUSED");
});

Deno.test("927: the reddit branch NEVER hand-rolls a create body (G-1 — configured_status lives in the three reddit.ts builders only)", async () => {
  const { reddit } = await branchSlices();
  // Comments may cite the builders' contract; CODE may not construct it.
  const codeOnly = reddit.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  assert(
    !codeOnly.includes("configured_status"),
    "configured_status found in the edge branch CODE — create bodies are built ONLY by buildReddit*Body (G-1); the edge fn must route through redditCreateFullChain",
  );
  assert(reddit.includes("redditConnExtras(rconn)"), "the §1.4 extras (profile/funding/pixel) fail-close pre-chain");
  assert(reddit.includes("isCbo: false"), "v1 default is non-CBO — the budget lives on the ad group (§3.1)");
});

// ── 5. TikTok ordering + geo + PAUSED ─────────────────────────────────────────

Deno.test("927: tiktok identity fail-close (T-6) runs BEFORE the atomic create", async () => {
  const { tiktok } = await branchSlices();
  const identityAt = tiktok.indexOf("assertTikTokIdentityAllowed(");
  const createAt = tiktok.indexOf("createFullCampaignAtomic(");
  assert(identityAt >= 0, "identity gate present");
  assert(createAt > identityAt, "identity gate precedes the create — a broken identity must never create-then-rollback");
  assert(tiktok.includes("tiktok_identity_missing"), "missing identity_id fails close with a named error");
});

Deno.test("927: tiktok geo resolves LIVE and an unavailable country is a loud 422 (AC-13 — GB is live-proven absent)", async () => {
  const { tiktok } = await branchSlices();
  assert(tiktok.includes("resolveTikTokGeo("), "geo resolves LIVE against tool/region (OD-7 reversed)");
  assert(
    /geo_unavailable[\s\S]{0,200}?422/.test(tiktok),
    "geo_unavailable maps to a 422 naming the countries — never a silent drop",
  );
});

Deno.test("927: tiktok persists status: \"PAUSED\" on all three rows; budget floors run in DOLLARS after conversion", async () => {
  const { tiktok } = await branchSlices();
  const paused = tiktok.match(/(?<![a-z_])status:\s*"PAUSED"/g) ?? [];
  assert(paused.length >= 3, `tiktok branch must persist PAUSED ×3; found ${paused.length}`);
  const convertAt = tiktok.indexOf('centsToPlatformBudget("tiktok"');
  const floorAt = tiktok.indexOf("validateTikTokBudgetFloor(");
  assert(convertAt >= 0 && floorAt > convertAt, "the floor check runs AFTER the cents→dollars conversion (A1.0-1)");
});

Deno.test("927: tiktok attribution rides utm_params with serve-time macros — never the OneLink", async () => {
  const { tiktok } = await branchSlices();
  assert(tiktok.includes('{ key: "utm_source", value: "tiktok" }'), "utm_source=tiktok");
  assert(tiktok.includes("__CAMPAIGN_ID__"), "the TikTok serve-time campaign macro is used");
});

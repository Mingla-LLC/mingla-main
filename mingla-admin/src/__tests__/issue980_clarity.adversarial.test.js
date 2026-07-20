// ISSUE-980 [Campaign Builder clarity] — TESTER adversarial regression suite
// (mingla-tester, PR #985 independent verification). Deliberately a DIFFERENT
// angle than the implementor's three issue980_*.test.js suites:
//
//  1. Stepper: attacks NUMERIC EXTREMES (0 / negative / Infinity / a
//     sub-pixel fraction straddling the exact breakpoint) that the
//     implementor's suite never fed isCompactStepper, plus derives the
//     10-step list by PARSING CampaignBuilderPage.jsx's real `STEPS` array
//     (never hand-copied — catches label/id drift the implementor's suite
//     can't) and asserts every real step abbreviates safely with no
//     collisions. Also a repo-wide grep (not file-scoped) that the retired
//     `minmax(0,720px)` track has no other copy anywhere under
//     mingla-admin/src.
//  2. Preflight copy: instead of hand-transcribed fixture strings, this
//     pulls REAL raw `detail` literals straight out of
//     supabase/functions/admin-ad-preflight/index.ts and _shared/reddit.ts —
//     including several the implementor's fixture list never exercised
//     (Snapchat's P4 PASS detail carrying #865 + a raw 422 code + an
//     internal citation, TikTok's P5 PASS detail carrying proof-tag T-P1,
//     Meta's "cannot see the configured ad account" P1 message, Reddit's
//     unmapped connect-preflight message that cites a raw SPEC section, and
//     Reddit's GR-72 currency-enum message) — proving the two-tier
//     translator holds even against jargon the implementor never wrote a
//     fixture for. Also attacks the empty-string (falsy-but-not-null)
//     `detail` case and an injection-shaped raw string, neither exercised by
//     the implementor's suite.
//  3. Review objective: exercises ALL FIVE platforms at once on a single
//     goal (the implementor's "differing objectives" test only asserts 4 of
//     5 platforms — Snapchat is never once asserted in their file) and an
//     empty-`goalIds` edge case (never fed to the real resolver by the
//     implementor) that proves Meta's guaranteed fallback and every other
//     platform's honest "unresolved" message coexist correctly on the SAME
//     resolution call — plus a malformed-entry-shape defensive check
//     (empty-string `objective` with a populated `optimization_goal`) that
//     is unreachable from goals.js today but must still resolve honestly,
//     not render "· FOO" garbage.
//
// FAILS-ON-REVERT: verified by TRUE line-deletion of the ISSUE-980 fix
// (reverting Stepper.jsx / stepperResponsive.js / StepPreflight.jsx /
// preflightCopy.js / StepReview.jsx / launchSummary.js / objectiveResolver.js
// / CampaignBuilderPage.jsx to their pre-980 state at commit 02eb55f40, the
// direct parent of 26aff513d) — this suite's source-grep + wiring assertions
// go red exactly like the implementor's, and the pure-logic assertions
// either throw (module-not-found) or fail their content assertions.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isCompactStepper, stepLabel, COMPACT_BREAKPOINT_PX } from "../components/campaign-builder/stepperResponsive.js";
import { translatePreflightDetail } from "../lib/adBuilder/preflightCopy.js";
import { resolveGoalForPayload, formatResolvedObjective } from "../lib/adBuilder/objectiveResolver.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");
const read = (p) => fs.readFileSync(p, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// 1. STEPPER — numeric extremes + source-derived 10-step sweep
// ─────────────────────────────────────────────────────────────────────────

describe("ISSUE-980 adversarial — Stepper survives numeric extremes the implementor's suite never fed it", () => {
  it("zero and negative widths (a genuinely impossible layout, but must not crash or flip to full)", () => {
    assert.equal(isCompactStepper(0), true, "0px must be treated as needing compaction, not full density");
    assert.equal(isCompactStepper(-100), true, "a negative width must fail toward the SAFER (compact) density");
  });

  it("Infinity is a real `number` (typeof number, not NaN) — must resolve to full density, not compact", () => {
    // isCompactStepper's guard is `typeof !== "number" || Number.isNaN(...)`.
    // Infinity passes both checks (typeof "number", not NaN), so `Infinity <
    // COMPACT_BREAKPOINT_PX` decides it — false. A naive re-implementation
    // that special-cased "huge numbers" as unknown/compact would flip this.
    assert.equal(isCompactStepper(Infinity), false);
    assert.equal(isCompactStepper(-Infinity), true, "-Infinity is always < the breakpoint");
  });

  it("a sub-pixel fraction straddling the exact breakpoint resolves correctly on BOTH sides", () => {
    assert.equal(isCompactStepper(COMPACT_BREAKPOINT_PX - 0.001), true, "0.001px under the breakpoint is still compact");
    assert.equal(isCompactStepper(COMPACT_BREAKPOINT_PX + 0.001), false, "0.001px over the breakpoint is already full");
  });
});

describe("ISSUE-980 adversarial — ALL 10 real wizard steps, parsed live from CampaignBuilderPage.jsx (not hand-copied)", () => {
  const page = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));
  const stepsBlock = page.match(/const STEPS = \[([\s\S]*?)\];/);
  assert.ok(stepsBlock, "CampaignBuilderPage.jsx must still define a STEPS array in this exact shape — the source this test parses");
  const stepRe = /\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g;
  const REAL_STEPS = [];
  let m;
  while ((m = stepRe.exec(stepsBlock[1]))) REAL_STEPS.push({ id: m[1], label: m[2] });

  it("sanity: parsing found exactly the 10 real steps the 10-step overflow math is about", () => {
    assert.equal(REAL_STEPS.length, 10, `expected 10 real steps, parsed ${REAL_STEPS.length}: ${JSON.stringify(REAL_STEPS)}`);
  });

  it("every real step produces a non-empty label at BOTH densities — no step silently goes blank", () => {
    for (const step of REAL_STEPS) {
      for (const compact of [true, false]) {
        const label = stepLabel(step, { compact });
        assert.ok(typeof label === "string" && label.length > 0, `${step.id} compact=${compact} produced an empty/non-string label: ${JSON.stringify(label)}`);
      }
    }
  });

  it("compact density never LENGTHENS a label — abbreviation only ever shortens or leaves unchanged", () => {
    for (const step of REAL_STEPS) {
      const compactLabel = stepLabel(step, { compact: true });
      assert.ok(
        compactLabel.length <= step.label.length,
        `${step.id}: compact label "${compactLabel}" is longer than the full label "${step.label}"`,
      );
    }
  });

  it("the 10 compact-density labels are all DISTINCT — abbreviation never collides two different steps onto one string", () => {
    const compactLabels = REAL_STEPS.map((s) => stepLabel(s, { compact: true }));
    assert.equal(
      new Set(compactLabels).size,
      compactLabels.length,
      `compact labels must be unique, got: ${JSON.stringify(compactLabels)}`,
    );
  });

  it("exactly the two steps ISSUE-977 named (Channel health, Policy check) are the ones that actually abbreviate — every other step is untouched even in compact density", () => {
    const shortened = REAL_STEPS.filter((s) => stepLabel(s, { compact: true }) !== s.label).map((s) => s.id);
    assert.deepEqual(shortened.sort(), ["policy", "preflight"], `expected exactly preflight+policy to abbreviate, got: ${JSON.stringify(shortened)}`);
  });
});

describe("ISSUE-980 adversarial — the retired minmax(0,720px) track has no surviving LIVE usage ANYWHERE in mingla-admin/src (repo-wide, not file-scoped)", () => {
  it("no file under mingla-admin/src still hard-codes the fixed 720px grid-cols class (excluding __tests__ / prose citing the retired string as history)", () => {
    const srcDir = ADMIN_SRC;
    // The exact Tailwind arbitrary-value class the fix removed — a live
    // usage, not a prose mention of the string (both this suite's own file
    // and the implementor's issue980_stepper_responsive.test.js legitimately
    // CITE "minmax(0,720px)" in assertions/comments about its absence; that
    // is not a regression).
    const LIVE_CLASS_PATTERN = /grid-cols-\[minmax\(0,720px\)_320px\]/;
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__") continue; // test prose citing the retired string is not a regression
          walk(full);
        } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
          const content = fs.readFileSync(full, "utf8");
          if (LIVE_CLASS_PATTERN.test(content)) offenders.push(full);
        }
      }
    };
    walk(srcDir);
    assert.deepEqual(offenders, [], `found a lingering live fixed-720px grid-cols class: ${JSON.stringify(offenders)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. PREFLIGHT COPY — real backend strings the implementor's fixtures skip
// ─────────────────────────────────────────────────────────────────────────

describe("ISSUE-980 adversarial — real admin-ad-preflight/index.ts detail strings the implementor's fixture list never exercised", () => {
  const preflightSrc = read(path.join(REPO_ROOT, "supabase/functions/admin-ad-preflight/index.ts"));
  const redditSrc = read(path.join(REPO_ROOT, "supabase/functions/_shared/reddit.ts"));

  // Each `raw` string below is copied VERBATIM from the live backend source
  // (grep-verified against the two files read above) — none of these seven
  // appear in issue980_preflight_copy_translation.test.js's RAW_JARGON_FIXTURES.
  const UNTESTED_REAL_FIXTURES = [
    {
      name: "Snapchat P4 PASS detail — jargon on a PASSING check (not just fails/warns)",
      sourceFile: "admin-ad-preflight/index.ts",
      sourceNeedle: "pixel EVENTS are #865's",
      platform: "snapchat",
      checkId: "P4",
      status: "pass",
      detail:
        "pixel px_1 ACTIVE — but pixel EVENTS are #865's; LANDING_PAGE_VIEW / PIXEL_* goals stay gated (422 pixel_goal_unavailable) until it fires; SWIPES is the honest goal today (A1.1(6)).",
      bannedSubstrings: ["#865", "422", "A1.1(6)", "pixel_goal_unavailable"],
    },
    {
      name: "TikTok P5 PASS detail — proof-tag T-P1 on a passing review-tier check",
      sourceFile: "admin-ad-preflight/index.ts",
      sourceNeedle: "app approved 2026-07-15 (T-P1)",
      platform: "tiktok",
      checkId: "P5",
      status: "pass",
      detail: "Own-app long-lived Marketing-API token — app approved 2026-07-15 (T-P1); the reads above ran against the real advertiser.",
      bannedSubstrings: ["T-P1"],
    },
    {
      name: "Meta P1 — token authenticates but can't see the configured account",
      sourceFile: "admin-ad-preflight/index.ts",
      sourceNeedle: "Token authenticates but cannot see the configured ad account",
      platform: "meta",
      checkId: "P1",
      status: "fail",
      detail: "Token authenticates but cannot see the configured ad account.",
      bannedSubstrings: ["act_", "adaccounts"],
    },
    {
      name: "Meta P2 — PENDING_BILLING_INFO raw enum value",
      sourceFile: "admin-ad-preflight/index.ts",
      sourceNeedle: "PENDING_BILLING_INFO",
      platform: "meta",
      checkId: "P2",
      status: "fail",
      detail: "account_status=2, payment method MISSING — launched campaigns park at PENDING_BILLING_INFO until billing is added.",
      bannedSubstrings: ["PENDING_BILLING_INFO", "account_status="],
    },
    {
      name: "Meta P3 — meta_page_not_assigned raw error code",
      sourceFile: "admin-ad-preflight/index.ts",
      sourceNeedle: "meta_page_not_assigned",
      platform: "meta",
      checkId: "P3",
      status: "fail",
      detail: "meta_page_not_assigned — assign the Page to the system user in Business Settings.",
      bannedSubstrings: ["meta_page_not_assigned"],
    },
    {
      name: "Reddit — the UNMAPPED connect-preflight message citing a raw SPEC section (no pattern rule targets this text at all)",
      sourceFile: "_shared/reddit.ts",
      sourceNeedle: "No ad account matching ^(t2|a2)_ found on the business",
      platform: "reddit",
      checkId: "P1",
      status: "fail",
      detail: "No ad account matching ^(t2|a2)_ found on the business (SPEC §1.3 step 4).",
      bannedSubstrings: ["SPEC §1.3", "^(t2|a2)_", "step 4"],
    },
    {
      name: "Reddit — GR-72 currency-enum message (regex characters + an internal doc citation)",
      sourceFile: "_shared/reddit.ts",
      sourceNeedle: "outside Reddit's 8-value enum",
      platform: "reddit",
      checkId: "P1",
      status: "fail",
      detail:
        "Ad-account currency EUR is outside Reddit's 8-value enum (USD, CAD, GBP, AUD, JPY, SEK, PLN, MXN) — note NGN does not exist; Reddit is not a Nigeria channel (GR-72).",
      bannedSubstrings: ["GR-72", "8-value enum"],
    },
  ];

  it("sanity: every fixture's needle is actually present in the live backend source (fixtures can't silently drift from reality)", () => {
    for (const fixture of UNTESTED_REAL_FIXTURES) {
      const src = fixture.sourceFile.startsWith("_shared") ? redditSrc : preflightSrc;
      assert.ok(
        src.includes(fixture.sourceNeedle),
        `${fixture.name}: needle "${fixture.sourceNeedle}" not found in ${fixture.sourceFile} — this fixture no longer reflects the real backend`,
      );
    }
  });

  for (const fixture of UNTESTED_REAL_FIXTURES) {
    it(`${fixture.name} — friendly text hides the jargon`, () => {
      const { friendly, technical } = translatePreflightDetail(fixture);
      assert.ok(friendly && friendly.length > 10, "friendly text must be a real sentence");
      for (const banned of fixture.bannedSubstrings) {
        assert.ok(!friendly.includes(banned), `friendly text leaked "${banned}": ${friendly}`);
      }
      assert.equal(technical, fixture.detail, "technical must preserve the raw detail verbatim, unmodified");
    });
  }
});

describe("ISSUE-980 adversarial — falsy-but-defined and hostile raw detail strings", () => {
  it("an EMPTY STRING detail (falsy, but not null/undefined) still yields a friendly baseline, and StepPreflight.jsx's {technical && …} guard hides an empty disclosure (no dead empty toggle)", () => {
    const { friendly, technical } = translatePreflightDetail({ platform: "meta", checkId: "P5", status: "n/a", detail: "" });
    assert.ok(friendly.length > 0, "must still produce a friendly sentence when detail is an empty string, not null");
    assert.equal(technical, "", "technical carries the empty string through unmodified (never coerced to null)");
    // "" is falsy in JS — StepPreflight.jsx's `{technical && (<disclosure/>)}` must
    // therefore render NOTHING for this row, matching the null-detail case (no
    // empty "Technical details" toggle with nothing behind it).
    assert.ok(!technical, "an empty-string technical must be falsy so the JSX disclosure guard skips it");
  });

  it("an injection-shaped raw detail (script tag + raw memory address) is preserved verbatim in `technical` but NEVER echoed into `friendly`", () => {
    const hostile = "<script>alert(document.cookie)</script> segfault at 0x7ffee3a1b8c0";
    const { friendly, technical } = translatePreflightDetail({ platform: "google", checkId: "P2", status: "fail", detail: hostile });
    assert.equal(technical, hostile, "technical must never sanitize or truncate the raw detail — it's the support affordance");
    assert.ok(!friendly.includes("<script>"), "friendly text must never echo raw markup from the detail string");
    assert.ok(!friendly.includes("0x7ffee3a1b8c0"), "friendly text must never echo a raw memory address");
    assert.ok(friendly.length > 10 && friendly.length < 300, "friendly text must be a bounded plain sentence, not the hostile string passed through");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. REVIEW OBJECTIVE — all 5 platforms at once + empty-goalIds edge
// ─────────────────────────────────────────────────────────────────────────

describe("ISSUE-980 adversarial — ALL FIVE platforms (Snapchat included — never once asserted in the implementor's suite) funded simultaneously on one goal", () => {
  it("a single-goal, all-5-platform funded plan renders 5 DISTINCT real objective strings, Snapchat included", () => {
    const resolvedGoal = resolveGoalForPayload(["traffic"]);
    const summary = buildLaunchSummary({
      channelRows: [
        { platform: "meta", label: "Meta", eligible: true, amber: null },
        { platform: "tiktok", label: "TikTok", eligible: true, amber: null },
        { platform: "snapchat", label: "Snap", eligible: true, amber: null },
        { platform: "google", label: "Google", eligible: true, amber: null },
        { platform: "reddit", label: "Reddit", eligible: true, amber: null },
      ],
      allocations: [
        { platform: "meta", dailyCents: 1000 },
        { platform: "tiktok", dailyCents: 1000 },
        { platform: "snapchat", dailyCents: 1000 },
        { platform: "google", dailyCents: 1000 },
        { platform: "reddit", dailyCents: 1000 },
      ],
      resolvedGoal,
      totalDailyCents: 5000,
    });

    assert.equal(summary.channels.length, 5);
    const byPlatform = Object.fromEntries(summary.channels.map((c) => [c.platform, c.objectiveLabel]));

    // Snapchat specifically: the ONE platform (besides Meta) that carries a
    // combined objective + optimization_goal pair — the implementor's suite
    // never asserts this platform anywhere in issue980_review_real_objectives.
    assert.equal(byPlatform.snapchat, "TRAFFIC · SWIPES", "Snapchat must render its own combined objective/optimization_goal pair, not Meta's or TikTok's");

    assert.equal(byPlatform.meta, "OUTCOME_TRAFFIC · LINK_CLICKS");
    assert.equal(byPlatform.tiktok, "TRAFFIC");
    assert.equal(byPlatform.google, "SEARCH · maximize_clicks");
    assert.equal(byPlatform.reddit, "CLICKS");

    const distinct = new Set(Object.values(byPlatform));
    assert.equal(distinct.size, 5, `expected all 5 objective strings to be distinct, got: ${JSON.stringify(byPlatform)}`);
  });
});

describe("ISSUE-980 adversarial — empty goalIds fed through the REAL resolver: Meta's guaranteed default coexists with 4 honest 'unresolved' rows", () => {
  it("goalIds=[] (no goal selected) still produces a fully-rendered, non-crashing summary — Meta honest-defaults, everyone else honestly unresolved", () => {
    const resolvedGoal = resolveGoalForPayload([]);
    const summary = buildLaunchSummary({
      channelRows: [
        { platform: "meta", label: "Meta", eligible: true, amber: null },
        { platform: "tiktok", label: "TikTok", eligible: true, amber: null },
        { platform: "snapchat", label: "Snap", eligible: true, amber: null },
        { platform: "google", label: "Google", eligible: true, amber: null },
        { platform: "reddit", label: "Reddit", eligible: true, amber: null },
      ],
      allocations: [
        { platform: "meta", dailyCents: 1000 },
        { platform: "tiktok", dailyCents: 1000 },
        { platform: "snapchat", dailyCents: 1000 },
        { platform: "google", dailyCents: 1000 },
        { platform: "reddit", dailyCents: 1000 },
      ],
      resolvedGoal,
      totalDailyCents: 5000,
    });

    const byPlatform = Object.fromEntries(summary.channels.map((c) => [c.platform, c.objectiveLabel]));
    // Meta's resolveMetaObjective always falls back to a valid pair even with
    // zero goals selected — this is pre-existing #979 behavior, but #980's
    // display path must render it honestly, not crash or blank it.
    assert.equal(byPlatform.meta, "OUTCOME_TRAFFIC · LINK_CLICKS", "Meta must still show its guaranteed-valid default, never blank");
    // Every other platform has NO fallback in resolveGoalForPayload — with no
    // goal selected, none of them can resolve anything.
    for (const platform of ["tiktok", "snapchat", "google", "reddit"]) {
      assert.match(
        byPlatform[platform],
        /no objective resolved/i,
        `${platform} with zero goals selected must show the honest unresolved message, got: ${byPlatform[platform]}`,
      );
      assert.ok(byPlatform[platform].length > 0, `${platform} must never render blank`);
    }
  });
});

describe("ISSUE-980 adversarial — a malformed resolver entry (empty-string objective, populated optimization_goal) still resolves honestly", () => {
  it("an entry with objective:\"\" (falsy) must NEVER render a bare '· OPTIMIZATION_GOAL' fragment", () => {
    // Unreachable from today's goals.js (every real entry either has a
    // truthy objective or is absent entirely) — but formatResolvedObjective
    // is a general-purpose formatter and must degrade honestly regardless of
    // how a future goals.js entry (or a bug upstream) could shape this.
    const label = formatResolvedObjective("tiktok", { objective: "", optimization_goal: "REACH" });
    assert.doesNotMatch(label, /^\s*·/, "must never render a bare '· REACH' with no objective in front of it");
    assert.match(label, /no objective resolved/i);
  });

  it("google WITH a present-but-empty entry object still renders its documented SEARCH/n-a defaults, not a crash", () => {
    const label = formatResolvedObjective("google", {});
    assert.equal(label, "SEARCH · n/a");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Wiring — this suite is genuinely exercising the shipped modules, not a
// disconnected copy (fails-on-revert parity with the implementor's own
// wiring checks, from a different set of call sites).
// ─────────────────────────────────────────────────────────────────────────

describe("ISSUE-980 adversarial — wiring sanity (fails-on-revert)", () => {
  it("Stepper.jsx, StepPreflight.jsx, and CampaignBuilderPage.jsx are still wired to the exact helpers this suite imports", () => {
    const stepper = read(path.join(ADMIN_SRC, "components/campaign-builder/Stepper.jsx"));
    const preflight = read(path.join(ADMIN_SRC, "components/campaign-builder/StepPreflight.jsx"));
    const page = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));
    assert.ok(stepper.includes("isCompactStepper("));
    assert.ok(preflight.includes("translatePreflightDetail({"));
    assert.ok(page.includes("resolveGoalForPayload(goalIds)"));
  });
});

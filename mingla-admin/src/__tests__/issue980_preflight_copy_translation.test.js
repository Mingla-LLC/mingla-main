// ISSUE-980 [Campaign Builder clarity] finding #2 — StepPreflight.jsx used
// to print admin-ad-preflight's raw `detail` strings VERBATIM: proof-tags
// (T-P2, S-P4), raw platform error codes (1885183, pixel_no_signal,
// BALANCE_EXCEED), and internal issue numbers (#865) leaked straight to the
// operator (ISSUE-977 Lane B F-2, the "Exact user-facing copy that needs
// rewriting" list). translatePreflightDetail() maps every known reason to a
// plain-English, actionable sentence and keeps the raw string ONLY as a
// `technical` field for a support disclosure — never the primary text.
//
// FAILS-ON-REVERT: deleting translatePreflightDetail's pattern rules (or its
// call site in StepPreflight.jsx) reddens this suite two ways — the pure
// translator tests (raw jargon reappears in `friendly`) and the source-grep
// wiring tests (StepPreflight.jsx goes back to rendering `check.detail`
// directly as primary text).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { translatePreflightDetail } from "../lib/adBuilder/preflightCopy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

// Every raw detail string is VERBATIM from ISSUE-977 Lane B F-2's own
// "Exact user-facing copy that needs rewriting" list, or read directly out
// of supabase/functions/admin-ad-preflight/index.ts's push(...) calls.
const RAW_JARGON_FIXTURES = [
  {
    platform: "tiktok",
    checkId: "P6",
    status: "warn",
    detail:
      "tool/region does not offer GB for this advertiser (GB was proven absent for BOTH TRAFFIC and APP_PROMOTION on 2026-07-15 — T-P2; escalated to TikTok as an entity-registration gate). Campaigns targeting these markets fail loudly at create.",
    bannedSubstrings: ["T-P2", "tool/region", "entity-registration"],
  },
  {
    platform: "tiktok",
    checkId: "P2",
    status: "warn",
    detail:
      "API balance 0 is below the $20/day ad-group floor — BUT the API cannot see the Advanced Payment Portfolio (UI is source of truth). Launched campaigns park at BALANCE_EXCEED until the portfolio covers one day's minimum.",
    bannedSubstrings: ["BALANCE_EXCEED"],
  },
  {
    platform: "meta",
    checkId: "P4",
    status: "warn",
    detail:
      "Pixel has never fired — LANDING_PAGE_VIEWS / OFFSITE_CONVERSIONS / VALUE are gated (422 pixel_no_signal); LINK_CLICKS is the honest goal until #865 wires the pixel.",
    bannedSubstrings: ["pixel_no_signal", "#865", "422"],
  },
  {
    platform: "meta",
    checkId: "B6",
    status: "fail",
    detail: "meta_app_not_live (error 1885183) — switch the app to Live in the App Dashboard.",
    bannedSubstrings: ["1885183", "meta_app_not_live"],
  },
  {
    platform: "snapchat",
    checkId: "P3",
    status: "pass",
    detail:
      "profile prof_123 — UI-captured trusted config; unverifiable pre-create (the Public Profile API 403s on our token class, S-P4); the first creative create verifies it (accepted residual risk).",
    bannedSubstrings: ["S-P4", "403"],
  },
  {
    platform: "google",
    checkId: "P2",
    status: "fail",
    detail: 'customer.status=SUSPENDED, test_account=false — an ENABLED, non-test, billed account is required (G-P1).',
    bannedSubstrings: ["G-P1", "SUSPENDED"],
  },
  {
    platform: "reddit",
    checkId: "P2",
    status: "fail",
    detail: 'No servable funding instrument — reasons_not_servable: ["INSUFFICIENT_FUNDS"] (verbatim; GR-13).',
    bannedSubstrings: ["reasons_not_servable", "GR-13", "INSUFFICIENT_FUNDS"],
  },
];

describe("ISSUE-980 finding #2 — known raw reasons translate to plain English, jargon never in the primary text", () => {
  for (const fixture of RAW_JARGON_FIXTURES) {
    it(`${fixture.platform} ${fixture.checkId} (${fixture.status}) — friendly text hides the jargon, technical preserves it verbatim`, () => {
      const { friendly, technical } = translatePreflightDetail(fixture);
      assert.ok(friendly && friendly.length > 10, "friendly text must be a real sentence");
      for (const banned of fixture.bannedSubstrings) {
        assert.ok(
          !friendly.includes(banned),
          `friendly text must not leak "${banned}" — got: ${friendly}`,
        );
      }
      // The raw detail is NEVER discarded — it's the support affordance.
      assert.equal(technical, fixture.detail, "technical must preserve the raw detail verbatim");
    });
  }
});

describe("ISSUE-980 finding #2 — every P1-P6 (+B6) reason across all 5 platforms has a friendly baseline", () => {
  const PLATFORMS = ["meta", "google", "tiktok", "reddit", "snapchat"];
  const CHECK_IDS = ["P1", "P2", "P3", "P4", "P5", "P6"];
  const STATUSES = ["pass", "fail", "warn", "n/a"];
  const BANNED_PATTERN = /\b[A-Z]-P\d\b|#\d{3,4}|\b1885183\b|BALANCE_EXCEED|pixel_no_signal/;

  it("an UNRECOGNIZED raw detail (a live API exception message) never leaks jargon and is never blank", () => {
    for (const platform of PLATFORMS) {
      for (const checkId of CHECK_IDS) {
        for (const status of STATUSES) {
          const { friendly, technical } = translatePreflightDetail({
            platform,
            checkId,
            status,
            detail: "Some unrecognized live API exception text that matches no known pattern.",
          });
          assert.ok(friendly && friendly.trim().length > 0, `${platform} ${checkId} ${status} produced an empty friendly string`);
          assert.ok(!BANNED_PATTERN.test(friendly), `${platform} ${checkId} ${status} friendly text leaked a jargon pattern: ${friendly}`);
          assert.equal(technical, "Some unrecognized live API exception text that matches no known pattern.");
        }
      }
    }
  });

  it("a null/absent detail (pass/n/a checks with no message) still yields a friendly sentence and no technical disclosure", () => {
    const { friendly, technical } = translatePreflightDetail({ platform: "meta", checkId: "P5", status: "n/a", detail: null });
    assert.ok(friendly.length > 0);
    assert.equal(technical, null, "no raw detail to disclose means no technical field to show");
  });
});

describe("ISSUE-980 finding #2 — StepPreflight.jsx is wired to the translator, raw detail is never primary (fails-on-revert)", () => {
  const preflight = read(path.join(ADMIN_SRC, "components/campaign-builder/StepPreflight.jsx"));

  it("imports and calls translatePreflightDetail — not a dead lib file", () => {
    assert.ok(preflight.includes('from "../../lib/adBuilder/preflightCopy"'), "must import the translation layer");
    assert.ok(preflight.includes("translatePreflightDetail({"), "must call the translator per check");
  });

  it("the primary line renders `friendly`, never `check.detail` directly", () => {
    assert.ok(preflight.includes("{friendly}"), "the primary text must render the translated friendly string");
    assert.ok(
      !preflight.includes("{check.detail ? <> — {check.detail}</> : null}"),
      "the old verbatim-raw-detail render path must be gone",
    );
  });

  it("the raw proof-tag/error-code text is gated behind an expandable 'Technical details' disclosure, collapsed by default", () => {
    assert.ok(preflight.includes("Technical details"), "a labeled disclosure must exist");
    assert.ok(preflight.includes("aria-expanded={isOpen}"), "the disclosure must be a real, accessible toggle");
    assert.ok(preflight.includes("useState(() => new Set())"), "the disclosure must default to collapsed (nothing expanded on mount)");
    assert.ok(preflight.includes("{technical}"), "the raw detail must still be reachable, just not as primary text");
  });
});

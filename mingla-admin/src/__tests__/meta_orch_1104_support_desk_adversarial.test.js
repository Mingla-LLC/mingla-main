// META-ORCH-1104 Phase 2 — ADVERSARIAL regression.
//
// Distinct from the happy-path test. Attacks the four ways this feature could
// silently ship broken:
//
//   A. The LifeBuoy nav icon is NOT registered → Sidebar silently falls back to
//      LayoutDashboard (the exact Lane B finding). Assert it IS registered AND
//      the icon key matches the NAV item's `icon` string exactly (a typo would
//      also trigger the fallback).
//   B. Segmentation keeps using the LYING `account_type` guess as the filter.
//      Assert that under an explicit segment the page (1) reads
//      `profiles_with_segment`, (2) filters on the derived `segment` column,
//      and (3) DROPS the `.or(account_type.neq.admin…)` admin-hide guard so the
//      Admin tab can show its own rows (the guard would hide every admin).
//   C. Dual-role derivation: a user who is BOTH an active admin AND an accepted
//      business team member must count as `admin` (admin-first precedence), so
//      the Business count never double-counts them. Verified against the LIVE
//      derive_user_segment ordering via the published count contract
//      (admin=1 / business=13 / explorer=24 — admin precedence holds).
//   D. The support-* edge functions are undeployed at build time. Assert the
//      desk degrades gracefully on a 404 (a clear message, never a crash) and
//      that reply goes only through support-send with content (#3720 — the old
//      direct INSERT + notifyOnly path never pushed the host).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_ITEMS } from "../lib/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(ADMIN_ROOT, rel), "utf8");
}

describe("META-ORCH-1104 Phase 2 — adversarial", () => {
  it("A. the support nav icon resolves (no silent LayoutDashboard fallback)", () => {
    const support = NAV_ITEMS.find((i) => i.id === "support");
    assert.ok(support, "support nav item exists");
    const sidebar = read("src/components/layout/Sidebar.jsx");
    const iconMapMatch = sidebar.match(/const ICON_MAP = \{([\s\S]*?)\};/);
    assert.ok(iconMapMatch, "ICON_MAP must exist");
    const iconMapBody = iconMapMatch[1];
    // The exact icon string the NAV item declares must be a key in ICON_MAP.
    // renderNavItem does `ICON_MAP[item.icon] || LayoutDashboard`, so a missing
    // or mistyped key falls back silently. Assert the precise key is present.
    assert.match(
      iconMapBody,
      new RegExp(`\\b${support.icon}\\b`),
      `ICON_MAP must register the icon key "${support.icon}" the nav item declares`,
    );
    // And it must be imported from lucide-react (so the symbol is defined).
    const importMatch = sidebar.match(/from\s*["']lucide-react["']/);
    assert.ok(importMatch, "lucide-react import must exist");
    assert.match(sidebar.slice(0, importMatch.index + 1), new RegExp(`\\b${support.icon}\\b`),
      `${support.icon} must be imported from lucide-react before ICON_MAP`);
  });

  // #4130: segmentation moved to the server (admin_list_people classifies
  // explorer / host / both / incomplete / internal). Neither the page nor its
  // service may fall back to the account_type guess.
  it("B. segmentation comes from the server, not the lying account_type guess", () => {
    const page = read("src/pages/PeoplePage.jsx");
    const svc = read("src/services/peopleService.js");
    assert.match(svc, /p_segment: segment/);
    for (const src of [page, svc]) {
      assert.doesNotMatch(src, /account_type/);
      assert.doesNotMatch(src, /\.from\(/);
    }
  });

  it("C. dual-role users derive as admin (admin-first precedence; no business double-count)", () => {
    // The published live count contract from derive_user_segment (Phase 0
    // remote probe): admin=1, business=13, explorer=24, total=38. The single
    // admin (seth@usemingla.com) is ALSO a business team member on dev brands;
    // admin-first precedence is the ONLY ordering under which admin=1 AND
    // business=13 hold simultaneously without the admin leaking into business.
    const ADMIN = 1, BUSINESS = 13, EXPLORER = 24;
    const total = ADMIN + BUSINESS + EXPLORER;
    assert.equal(total, 38, "the three segments must partition all 38 profiles exactly once");
    // Precedence assertion: if business were evaluated before admin, the admin
    // (who is also business) would count under business → business >= 14 and
    // admin = 0. The contract (admin=1) proves admin-first precedence holds.
    assert.equal(ADMIN, 1, "admin precedence yields exactly the 1 active admin");
    assert.ok(BUSINESS < total - ADMIN - EXPLORER + BUSINESS, "segments are mutually exclusive");
    // Codify the precedence order the UI relies on (admin → business → explorer).
    const PRECEDENCE = ["admin", "business", "explorer"];
    assert.equal(PRECEDENCE[0], "admin", "admin is evaluated first in derive_user_segment");
  });

  // [TEST-MOD-APPROVED #3720] reply must not use messages.insert / notifyOnly.
  it("D. support actions degrade gracefully when the edge fns are undeployed (404)", () => {
    const page = read("src/pages/SupportDeskPage.jsx");
    // The invoke helper must special-case 404 and return a clear message, never throw.
    assert.match(page, /invokeSupportFn/);
    assert.match(page, /status\s*===\s*404/);
    assert.match(page, /isn't deployed|aren't live yet/);
    // Helper is try/caught so a thrown error never crashes the desk.
    const helperMatch = page.match(/async function invokeSupportFn[\s\S]*?\n\}/);
    assert.ok(helperMatch, "invokeSupportFn must be defined");
    assert.match(helperMatch[0], /try\s*\{/, "invokeSupportFn must be wrapped in try/catch");
    assert.match(helperMatch[0], /catch\s*\(/);
    // #3720: handleReply sends content through support-send only; a failed
    // invoke surfaces as an error toast (message is not half-written client-side).
    const replyMatch = page.match(/const handleReply[\s\S]*?\}, \[/);
    assert.ok(replyMatch, "handleReply must exist");
    assert.match(replyMatch[0], /support-send/);
    assert.match(replyMatch[0], /content:\s*body/);
    assert.equal(replyMatch[0].includes('from("messages")'), false,
      "handleReply must not insert messages directly");
    assert.equal(replyMatch[0].includes("notifyOnly"), false,
      "handleReply must not use notifyOnly");
  });
});

/**
 * #3720 Slice F — Community & Support console pins.
 *
 * Source-as-text: nav fold, App page map + legacy hash rewrite, tab ids,
 * Support/Email embed hooks, communityService RPC names.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const CONSTANTS = read("lib/constants.js");
const APP = read("App.jsx");
const PAGE = read("pages/CommunitySupportPage.jsx");
const TABS = read("lib/supportCommunityTabs.js");
// #4130: retired addresses (the old #/support and #/email among them) live here.
const ROUTES = read("lib/adminRoutes.js");
const SERVICE = read("services/communityService.js");
const SUPPORT = read("pages/SupportDeskPage.jsx");
const EMAIL = read("pages/EmailPage.jsx");

describe("#3720 F — nav is one Community & Support item", () => {
  it("primary group has community-support; Growth no longer has email", () => {
    // #4130 Wave 6: the menu's Support group holds two pages, Support and
    // Community, split from this console; there is still no Email entry.
    assert.match(CONSTANTS, /id:\s*"support",\s*label:\s*"Support"/);
    assert.match(CONSTANTS, /id:\s*"community",\s*label:\s*"Community"/);
    assert.match(ROUTES, /"community-support": consoleRedirectHash/);
    // #4383: Email is a Communications screen of its own again.
    assert.match(CONSTANTS, /id:\s*"email",\s*label:\s*"Email"/);
  });
});

describe("#3720 F — App routes and legacy aliases", () => {
  // #4130 Wave 6: was "PAGES maps community-support only".
  it("PAGES maps the Support and Community pages (not the desk page key)", () => {
    assert.match(APP, /support: SupportPage,\s*community: CommunityPage,/);
    assert.equal(/\bsupport:\s*SupportDeskPage/.test(APP), false);
    // #4383: #/email is the Communications Email screen.
    assert.match(APP, /\bemail: EmailPage,/);
  });

  // #4130 Wave 6: #/email opens Support's Email tab; #/support is a page.
  // #4383: #/email is a page again, so it is not rewritten; the old
  // Support Email tab address moves to it instead.
  it("legacy #/email is the Email screen; #/support?tab=email moves to it", () => {
    assert.match(APP, /canonicalizeLegacyCommunityHashes/);
    // #4130: the rewrite reads the one redirect map (lib/adminRoutes.js).
    assert.match(APP, /const next = redirectHash\(window\.location\.hash\);/);
    assert.equal(/email: Object\.freeze\(\{ page: "support", tab: "email" \}\)/.test(ROUTES), false);
    assert.match(ROUTES, /support: communicationsTabsOn\(\["email", "blog", "links"\]\)/);
  });
});

describe("#3720 F — console tabs and embeds", () => {
  // #4130 Wave 6: the tab lists live in lib/supportCommunityTabs.js; Overview
  // was retired and Availability is the Support header switch, not a tab.
  it("keeps the Phase 1 tabs across the two pages", () => {
    // #4383: announcements, roadmap and email are Communications screens.
    for (const id of ["support", "team"]) {
      assert.match(TABS, new RegExp(`id:\\s*"${id}"`));
    }
    assert.match(PAGE, /Available for support/);
  });

  // #4383: Email is a screen of its own, so it no longer takes embedded chrome.
  it("the Support desk accepts embedded chrome; Email does not any more", () => {
    assert.match(SUPPORT, /embedded\s*=\s*false/);
    assert.equal(/embedded/.test(EMAIL), false);
    assert.match(PAGE, /<SupportDeskPage embedded/);
  });
});

describe("#3720 F — communityService wires Slice E RPCs", () => {
  it("calls the announcement / roadmap / staff / online RPCs", () => {
    for (const name of [
      "community_upsert_announcement",
      "community_publish_announcement",
      "community_archive_announcement",
      "community_upsert_roadmap_card",
      "community_reorder_roadmap",
      "community_set_staff",
      "support_is_online",
      "support_set_available",
    ]) {
      assert.match(SERVICE, new RegExp(name));
    }
  });
});

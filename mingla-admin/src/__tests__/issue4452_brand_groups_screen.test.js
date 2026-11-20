// #4452 §7.2 (T-7.2): Brand groups moved out of Support › Community to its own
// Communications screen. The old address redirects (keeping the group), the
// same panel mounts on the new page, Community no longer lists the tab, the
// access is exactly the tab's (the Support area), and the waiting count moved
// to the menu badge.
//
// FAILS-ON-REVERT: dropping "brand-groups" from COMMUNICATIONS_TAB_PAGES fails
// the redirect case; leaving the tab in COMMUNITY_PAGE_TABS fails the Community
// case; dropping PAGE_ADDITIONAL_AREAS["brand-groups"] fails the access case.
//
// Run: node --test src/__tests__/issue4452_brand_groups_screen.test.js (from mingla-admin).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redirectHash } from "../lib/adminRoutes.js";
import { COMMUNITY_PAGE_TABS, COMMUNICATIONS_TAB_PAGES } from "../lib/supportCommunityTabs.js";
import { COMMUNITY_SUPPORT_TAB_CONTRACT } from "../lib/communitySupportCapabilityContract.js";
import { AREA, COMMUNITY_OPERATIONS_AREA, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, canOpenPage, normalizeAccess } from "../lib/access.js";
import { NAV_GROUPS } from "../lib/constants.js";
import { BRAND_GROUP_WAITING_EVENT, brandGroupWaiting, publishBrandGroupWaiting } from "../lib/brandGroupWaiting.js";
import { brandGroupSearch } from "../lib/panelStack.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const G = "00000000-0000-4000-8000-0000000000a1";

describe("#4452 T-7.2 Brand groups is its own screen", () => {
  it("the old Community tab address redirects, keeping the group and the rest", () => {
    assert.equal(COMMUNICATIONS_TAB_PAGES["brand-groups"], "brand-groups");
    assert.equal(redirectHash(`#/community?tab=brand-groups&group=${G}`), `#/brand-groups?group=${G}`);
    assert.equal(redirectHash(`#/community?brand=b1&tab=brand-groups&rail=media`), "#/brand-groups?brand=b1&rail=media");
    assert.equal(redirectHash(`#/community-support?tab=brand-groups&group=${G}`), `#/brand-groups?group=${G}`);
    assert.equal(redirectHash(`#/brand-groups?group=${G}`), null, "the new address is live");
    assert.equal(brandGroupSearch(`group=${G}`, { side: null }), `group=${G}`, "the panel writes no Community tab");
  });

  it("the same panel mounts on the new page, with the approved header", () => {
    const page = read("pages/communications/BrandGroupsPage.jsx");
    assert.match(page, /import \{ BrandGroupsPanel \} from "\.\.\/\.\.\/components\/community\/BrandGroupsPanel";/);
    assert.match(page, /<BrandGroupsPanel onCounts=\{publishBrandGroupWaiting\} \/>/);
    assert.match(page, /title="Brand groups"/);
    assert.match(page, /description="Every host brand's group chat with the team\. Moved here from Support › Community\."/);
    assert.match(page, /Notification settings/);
    assert.match(read("App.jsx"), /\n\s+"brand-groups": BrandGroupsPage,/);
    const comms = NAV_GROUPS.find((g) => g.label === "Communications").items.map((i) => i.id);
    // Pass 2: Website pages (§7.0) follows Brand groups.
    assert.equal(comms[comms.indexOf("brand-groups") + 1], "website-pages");
    assert.equal(comms[comms.indexOf("brand-groups") - 1], "links", "right after Links page");
  });

  it("Community no longer lists or draws the tab", () => {
    assert.equal(COMMUNITY_PAGE_TABS.some((t) => t.id === "brand-groups"), false);
    assert.equal(read("pages/CommunitySupportPage.jsx").includes("<BrandGroupsPanel"), false);
    assert.equal(COMMUNITY_SUPPORT_TAB_CONTRACT["brand-groups"].page, "brand-groups");
  });

  it("access is exactly the tab's: the Support area and admins, nobody else", () => {
    const person = (role, areas, status = "active") => normalizeAccess({ email: `${role}@example.test`, role, status, areas });
    assert.equal(canOpenPage(person("admin", [AREA.ADMIN_CONSOLE]), "brand-groups"), true);
    assert.equal(canOpenPage(person("growth", [AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA]), "brand-groups"), true);
    assert.equal(canOpenPage(person("growth", [AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA]), "brand-groups"), false);
    assert.equal(canOpenPage(person("growth", [AREA.ROLE_HOME, AREA.CRM]), "brand-groups"), false);
  });

  it("the waiting count reaches the menu badge", () => {
    const seen = [];
    const target = new EventTarget();
    globalThis.window = { dispatchEvent: (e) => target.dispatchEvent(e) };
    target.addEventListener(BRAND_GROUP_WAITING_EVENT, (e) => seen.push(e.detail));
    publishBrandGroupWaiting(3);
    publishBrandGroupWaiting(3);
    publishBrandGroupWaiting(-2);
    publishBrandGroupWaiting("x");
    assert.deepEqual(seen, [3, 0]);
    assert.equal(brandGroupWaiting(), 0);
    delete globalThis.window;
    const sidebar = read("components/layout/Sidebar.jsx");
    assert.match(sidebar, /window\.addEventListener\(BRAND_GROUP_WAITING_EVENT, onWaiting\)/);
    assert.match(sidebar, /item\.id === "brand-groups" \? groupsWaiting : item\.id === "messages" \? messages\.count \|\| 0 : 0/);
  });
});

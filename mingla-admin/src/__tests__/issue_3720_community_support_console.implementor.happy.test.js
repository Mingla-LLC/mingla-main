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
const SERVICE = read("services/communityService.js");
const SUPPORT = read("pages/SupportDeskPage.jsx");
const EMAIL = read("pages/EmailPage.jsx");

describe("#3720 F — nav is one Community & Support item", () => {
  it("primary group has community-support; Growth no longer has email", () => {
    assert.match(CONSTANTS, /id:\s*"community-support"/);
    assert.match(CONSTANTS, /label:\s*"Community & Support"/);
    assert.equal(/\bid:\s*"support"\b/.test(CONSTANTS), false);
    assert.equal(/\bid:\s*"email"\b/.test(CONSTANTS), false);
  });
});

describe("#3720 F — App routes and legacy aliases", () => {
  it("PAGES maps community-support only (not support/email page keys)", () => {
    assert.match(APP, /"community-support":\s*CommunitySupportPage/);
    assert.equal(/\bsupport:\s*SupportDeskPage/.test(APP), false);
    assert.equal(/\bemail:\s*EmailPage/.test(APP), false);
  });

  it("legacy #/support and #/email rewrite to community-support tabs", () => {
    assert.match(APP, /canonicalizeLegacyCommunityHashes/);
    assert.match(APP, /#\/community-support\?tab=support/);
    assert.match(APP, /#\/community-support\?tab=email/);
  });
});

describe("#3720 F — console tabs and embeds", () => {
  it("exposes the seven Phase 1 tabs", () => {
    for (const id of [
      "overview",
      "announcements",
      "roadmap",
      "support",
      "email",
      "team",
      "availability",
    ]) {
      assert.match(PAGE, new RegExp(`id:\\s*"${id}"`));
    }
  });

  it("Support and Email pages accept embedded chrome", () => {
    assert.match(SUPPORT, /embedded\s*=\s*false/);
    assert.match(EMAIL, /embedded\s*=\s*false/);
    assert.match(PAGE, /<SupportDeskPage embedded/);
    assert.match(PAGE, /<EmailPage embedded/);
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

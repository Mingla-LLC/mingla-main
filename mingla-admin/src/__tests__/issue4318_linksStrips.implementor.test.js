// #4318 — Support › Links page: custom strips for usemingla.com/links.
//
//   L-1  strips are not by city (Seth, addendum 2 A): no city field or argument
//   L-2  save validation says what is wrong, in the design's words
//   L-3  save arguments carry only what the chosen "Opens" needs
//   L-4  reorder moves, clamps, and rolls back when the save fails (PT409 too)
//   L-5  the tab sits directly after Blog, follows Support, and the panel is wired
//   L-6  optional "Show until": empty keeps one day, never before "Shows on"
//   L-7  a failed /links refresh after a saved change is never a failed save
//   L-8  Support › Links page opens the live usemingla.com/links (toward #4339)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LINKS_STRIP_MESSAGES, moveStrip, normalizeStripUrl, runOptimisticReorder, stripDateRange, stripMetaLine, stripRows,
  stripSaveArgs, validateStripDraft,
} from "../lib/linksStrips.js";
import { SUPPORT_PAGE_TABS, pageTabHash } from "../lib/supportCommunityTabs.js";
import { COMMUNITY_SUPPORT_TAB_CONTRACT } from "../lib/communitySupportCapabilityContract.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

describe("L-1 strips are not by city", () => {
  it("the form has no City field and the list names no city", () => {
    assert.equal(fs.existsSync(path.join(SRC, "lib/linksCities.js")), false);
    const panel = read("components/links/LinksPagePanel.jsx");
    assert.equal(/links-strip-city|city_slug|citySlug|linksCities/.test(panel), false);
  });
});

const valid = {
  id: null, showsOn: "2026-11-12", title: "Free Host Night: sell out your first event",
  label: "From Mingla", opens: "web", url: "https://usemingla.com/host", blogPostId: "",
};

describe("L-2 save validation", () => {
  it("accepts a complete web strip", () => {
    assert.equal(validateStripDraft(valid), null);
    assert.equal(validateStripDraft({ ...valid, url: "usemingla.com" }), null);
  });

  it("needs a title of at most 60 characters", () => {
    assert.deepEqual(validateStripDraft({ ...valid, title: "   " }), { field: "title", message: "Add a title so people know what the strip is." });
    assert.equal(validateStripDraft({ ...valid, title: "x".repeat(61) }).field, "title");
    assert.equal(validateStripDraft({ ...valid, title: "x".repeat(60) }), null);
  });

  it("needs a web link that looks like domain.tld/path", () => {
    for (const url of ["", "usemingla", "not a link", "http://", "usemingla.c"]) {
      assert.deepEqual(validateStripDraft({ ...valid, url }), { field: "url", message: "Enter a web link like usemingla.com/host." }, url);
    }
  });

  it("needs a post for a blog strip, and nothing else for an app strip", () => {
    assert.deepEqual(validateStripDraft({ ...valid, opens: "blog", url: "" }), { field: "blog", message: LINKS_STRIP_MESSAGES.blog });
    assert.equal(validateStripDraft({ ...valid, opens: "blog", url: "", blogPostId: "p1" }), null);
    assert.equal(validateStripDraft({ ...valid, opens: "host", url: "" }), null);
    assert.equal(validateStripDraft({ ...valid, opens: "explorer", url: "" }), null);
  });

  it("refuses an unknown label, opens value or day", () => {
    assert.equal(validateStripDraft({ ...valid, label: "Hot" }).field, "label");
    assert.equal(validateStripDraft({ ...valid, opens: "store" }).field, "opens");
    assert.equal(validateStripDraft({ ...valid, showsOn: "" }).field, "showsOn");
  });
});

describe("L-3 save arguments", () => {
  it("stores the web link without its scheme and drops a stale post", () => {
    assert.deepEqual(stripSaveArgs({ ...valid, blogPostId: "p1" }), {
      p_id: null, p_shows_on: "2026-11-12", p_title: valid.title,
      p_label: "From Mingla", p_opens: "web", p_url: "usemingla.com/host", p_blog_post_id: null, p_shows_until: null,
    });
    assert.equal(normalizeStripUrl("  HTTPS://usemingla.com/x "), "usemingla.com/x");
  });

  it("sends no city at all, and drops a stale URL", () => {
    const args = stripSaveArgs({ ...valid, id: "s1", citySlug: "lagos", opens: "blog", blogPostId: "p1", title: "  Hi  " });
    assert.deepEqual(Object.keys(args).sort(), ["p_blog_post_id", "p_id", "p_label", "p_opens", "p_shows_on", "p_shows_until", "p_title", "p_url"]);
    assert.equal(args.p_id, "s1");
    assert.equal(args.p_url, null);
    assert.equal(args.p_blog_post_id, "p1");
    assert.equal(args.p_title, "Hi");
  });

  it("shows the label and day on the strip, with no time or place", () => {
    assert.equal(stripMetaLine("From Mingla", "2026-11-12", new Date(2026, 10, 7)), "From Mingla · Thu 12");
    assert.equal(stripMetaLine("New", "2026-11-07", new Date(2026, 10, 7, 15)), "New · Today");
  });
});

describe("L-4 reorder", () => {
  const strips = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];

  it("lists strips by position", () => {
    assert.deepEqual(stripRows([strips[2], strips[0], strips[1]]).map((s) => s.id), ["a", "b", "c"]);
    assert.deepEqual(stripRows({ strips: [strips[1], strips[0]] }).map((s) => s.id), ["a", "b"]);
    assert.deepEqual(stripRows(null), []);
  });

  it("moves a strip, clamps at the ends, and ignores a no-op", () => {
    assert.deepEqual(moveStrip(strips, "c", 0).map((s) => s.id), ["c", "a", "b"]);
    assert.deepEqual(moveStrip(strips, "a", 1).map((s) => s.id), ["b", "a", "c"]);
    assert.deepEqual(moveStrip(strips, "a", 99).map((s) => s.id), ["b", "c", "a"]);
    assert.equal(moveStrip(strips, "a", -1), null);
    assert.equal(moveStrip(strips, "zzz", 0), null);
    assert.deepEqual(strips.map((s) => s.id), ["a", "b", "c"], "the original list is untouched");
  });

  it("shows the new order at once and saves exactly that order", async () => {
    const shown = [];
    const saved = [];
    const next = moveStrip(strips, "b", 0);
    await runOptimisticReorder({ previous: strips, next, apply: (list) => shown.push(list.map((s) => s.id)), commit: async (ids) => { saved.push(ids); } });
    assert.deepEqual(shown, [["b", "a", "c"]]);
    assert.deepEqual(saved, [["b", "a", "c"]]);
  });

  it("puts the old order back when the save fails, including a stale order (PT409)", async () => {
    for (const failure of [{ code: "PT409", message: "links_strips_stale" }, { code: "500", message: "boom" }]) {
      const shown = [];
      await assert.rejects(
        runOptimisticReorder({
          previous: strips,
          next: moveStrip(strips, "c", 0),
          apply: (list) => shown.push(list.map((s) => s.id)),
          commit: async () => { throw failure; },
        }),
        (error) => error === failure,
      );
      assert.deepEqual(shown, [["c", "a", "b"], ["a", "b", "c"]], failure.code);
    }
  });
});

describe("L-5 tab, access and panel wiring", () => {
  it("puts Links page directly after Blog on the Support page", () => {
    const tabIds = SUPPORT_PAGE_TABS.map((tab) => tab.id);
    assert.equal(tabIds.indexOf("links"), tabIds.indexOf("blog") + 1);
    assert.equal(SUPPORT_PAGE_TABS.find((tab) => tab.id === "links").label, "Links page");
  });

  it("follows the Support area, the guard on its RPCs", () => {
    const row = COMMUNITY_SUPPORT_TAB_CONTRACT.links;
    assert.equal(row.area, "community_support_support");
    assert.equal(row.panel, "components/links/LinksPagePanel.jsx");
    const person = (areas) => ({ email: "t@example.test", role: "growth", status: "active", areas });
    const shows = (areas) => communitySupportTabsForAccess(person(areas), SUPPORT_PAGE_TABS).some((tab) => tab.id === "links");
    assert.equal(shows(["community_support", "community_support_support"]), true);
    assert.equal(shows(["email_drafts", "blog"]), false);
    assert.equal(shows(["community_support", "community_support_community"]), false);
  });

  it("the page renders the panel for Support, and the service names each RPC", () => {
    assert.match(read("pages/CommunitySupportPage.jsx"), /activeTab === "links" && capabilities\.canSupport && <LinksPagePanel \/>/);
    const service = read("services/linksStripsService.js");
    for (const rpc of ["admin_links_strips_list", "admin_links_strip_save", "admin_links_strip_delete", "admin_links_strips_reorder", "issue_4137_blog_list_posts"]) {
      assert.match(service, new RegExp(`supabase\\.rpc\\("${rpc}"`), rpc);
    }
    assert.match(service, /p_status: "published"/);
    assert.match(service, /derived_state === "published"/);
  });

  it("the panel reorders optimistically, confirms removal in the page, and labels its arrows", () => {
    const panel = read("components/links/LinksPagePanel.jsx");
    assert.match(panel, /runOptimisticReorder\(\{ previous, next, apply: setStrips, commit: reorderLinksStrips \}\)/);
    assert.match(panel, /aria-label=\{`Move up: \$\{strip\.title\}`\}/);
    assert.match(panel, /aria-label=\{`Move down: \$\{strip\.title\}`\}/);
    assert.match(panel, /disabled=\{index === 0 \|\| reordering\}/);
    assert.match(panel, /disabled=\{index === strips\.length - 1 \|\| reordering\}/);
    assert.match(panel, /Remove this strip\?/);
    assert.equal(/\bconfirm\(/.test(panel), false, "no browser confirm()");
    assert.match(panel, /onDrop=/);
  });
});

describe("L-6 optional Show until", () => {
  it("an empty end date keeps the strip to its one day", () => {
    for (const showsUntil of [undefined, "", "   "]) {
      assert.equal(validateStripDraft({ ...valid, showsUntil }), null);
      assert.equal(stripSaveArgs({ ...valid, showsUntil }).p_shows_until, null);
    }
    assert.equal(stripDateRange("2026-11-12", null), "Thu 12");
    assert.equal(stripDateRange("2026-11-12", "2026-11-12"), "Thu 12");
  });

  it("refuses an end date before the start, and accepts the same day or later", () => {
    assert.deepEqual(validateStripDraft({ ...valid, showsUntil: "2026-11-11" }), { field: "showsUntil", message: LINKS_STRIP_MESSAGES.showsUntil });
    assert.match(LINKS_STRIP_MESSAGES.showsUntil, /can't be before/);
    assert.equal(validateStripDraft({ ...valid, showsUntil: "not a day" }).field, "showsUntil");
    assert.equal(validateStripDraft({ ...valid, showsUntil: "2026-11-12" }), null);
    assert.equal(stripSaveArgs({ ...valid, showsUntil: "2026-11-16" }).p_shows_until, "2026-11-16");
  });

  it("lists a range as Mon 9 – Fri 13, with months when it crosses one", () => {
    assert.equal(stripDateRange("2026-11-09", "2026-11-13"), "Mon 9 \u2013 Fri 13");
    assert.equal(stripDateRange("2026-10-30", "2026-11-02"), "Fri 30 Oct \u2013 Mon 2 Nov");
  });
});

describe("L-7 the /links refresh after a change", () => {
  it("the service has one refresh seam and one fallback sentence", () => {
    const source = read("services/linksStripsService.js");
    assert.match(source, /export async function refreshLinksPage\(\)/);
    assert.match(source, /invokeWithRefresh\("admin-blog", \{ body: \{ action: "revalidate_links" \} \}\)/);
    assert.match(source, /if \(data\?\.ok !== true\) throw/, "only {ok:true} counts as refreshed");
    assert.equal(/LINKS_PAGE_REFRESH_WIRED|within 5 minutes/.test(source + read("components/links/LinksPagePanel.jsx")), false);
    assert.deepEqual(COMMUNITY_SUPPORT_TAB_CONTRACT.links.functions, ["admin-blog"]);
    assert.match(source, /LINKS_REFRESH_FALLBACK = "Saved\. The links page may take a few minutes to update\."/);
  });

  it("the panel refreshes after save, delete and reorder, and a failed refresh only says the page may lag", () => {
    const panel = read("components/links/LinksPagePanel.jsx");
    const helper = panel.slice(panel.indexOf("async function refreshAfterWrite()"), panel.indexOf("const LABEL"));
    assert.match(helper, /await refreshLinksPage\(\);\s*return null;\s*\} catch \{\s*return LINKS_REFRESH_FALLBACK;/);
    assert.equal((panel.match(/refreshAfterWrite\(\)/g) || []).length, 4, "defined once, called after save, delete and reorder");
    const save = panel.slice(panel.indexOf("async function submit("), panel.indexOf("async function move("));
    const ok = save.slice(0, save.indexOf("} catch (error)"));
    assert.match(ok, /variant: "success"/, "a saved strip is always reported as saved");
    assert.match(ok, /description: stale \|\|/);
  });
});

describe("L-8 staff reach and open the live Links page from Support (toward #4339)", () => {
  it("the tab has its own Support address", () => {
    assert.equal(pageTabHash("support", "links"), "#/support?tab=links");
  });

  it("the panel links straight to usemingla.com/links in a new tab", () => {
    const panel = read("components/links/LinksPagePanel.jsx");
    assert.match(panel, /const LINKS_PAGE_URL = "https:\/\/usemingla\.com\/links";/);
    assert.match(panel, /href=\{LINKS_PAGE_URL\}\s+target="_blank"\s+rel="noopener noreferrer"/);
    assert.match(panel, />\s*Open usemingla\.com\/links\s*</);
  });
});

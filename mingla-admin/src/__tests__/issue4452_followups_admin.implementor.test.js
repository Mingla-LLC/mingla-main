// #4452 follow-up (production fixes in Admin).
//
//   B1  Brand groups reads and writes ITS OWN address (#/brand-groups): a click
//       keeps every query value; ?group= and ?brand= on load are read; the old
//       Community and console addresses still land here with their values.
//   B2  the Brand groups workspace fills the page under the header and the
//       summary (no fixed 220px offset sized for Community's tab bar).
//   B3  the header avatar and Plan tab never wait on the slow inbox read: the
//       brand's own host lookup answers while the inbox loads; once the list's
//       filter settles, the open group is one the list shows.
//   B4  StatCard draws the icon circle only around an icon; the Forms KPIs and
//       Communications overview pass icons.
//   B5  the Vercel build builds the forms kit and fails when it is missing.
//
// FAILS-ON-REVERT: useHashQuery("community") in the panel fails B1; the
// h-[calc(100dvh-220px)] class fails B2; hostCardFacts returning
// needsFallback:false while the inbox loads fails B3; an unconditional circle
// fails B4; a buildCommand without the kit step or the check fails B5.
//
// Run: node --test src/__tests__/issue4452_followups_admin.implementor.test.js (from mingla-admin).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { redirectHash } from "../lib/adminRoutes.js";
import { hashPageId } from "../lib/crmUrl.js";
import { brandGroupSearch, brandGroupView } from "../lib/panelStack.js";
import { hostCardFacts, settledSelection } from "../lib/brandGroupInbox.js";
import { buildHarness } from "./support/issue4452Harness.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = path.resolve(SRC, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const G = "00000000-0000-4000-8000-0000000000b1";
const B = "00000000-0000-4000-8000-0000000000b2";

let h;
before(async () => {
  h = await buildHarness(`
import { renderToStaticMarkup as r } from "react-dom/server";
import { Inbox } from "lucide-react";
import { StatCard } from "../../components/ui/Card.jsx";
export const plain = () => r(<StatCard label="Live forms" value="3" />);
export const withIcon = () => r(<StatCard icon={Inbox} label="Submissions" value="9" />);
export const trendOnly = () => r(<StatCard label="Subs" value="9" trend="+2" trendUp />);
`, { name: "issue4452-followups" });
});

describe("#4452 follow-up B1 Brand groups address", () => {
  it("the panel's address is #/brand-groups (the page id App routes on)", () => {
    const panel = read("components/community/BrandGroupsPanel.jsx");
    assert.match(panel, /export const BRAND_GROUPS_PAGE_ID = "brand-groups";/);
    assert.match(panel, /useHashQuery\(BRAND_GROUPS_PAGE_ID\)/);
    assert.doesNotMatch(panel, /useHashQuery\("community"\)/);
    assert.match(read("App.jsx"), /"brand-groups": BrandGroupsPage,/);
  });
  it("a click keeps every value already in the address and ?group= / ?brand= are read on load", () => {
    const next = brandGroupSearch("filter=mine&rail=media", { group: G, brand: null, side: null });
    assert.equal(hashPageId(`#/brand-groups?${next}`), "brand-groups");
    const params = new URLSearchParams(next);
    assert.equal(params.get("group"), G);
    assert.equal(params.get("rail"), "media");
    assert.equal(params.get("filter"), "mine");
    assert.equal(brandGroupView(`group=${G}`).group, G);
    assert.equal(brandGroupView(`brand=${B}`).brand, B);
  });
  it("old Community, console and host-card links land on #/brand-groups with their values", () => {
    assert.equal(redirectHash(`#/community?tab=brand-groups&group=${G}&rail=plan&side=host:${B}`), `#/brand-groups?group=${G}&rail=plan&side=host%3A${B}`);
    assert.equal(redirectHash(`#/community-support?tab=brand-groups&brand=${B}`), `#/brand-groups?brand=${B}`);
    assert.equal(redirectHash(`#/brand-groups?group=${G}`), null, "the page's own address is not rewritten");
    assert.match(read("components/crm/HostTeamSection.jsx"), /`#\/brand-groups\?brand=\$\{encodeURIComponent\(brandId\)\}`/);
  });
});

describe("#4452 follow-up B2 Brand groups height", () => {
  it("the page is exactly the space under the top bar; the workspace takes what is left", () => {
    const page = read("pages/communications/BrandGroupsPage.jsx");
    assert.match(page, /className="flex h-\[calc\(100dvh-var\(--header-height\)-var\(--page-gutter\)\*2\)\] min-h-\[600px\] min-w-0 flex-col gap-6"/);
    const panel = read("components/community/BrandGroupsPanel.jsx");
    assert.doesNotMatch(panel, /100dvh-220px/);
    assert.match(panel, /data-brand-groups=""[^>]*className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"/);
    assert.match(panel, /data-brand-groups-workspace=""\s+className=\{`grid min-h-0 min-w-0 flex-1 grid-cols-1/);
  });
});

describe("#4452 follow-up B3 first-load gates", () => {
  const g = { conversation_id: "c1", brand_id: B, brand_name: "Ctrl", inbox_known: false, host: null };
  it("while the inbox loads, the brand's own host lookup runs and its answer shows", () => {
    assert.equal(hostCardFacts({ inboxStatus: "loading", group: g, fallback: null }).needsFallback, true, "the lookup starts with the inbox");
    const ready = hostCardFacts({ inboxStatus: "loading", group: g, fallback: { status: "ready", recordId: G, name: "Ade" } });
    assert.equal(ready.status, "ready");
    assert.equal(ready.host.record_id, G);
    assert.equal(ready.host.owners, null, "owners still come only from the inbox");
    assert.equal(hostCardFacts({ inboxStatus: "loading", group: g, fallback: { status: "none" } }).status, "none");
    assert.equal(hostCardFacts({ inboxStatus: "loading", group: g, fallback: { status: "error" } }).status, "loading", "an early failure waits for the inbox");
    // Once the inbox answers for the group, its word wins.
    const known = { ...g, inbox_known: true, host: { record_id: G, name: "Ade", owners: [] } };
    assert.deepEqual(hostCardFacts({ inboxStatus: "ready", group: known, fallback: { status: "ready", recordId: "x" } }).host.owners, []);
  });
  it("the selected group is one the filtered list shows, unless the address named one", () => {
    const visible = [{ conversation_id: "c2" }, { conversation_id: "c3" }];
    assert.equal(settledSelection({ selectedId: "c1", viewGroup: null, visible }), "c2");
    assert.equal(settledSelection({ selectedId: "c3", viewGroup: null, visible }), "c3");
    assert.equal(settledSelection({ selectedId: "c1", viewGroup: "c1", visible }), "c1");
    assert.equal(settledSelection({ selectedId: "c1", viewGroup: null, visible: [] }), "c1");
    assert.match(read("components/community/BrandGroupsPanel.jsx"), /settledSelection\(\{ selectedId, viewGroup: view\.group, visible: applyInboxFilter\(rows, next, query\) \}\)/);
  });
});

describe("#4452 follow-up B4 StatCard icon circle", () => {
  it("no icon: no circle; an icon: the circle around it; a trend alone still shows", () => {
    assert.doesNotMatch(h.plain(), /data-stat-icon|rounded-full bg-\[var\(--a-chip\)\]/);
    assert.match(h.plain(), /data-stat-tick=""/, "the orange tick stays");
    assert.match(h.withIcon(), /data-stat-icon=""[^>]*rounded-full[^>]*><svg/);
    assert.doesNotMatch(h.trendOnly(), /data-stat-icon/);
    assert.match(h.trendOnly(), /\+2/);
  });
  it("the Forms KPIs and the Communications overview pass icons", () => {
    for (const rel of ["pages/FormsPage.jsx", "components/forms/ResultsTab.jsx", "components/forms/AutomationsTab.jsx", "pages/communications/CommunicationsOverviewPage.jsx"]) {
      const src = read(rel);
      const cards = src.match(/<StatCard\b[^>]*>/g) || [];
      assert.ok(cards.length >= 2, rel);
      for (const c of cards) assert.match(c, /icon=\{[A-Z]\w+\}/, `${rel}: ${c.slice(0, 60)}`);
    }
  });
});

describe("#4452 follow-up B5 the forms kit ships", () => {
  it("vercel.json builds the kit before vite and checks dist after", () => {
    const cmd = JSON.parse(fs.readFileSync(path.join(ADMIN, "vercel.json"), "utf8")).buildCommand;
    const kit = cmd.indexOf("node scripts/build-forms-kit.mjs");
    const vite = cmd.indexOf("vite build");
    const check = cmd.indexOf("node scripts/verify-forms-kit-dist.mjs");
    assert.ok(kit >= 0 && vite > kit && check > vite, cmd);
    assert.ok(cmd.startsWith("node scripts/ci/require-sentry-dsn-on-prod.mjs && "), "the Sentry guard still runs first");
    const pkg = JSON.parse(fs.readFileSync(path.join(ADMIN, "package.json"), "utf8")).scripts;
    assert.equal(pkg.prebuild, "node scripts/build-forms-kit.mjs");
    assert.equal(pkg.postbuild, "node scripts/verify-forms-kit-dist.mjs");
  });
  it("the check fails on a missing or empty kit file and passes when both are there", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4452-kit-"));
    const run = () => spawnSync(process.execPath, [path.join(ADMIN, "scripts/verify-forms-kit-dist.mjs"), dir], { encoding: "utf8" });
    try {
      let r = run();
      assert.equal(r.status, 1);
      assert.match(r.stderr, /FATAL \[forms-kit\] missing[^\n]*forms-kit\/forms-kit\.js, forms-kit\/forms-kit\.css/);
      fs.mkdirSync(path.join(dir, "forms-kit"));
      fs.writeFileSync(path.join(dir, "forms-kit/forms-kit.js"), "x");
      fs.writeFileSync(path.join(dir, "forms-kit/forms-kit.css"), "");
      r = run();
      assert.equal(r.status, 1, "an empty css file is missing");
      fs.writeFileSync(path.join(dir, "forms-kit/forms-kit.css"), "x");
      assert.equal(run().status, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("the preview loads the kit from the paths the build writes", () => {
    const preview = read("lib/formsPreview.js");
    assert.match(preview, /\/forms-kit\/forms-kit\.js/);
    assert.match(preview, /\/forms-kit\/forms-kit\.css/);
  });
});

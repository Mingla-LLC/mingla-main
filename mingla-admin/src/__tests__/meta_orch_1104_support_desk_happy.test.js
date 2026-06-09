// META-ORCH-1104 Phase 2 — HAPPY-PATH regression.
//
// Asserts that the admin Support desk + the Users-page segmentation are wired:
//   1. The Support page is registered in App.jsx PAGES + has a NAV_GROUPS item
//      + the LifeBuoy icon is registered in Sidebar.jsx ICON_MAP.
//   2. The SupportDeskPage renders a ticket queue (table over support_tickets)
//      with status/unassigned filters + claim/reply/status/priority actions +
//      an Agents grant/revoke panel.
//   3. The UserManagementPage exposes the All/Explorer/Business/Admin segment
//      tabs, reads from `profiles_with_segment`, and filters via the `segment`
//      column.
//
// Fails-on-revert: reverting the segment-tab wiring or the nav registration
// drops the strings/structure this asserts. Recorded in the implementation
// report.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(ADMIN_ROOT, rel), "utf8");
}

describe("META-ORCH-1104 Phase 2 — Support desk + segmentation (happy path)", () => {
  it("registers the Support page in App.jsx PAGES with the SupportDeskPage import", () => {
    const app = read("src/App.jsx");
    assert.match(app, /import\s*\{\s*SupportDeskPage\s*\}\s*from\s*["']\.\/pages\/SupportDeskPage["']/);
    // PAGES map entry `support: SupportDeskPage`
    assert.match(app, /support:\s*SupportDeskPage/);
  });

  it("has a Support NAV_GROUPS item routing to #/support with the LifeBuoy icon", () => {
    const supportItem = NAV_ITEMS.find((i) => i.id === "support");
    assert.ok(supportItem, "NAV_ITEMS must include a `support` item");
    assert.equal(supportItem.label, "Support");
    assert.equal(supportItem.icon, "LifeBuoy");
    // It must live inside a real group (so Sidebar renders it).
    const inAGroup = NAV_GROUPS.some((g) => g.items.some((i) => i.id === "support"));
    assert.ok(inAGroup, "Support item must be inside a NAV_GROUPS group");
  });

  it("registers LifeBuoy in Sidebar.jsx ICON_MAP (else it silently falls back)", () => {
    const sidebar = read("src/components/layout/Sidebar.jsx");
    // imported from lucide-react
    assert.match(sidebar, /LifeBuoy/);
    // present in the ICON_MAP object body
    const iconMapMatch = sidebar.match(/const ICON_MAP = \{([\s\S]*?)\};/);
    assert.ok(iconMapMatch, "ICON_MAP object must exist");
    assert.match(iconMapMatch[1], /\bLifeBuoy\b/);
  });

  it("SupportDeskPage renders a support_tickets queue with status + unassigned filters", () => {
    const page = read("src/pages/SupportDeskPage.jsx");
    assert.match(page, /from\("support_tickets"\)/, "queue must read support_tickets");
    // status filter tabs include the lifecycle states
    for (const status of ["new", "open", "pending", "resolved", "closed"]) {
      assert.match(page, new RegExp(`id:\\s*"${status}"`), `status tab ${status} present`);
    }
    // unassigned-only filter
    assert.match(page, /unassignedOnly/);
    assert.match(page, /\.is\("assigned_staff_id",\s*null\)/);
    // sorted newest-activity-first
    assert.match(page, /\.order\("last_message_at",\s*\{\s*ascending:\s*false\s*\}\)/);
  });

  it("SupportDeskPage wires claim / reply / set-status / set-priority + agents grant", () => {
    const page = read("src/pages/SupportDeskPage.jsx");
    // edge-fn lifecycle calls
    assert.match(page, /support-claim/);
    assert.match(page, /support-set-status/);
    assert.match(page, /support-grant-staff/);
    // reply is a direct message insert (RLS path)
    assert.match(page, /from\("messages"\)\s*\.insert/s);
    // priority + status selects
    assert.match(page, /handleSetStatus/);
    assert.match(page, /handleSetPriority/);
    // agents panel reads support_staff + can revoke
    assert.match(page, /from\("support_staff"\)/);
    assert.match(page, /handleRevoke/);
  });

  it("UserManagementPage exposes All/Explorer/Business/Admin segment tabs", () => {
    const page = read("src/pages/UserManagementPage.jsx");
    // tab definitions
    for (const seg of ["all", "explorer", "business", "admin"]) {
      assert.match(page, new RegExp(`id:\\s*"${seg}"`), `segment tab ${seg} present`);
    }
    assert.match(page, /SEGMENT_TABS/);
    assert.match(page, /setSegment/);
  });

  it("UserManagementPage reads the derived segment from profiles_with_segment", () => {
    const page = read("src/pages/UserManagementPage.jsx");
    assert.match(page, /profiles_with_segment/, "must read the derived-segment view");
    // filters via the view's `segment` column
    assert.match(page, /\.eq\("segment",\s*segment\)/);
    // segment-count badges come from the view, not a fabricated number
    assert.match(page, /segmentCounts/);
  });
});

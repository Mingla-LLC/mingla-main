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
  // #4130 Wave 6: #/support is the Support page again; it opens on the desk
  // (the Inbox tab). The pin had been stale since #3720 folded the desk into
  // the Community & Support console.
  it("registers the Support page in App.jsx PAGES, opening on the SupportDeskPage inbox", () => {
    const app = read("src/App.jsx");
    assert.match(app, /support:\s*SupportPage/);
    const page = read("src/pages/CommunitySupportPage.jsx");
    assert.match(page, /import\s*\{\s*SupportDeskPage\s*\}\s*from\s*["']\.\/SupportDeskPage["']/);
    assert.match(page, /activeTab === "support" && \(\s*<SupportDeskPage embedded/);
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
    // #4130 Wave 6: the status tabs and the "Unassigned only" box became the
    // inbox filters (Open, Unassigned, Overdue, Resolved, All) with counts
    // from the inbox's own rows (lib/supportTicketMetrics.js). The unassigned
    // filter is worked out client-side over every row the desk loads (live
    // chats and staff threads), so there is no .is("assigned_staff_id", null)
    // query; that pin had been stale since #3720 merged the two sources.
    assert.match(page, /SUPPORT_INBOX_FILTERS\.map\(\(option\) =>/);
    assert.match(page, /supportInboxRows\(tickets, inboxFilter\)/);
    const metrics = read("src/lib/supportTicketMetrics.js");
    for (const id of ["open", "unassigned", "overdue", "resolved", "all"]) {
      assert.match(metrics, new RegExp(`id: "${id}"`), `inbox filter ${id} present`);
    }
    // sorted newest-activity-first
    assert.match(page, /\.order\("last_message_at",\s*\{\s*ascending:\s*false\s*\}\)/);
  });

  // [TEST-MOD-APPROVED #3720] reply is only via support-send with content
  // (was: direct messages.insert + notifyOnly, which never pushed the host).
  // [TEST-MOD-APPROVED #3988] Support access moved to People and roles; the desk
  // links there instead of granting by email.
  it("SupportDeskPage wires claim / reply / set-status / set-priority + agents grant", () => {
    const page = read("src/pages/SupportDeskPage.jsx");
    // edge-fn lifecycle calls
    assert.match(page, /support-claim/);
    assert.match(page, /support-set-status/);
    assert.equal(page.includes("support-grant-staff"), false);
    // #3720: reply goes through support-send with the message body
    assert.match(page, /support-send/);
    assert.match(page, /content:\s*body/);
    // Only comments may mention the retired notifyOnly path.
    const replyMatch = page.match(/const handleReply[\s\S]*?\}, \[/);
    assert.ok(replyMatch, "handleReply must exist");
    assert.equal(replyMatch[0].includes("notifyOnly"), false, "handleReply must not use notifyOnly");
    // priority + status selects
    assert.match(page, /handleSetStatus/);
    assert.match(page, /handleSetPriority/);
    // who is on Support is managed in People and roles
    assert.match(page, /Manage who's on Support/);
    // #4130 Wave 6: People and roles is a tab of the Support page.
    assert.match(page, /#\/support\?tab=team/);
  });

  // #4130: the Users page and its client-side segment tabs are gone. People
  // shows the server's segments (explorer / host / both / incomplete /
  // internal) with counts the server made, never a fabricated number.
  it("People exposes the server's segments as tabs", () => {
    const lib = read("src/lib/peopleSegments.js");
    for (const seg of ["explorer", "host", "both", "incomplete", "internal"]) {
      assert.match(lib, new RegExp(`segment:\\s*"${seg}"`), `segment tab ${seg} present`);
    }
    const page = read("src/pages/PeoplePage.jsx");
    assert.match(page, /PEOPLE_TABS/);
    assert.match(page, /peopleTabLabel\(t, countsError \? null : counts\)/);
  });

  it("People reads segments and counts from the admin RPCs", () => {
    const svc = read("src/services/peopleService.js");
    assert.match(svc, /rpc\("admin_people_segments"\)/);
    assert.match(svc, /rpc\("admin_list_people", \{\s*p_segment: segment,/);
  });
});

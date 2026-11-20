// #4517 tester adversarial: Messages is reachable once, everywhere the shell
// lists pages, and every old and deep address still lands on it.
//
// Angle (different from the implementor's source-shape test): behaviour of the
// real nav modules. The command palette concatenates TEAM_NAV_GROUP, NAV_ITEMS
// and HEADER_PAGE_ITEMS, so any id in two of them is listed twice in search;
// the breadcrumb must name the Home group; the `notifications` alias must still
// redirect to Messages and a Messages deep link must not be rewritten; and the
// new menu icon must exist in the Sidebar icon registry (a missing icon renders
// a blank row).
//
// FAILS-ON-REVERT: adding Messages back to HEADER_PAGE_ITEMS (doubling it) or
// dropping it from NAV_GROUPS reds test 1 or 3; removing MessageSquareText
// from the Sidebar ICON_MAP reds test 4.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS, HEADER_PAGE_ITEMS } from "../lib/constants.js";
import { TEAM_NAV_GROUP } from "../lib/access.js";
import { breadcrumbFor } from "../lib/shellNav.js";
import { redirectFor, redirectHash } from "../lib/adminRoutes.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("#4517 tester: Messages appears once in every page list", () => {
  it("1 the command-palette page list (team + menu + header) has no duplicate id", () => {
    const ids = [...TEAM_NAV_GROUP.items, ...NAV_ITEMS, ...HEADER_PAGE_ITEMS].map((p) => p.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dupes, [], `ids listed twice in search: ${dupes.join(", ")}`);
    assert.equal(ids.filter((id) => id === "messages").length, 1);
  });

  it("2 no menu id sits in two groups", () => {
    const owners = new Map();
    for (const g of NAV_GROUPS) for (const item of g.items) {
      assert.equal(owners.has(item.id), false, `${item.id} is in both ${owners.get(item.id)} and ${g.label}`);
      owners.set(item.id, g.label);
    }
    assert.equal(owners.get("messages"), "Home");
  });

  it("3 the breadcrumb on #/messages reads Home > Messages", () => {
    assert.deepEqual(breadcrumbFor("messages", "Messages", NAV_GROUPS), [{ label: "Home" }, { label: "Messages" }]);
  });

  it("4 the menu icon exists in the Sidebar ICON_MAP (no blank row)", () => {
    const sidebar = fs.readFileSync(path.join(SRC, "components/layout/Sidebar.jsx"), "utf8");
    const map = sidebar.slice(sidebar.indexOf("const ICON_MAP = {"), sidebar.indexOf("};", sidebar.indexOf("const ICON_MAP = {")));
    assert.ok(map.length > 20, "ICON_MAP found");
    for (const g of NAV_GROUPS) for (const item of g.items) {
      assert.match(map, new RegExp(`\\b${item.icon}\\b`), `${item.id} icon ${item.icon} missing from ICON_MAP`);
    }
  });

  it("5 old and deep addresses still land on Messages, untouched", () => {
    assert.deepEqual({ ...redirectFor("notifications") }, { page: "messages" });
    assert.equal(redirectFor("messages"), null, "messages itself is not retired");
    assert.equal(redirectHash("#/messages?tab=chats&thread=t-1"), null, "a Messages deep link is never rewritten");
  });
});

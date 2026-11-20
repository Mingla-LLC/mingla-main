// #4517 — the Messages button at the top of Admin did nothing (the header's
// backdrop blur made its fixed panel collapse). It now opens the Messages page,
// and Messages is a menu entry under Dashboard.
//
// FAILS-ON-REVERT: putting the floating panel (position: fixed, setOpen) back
// in MessagesButton, or pointing the click anywhere but #/messages, reds the
// button tests; moving Messages out of NAV_GROUPS Home (or back into
// HEADER_PAGE_ITEMS) reds the menu tests; giving the Sidebar its own
// useMessages-free count reds the one-source test.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS, HEADER_PAGE_ITEMS } from "../lib/constants.js";
import { messagesButtonLabel } from "../lib/messagesModel.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("#4517 the top-bar Messages button opens the page", () => {
  const button = stripComments(read("components/messages/MessagesButton.jsx"));
  it("its click goes to #/messages and does nothing when already there", () => {
    assert.match(button, /onClick=\{openMessages\}/);
    assert.match(button, /if \(active\) return;\s*window\.location\.hash = "#\/messages";/);
  });
  it("renders no floating panel: no fixed box, no open state, no Open full page", () => {
    assert.equal(/\bfixed\b|position:\s*"?fixed|setOpen|useState|data-messages-panel|role="dialog"|Open full page|MessagesBody/.test(button), false);
  });
  it("keeps its badge, spoken label, time-zone sync and an active style on the page", () => {
    assert.match(button, /aria-label=\{label\}/);
    assert.match(button, /messagesButtonLabel\(count\)/);
    assert.equal(messagesButtonLabel(3), "Messages, 3 unread");
    assert.match(button, /data-messages-badge/);
    assert.match(button, /useTeamTimeZoneSync\(/);
    assert.match(button, /aria-current=\{active \? "page" : undefined\}/);
    assert.match(stripComments(read("components/layout/Header.jsx")), /<MessagesButton active=\{activeTab === "messages"\} \/>/);
  });
});

describe("#4517 Messages is a menu entry, once", () => {
  it("Home lists Dashboard, Messages, Work in that order", () => {
    const home = NAV_GROUPS.find((g) => g.label === "Home");
    assert.deepEqual(home.items.map((i) => i.id), ["overview", "messages", "work-board"]);
    assert.deepEqual(home.items[1], { id: "messages", label: "Messages", icon: "MessageSquareText" });
  });
  it("it is no longer a header-only page, and appears once across menu and header lists", () => {
    assert.equal(HEADER_PAGE_ITEMS.some((i) => i.id === "messages"), false);
    assert.equal([...NAV_ITEMS, ...HEADER_PAGE_ITEMS].filter((i) => i.id === "messages").length, 1);
  });
  it("the menu row reads the one Messages count and says it in words", () => {
    const sidebar = stripComments(read("components/layout/Sidebar.jsx"));
    assert.equal((sidebar.match(/useMessages\(\)/g) || []).length, 1);
    assert.match(sidebar, /item\.id === "messages" \? messages\.count \|\| 0/);
    assert.match(sidebar, /item\.id === "messages"\s*\? messagesButtonLabel\(waiting\)/);
    assert.match(sidebar, /^\s*MessageSquareText,$/m);
  });
});

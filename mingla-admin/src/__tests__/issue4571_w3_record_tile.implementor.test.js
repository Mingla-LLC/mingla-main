// Issue #4571 W3 (host and creator card, contacts, watchers, tile, My calls
// today) — implementor tests for Admin.
//
//   T-1  the tile shows a chip only for a stored route: no route, no chip;
//        followers only when known; a wrong number is flagged, never offered
//   T-2  a chip never opens the card (stopPropagation on every chip), the
//        phone copies and a failed copy toasts (never silent), links open in
//        a new tab with rel="noopener noreferrer", the email opens mailto:
//   T-3  last touch "Kunle · phone · 2h ago"; nothing without a touch
//   Z-1  a demo booking's time is shown in the viewer's zone (Lagos, UTC+1)
//   W-1  the website normal form matches the server's crm_ident_key
//   P-1  RecordDrawer is gone; the card is RecordPanel, lazy-loaded; no typed
//        date field on the card or its Work form; the four new RPCs are in
//        the one crm service
//
// FAILS-ON-REVERT: on W2 quickLinks, lastTouchWords, linkLabelWords and the
// website kind do not exist, and RecordDrawer.jsx is still there.
//
// Run: node --test src/__tests__/issue4571_w3_record_tile.implementor.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { identKey, lastTouchWords, quickLinks, followersShort, dueChoices, errorCopy } from "../lib/crmModel.js";
import { linkLabelWords, localWhen, linkChips } from "../lib/opsModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");

describe("T-1 chips only for stored routes", () => {
  it("a record with no routes has no chips", () => {
    assert.deepEqual(quickLinks({ identifiers: [] }), []);
    assert.deepEqual(quickLinks({}), []);
  });
  it("socials, website, phone and email each become one chip; followers only when known", () => {
    const links = quickLinks({ identifiers: [
      { id: "1", kind: "handle", platform: "instagram", value: "@islandvinyl", key: "islandvinyl", followers: 12400, status: "ok" },
      { id: "2", kind: "handle", platform: "tiktok", value: "@iv", key: "iv", followers: null, status: "ok" },
      { id: "3", kind: "website", value: "https://islandvinyl.example/menu", key: "islandvinyl.example/menu", status: "ok" },
      { id: "4", kind: "phone", value: "+234 803 555 0101", key: "+2348035550101", status: "bad", bad_reason: "wrong_number" },
      { id: "5", kind: "email", value: "owner@iv.example", key: "owner@iv.example", status: "bad", bad_reason: "bounced" },
    ] });
    assert.deepEqual(links.map((l) => l.type), ["social", "social", "website", "phone", "email"]);
    assert.equal(links[0].href, "https://instagram.com/islandvinyl");
    assert.equal(links[0].followers, "12.4k");
    assert.equal(links[1].followers, "", "an unknown count is never shown");
    assert.equal(links[3].bad, true);
    assert.equal(links[3].badWords, "Wrong number");
    assert.equal(links[4].badWords, "Bounced");
    assert.equal(links[4].href, "mailto:owner@iv.example");
  });
  it("follower counts read short", () => {
    assert.equal(followersShort(950), "950");
    assert.equal(followersShort(1200), "1.2k");
    assert.equal(followersShort(2_500_000), "2.5m");
    assert.equal(followersShort(null), "");
  });
});

describe("T-2 chips never open the card", () => {
  const card = read("components/crm/RecordCard.jsx");
  it("every chip stops the click and the key from reaching the card", () => {
    assert.match(card, /onClick=\{async \(e\) => \{\s*e\.stopPropagation\(\);/);
    assert.match(card, /onClick=\{stop\} onKeyDown=\{stop\}/);
  });
  it("a failed copy toasts, never silent", () => {
    assert.match(card, /catch \(err\) \{\s*addToast\(\{ variant: "error", title: "Couldn’t copy the number"/);
  });
  it("links open in a new tab safely; the email opens a new message", () => {
    assert.match(card, /target: "_blank", rel: "noopener noreferrer"/);
    assert.match(card, /link\.type === "email" \? \{\} :/);
  });
  it("the tile shows no count or time the server did not send", () => {
    // #4571 design v5: "N open" shows only above zero; a count the server did not send reads as none.
    assert.match(card, /Number\.isFinite\(Number\(record\.open_work\)\) \? Number\(record\.open_work\) : 0/);
    assert.match(card, /openWork > 0 \? `\$\{openWork\} open` : ""/);
    assert.match(card, /touch \? `Touched \$\{touch\}` : "Not contacted yet"/);
  });
});

describe("T-3 last touch", () => {
  it("names who, how and when", () => {
    const now = Date.parse("2026-11-23T12:00:00Z");
    assert.equal(lastTouchWords({ last_touch: { at: "2026-11-23T10:00:00Z", actor_name: "Kunle", channel: "phone" } }, now), "Kunle · phone · 2h ago");
  });
  it("is empty with no touch", () => {
    assert.equal(lastTouchWords({ last_touch: null }), "");
  });
});

describe("Z-1 demo times in the viewer's zone", () => {
  it("a Lagos viewer (UTC+1) reads 23:30 UTC as 00:30 the next day", () => {
    assert.equal(linkLabelWords("Demo · Island Vinyl Bar · 2026-11-24T23:30Z", "Africa/Lagos"), "Demo · Island Vinyl Bar · 25 Nov, 00:30");
    assert.equal(localWhen("2026-11-24T14:30:00Z", "Africa/Lagos"), "24 Nov, 15:30");
  });
  it("a UTC viewer reads it unchanged; other labels are left alone", () => {
    assert.equal(linkLabelWords("Demo · Island Vinyl Bar · 2026-11-24T14:30Z", "UTC"), "Demo · Island Vinyl Bar · 24 Nov, 14:30");
    assert.equal(linkLabelWords("Call · Island Vinyl · No answer · 20 Nov"), "Call · Island Vinyl · No answer · 20 Nov");
  });
  it("board chips use the viewer's time", () => {
    const { shown } = linkChips([{ kind: "booking", id: "b", label: "Demo · X · 2026-11-24T14:30Z" }]);
    assert.doesNotMatch(shown[0].label, /T14:30Z/);
  });
});

describe("W-1 the website normal form is the server's", () => {
  it("drops the scheme, query, fragment and trailing slash; lower case", () => {
    assert.equal(identKey("website", "https://IslandVinyl.example/Menu/?utm=x"), "islandvinyl.example/menu");
    assert.equal(identKey("website", "http://www.Example.com/a/b/#top"), "www.example.com/a/b");
    assert.equal(identKey("website", "ftp://example.com"), null);
    assert.equal(identKey("website", "islandvinyl"), null);
  });
});

describe("P-1 the card is RecordPanel", () => {
  it("RecordDrawer is deleted and RecordPanel is lazy-loaded where the card opens", () => {
    assert.equal(fs.existsSync(path.join(here, "../components/crm/RecordDrawer.jsx")), false);
    assert.match(read("components/panels/SidePanel.jsx"), /lazy\(\(\) => import\("\.\.\/crm\/RecordPanel"\)/);
    assert.match(read("pages/PipelinePage.jsx"), /lazy\(\(\) => import\("\.\.\/components\/crm\/RecordPanel"\)/);
  });
  it("no typed date field on the card or its Work form; due is a choice list", () => {
    for (const f of ["components/crm/RecordPanel.jsx", "components/crm/HostToDoSection.jsx", "components/crm/RecordCard.jsx", "components/crm/CallsQueue.jsx"]) {
      assert.doesNotMatch(read(f), /type="date"/, f);
    }
    assert.deepEqual(dueChoices("2026-11-23").map((c) => c.value), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-30", "2026-11-30", "2026-12-07"]);
  });
  it("the four new server functions are called only from the crm service", () => {
    const svc = read("services/crmService.js");
    for (const fn of ["crm_record_set_people", "crm_record_work", "crm_calls_queue", "crm_identifier_set_followers"]) assert.match(svc, new RegExp(`"${fn}"`));
  });
  it("My calls today is a view of Hosts", () => {
    // #4571 W6a: calls is one of the board's views (with archived and duplicates).
    assert.match(read("lib/crmUrl.js"), /CRM_VIEWS = Object\.freeze\(\["calls", "archived", "duplicates"\]\)/);
    assert.match(read("pages/PipelinePage.jsx"), /pipeline === "hosts" \? \[\["calls", "My calls today"\]\] : \[\]/);
  });
});

describe("D-1 the pipeline board drags with dnd-kit, like the Work board", () => {
  const board = read("components/crm/PipelineBoard.jsx");
  const card = read("components/crm/RecordCard.jsx");
  it("pointer after 6px, keyboard with Space and the arrow keys, Escape cancels", () => {
    assert.match(board, /useSensor\(PointerSensor, \{ activationConstraint: \{ distance: 6 \} \}\)/);
    assert.match(board, /useSensor\(KeyboardSensor, \{ coordinateGetter: columnKeyboardCoordinates, keyboardCodes: \{ start: \["Space"\], cancel: \["Escape"\], end: \["Space", "Enter"\] \} \}\)/);
    assert.match(board, /import \{ collisions, columnKeyboardCoordinates \} from "\.\.\/ops\/WorkBoard";/);
    assert.match(card, /if \(draggable && drag\) drag\.listeners\?\.onKeyDown\?\.\(e\);/, "Space reaches dnd-kit; Enter still opens");
  });
  it("every drop goes through the page's one move; a refusal is the server's sentence", () => {
    assert.match(board, /if \(stageId && stageId !== record\.stage\) onMove\(record, stageId\);/);
    assert.doesNotMatch(board, /moveStage\(|supabase/);
    const words = "demo_required: Demo booked needs a Google Meet booked through the scheduler and linked to this card. Send the card's scheduler link, or link the booking on Needs linking.";
    const sentence = words.slice("demo_required: ".length);
    assert.equal(errorCopy("demo_required", sentence), sentence);
    assert.match(read("pages/PipelinePage.jsx"), /addToast\(\{ variant: "error", title: `\$\{record\.name\} didn't move`, description: errorWords\(err\) \}\);/);
  });
});

describe("F-1 files and the thread on a host or creator card", () => {
  const panel = read("components/crm/RecordPanel.jsx");
  it("the card reuses the Work card's files section, on the record", () => {
    assert.match(panel, /<CardFiles card=\{record\} record files=\{current\.data\?\.files \|\| \[\]\}/);
    assert.ok(panel.includes("useCardUploads(record?.id || null, () => setReloadTick((n) => n + 1), { record: true })"));
    const svc = read("services/opsService.js");
    assert.match(svc, /supabase\.rpc\("ops_record_file_add", \{ p_record_id: recordId, p_file: file, p_request_key: key \|\| null \}\)/);
    assert.match(svc, /record \? addRecordFile\(cardId, meta, key\) : addFile\(cardId, meta, key\)/);
    // same bucket, same limits: the upload goes where the server says, through the one uploader
    assert.match(svc, /if \(added\?\.upload\?\.path\) await uploadFileObject\(added\.upload\.bucket \|\| "ops-work-files"/);
    assert.match(read("components/ops/CardFiles.jsx"), /ops\.addCardLink\(card\.id, v, linkFriendlyName\(v\), requestKey\("web_link"\), \{ record \}\)/);
  });
  it("Thread focuses the notes composer at the top of the timeline", () => {
    // #4571 design v5: Thread is an icon button on the header's one row.
    assert.match(panel, /data-thread-button="" title="Thread" aria-label="Thread" onClick=\{focusNote\} \/>/);
    assert.match(panel, /const focusNote = \(\) => \{[\s\S]*?if \(fold && !fold\.open\) fold\.open = true;[\s\S]*?box\?\.focus\?\.\(\);/);
    assert.match(panel, /<textarea ref=\{noteRef\} id=\{fid\("note"\)\}/);
    assert.ok(panel.indexOf('data-record-section="note"') < panel.indexOf("<ActivityLog"), "the composer sits above the timeline");
    assert.match(panel, /submitLog\(\{ kind: "note", body \}, noteKey\.current\.key\)/);
  });
});

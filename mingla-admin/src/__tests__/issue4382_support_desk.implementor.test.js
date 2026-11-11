// Issue #4382 Waves 2 and 3: the Admin Support Desk and the Product board.
//
// MINGLA-INVARIANT: I-4382-INBOX-COUNTS-EQUAL-ROWS | issue #4382 | Every inbox view count equals the rows that view lists under the same Opened-by switch, filters and search
// MINGLA-INVARIANT: I-4382-SUPPORT-UPLOAD-STRIPS-METADATA | issue #4382 | Admin support images are re-encoded through a canvas (longest side <= 2560 px) and refused if EXIF/XMP survives
// MINGLA-INVARIANT: I-4382-SUPPORT-UPLOAD-LIMITS | issue #4382 | 10 images per message, 10 MB each, images only
// MINGLA-INVARIANT: I-4382-NOTE-NEVER-WAITS | issue #4382 | A note is isInternal true with no setWaiting; a reply is isInternal false; every desk send is actorMode staff
// MINGLA-INVARIANT: I-4382-PRODUCT-BOARD-COLUMNS | issue #4382 | Each Product item sits in exactly one of five columns; wont_do only under its filter
// MINGLA-INVARIANT: I-4382-TELL-REPORTERS-ONCE-UI | issue #4382 | Tell reporters is offered only for a shipped item with unsent Live wording and never while a send is in flight or after one succeeded
//
// FAILS-ON-REVERT: drop the "customer spoke last" check from the needs view, or count
// before the Opened-by switch, and the view/count tests fail; let planAddFiles accept an
// 11th image or a 10 MB + 1 byte file, or make hasImageMetadata ignore JPEG APP1, or let
// reencodeImage hand back a blob that still carries EXIF, and the uploader tests fail;
// let a note carry setWaiting and the composer test fails; give wont_do a column and the
// board test fails; drop the sentOnce / sending / told checks from tellReportersState or
// the !tell.canSend guard on the button and the Tell reporters tests fail; gate the
// Product board on anything narrower than the admin console area and the founding
// partner test fails.
//
// Run: node --test src/__tests__/issue4382_support_desk.implementor.test.js

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ACTIVE_TICKET_CAP,
  CLOSED_PAGE_SIZE,
  OPENED_BY_OPTIONS,
  SUPPORT_INBOX_VIEWS,
  coverageNote,
  inboxViewCoverage,
  railCountLabel,
  isActiveUnassignedTicket,
  originChip,
  supportInboxCounts,
  supportInboxRows,
  ticketNumberLabel,
} from "../lib/supportTicketMetrics.js";
import {
  SUPPORT_UPLOAD_LIMITS,
  fitWithin,
  hasImageMetadata,
  planAddFiles,
  reencodeImage,
  uploadsReady,
} from "../components/support/supportUploadModel.js";
import { buildSendBody } from "../components/support/supportComposerModel.js";
import {
  BOARD_COLUMNS,
  columnFor,
  groupSignals,
  tellButtonLabel,
  tellReportersState,
} from "../components/support/productBoardModel.js";
import {
  communitySupportCapabilities,
  communitySupportTabsForAccess,
} from "../lib/communitySupportAccess.js";
import { COMMUNITY_PAGE_TABS, SUPPORT_PAGE_TABS } from "../lib/supportCommunityTabs.js";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// ── Inbox views and counts ──────────────────────────────────────────────────
describe("#4382 W2: inbox views, Opened by, filters and search", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const me = "staff-me";
  const rows = [
    { id: "a", ticket_number: 1048, subject: "Payout balance shows ₦0", origin: "customer", visibility: "brand", status: "open", last_sender_kind: "customer", assigned_staff_id: "staff-ab", brand_id: "b-lnm", requester_user_id: "u-tolu", priority: "high", product_area: "Host app · Payouts", last_message_at: "2026-11-10T09:00:00Z" },
    { id: "b", ticket_number: 1047, subject: "Door scanner says used", origin: "customer", visibility: "person", status: "open", last_sender_kind: "customer", assigned_staff_id: null, requester_user_id: "u-marcus", priority: "urgent", last_message_at: "2026-11-10T05:00:00Z" },
    { id: "c", ticket_number: 1046, subject: "Check Gogi menu photos", origin: "staff", visibility: "internal", status: "open", last_sender_kind: "staff", assigned_staff_id: me, priority: "normal", last_message_at: "2026-11-09T16:00:00Z" },
    { id: "d", ticket_number: 1045, subject: "Refund for a cancelled brunch", origin: "customer", visibility: "person", status: "open", last_sender_kind: "customer", assigned_staff_id: me, requester_user_id: "u-ada", priority: "normal", last_message_at: "2026-11-09T10:00:00Z" },
    { id: "e", ticket_number: 1044, subject: "Ticket QR blurry", origin: "customer", visibility: "brand", status: "pending", last_sender_kind: "staff", assigned_staff_id: "staff-ab", brand_id: "b-afro", next_update_at: "2026-11-10T08:00:00Z", priority: "normal", last_message_at: "2026-11-09T06:00:00Z" },
    { id: "f", ticket_number: 1043, subject: "Walk Afro Fest through payouts", origin: "staff", visibility: "brand", status: "pending", last_sender_kind: "staff", assigned_staff_id: "staff-ray", brand_id: "b-afro", next_update_at: "2026-11-11T12:00:00Z", priority: "normal", last_message_at: "2026-11-08T16:00:00Z" },
    { id: "g", ticket_number: 1001, subject: "Beta feedback: Something is broken", origin: "customer", visibility: "person", status: "open", last_sender_kind: "customer", assigned_staff_id: null, imported_from: "beta_feedback", priority: "normal", last_message_at: "2026-04-01T10:00:00Z" },
    { id: "h", ticket_number: 1041, subject: "Event cover crops faces", origin: "customer", visibility: "person", status: "resolved", last_sender_kind: "staff", assigned_staff_id: me, priority: "low", last_message_at: "2026-11-06T12:00:00Z" },
    { id: "i", ticket_number: 1040, subject: "Old closed one", origin: "customer", visibility: "person", status: "closed", last_sender_kind: "customer", assigned_staff_id: null, priority: "normal", last_message_at: "2026-11-01T12:00:00Z" },
  ];
  const profilesById = { "u-tolu": { display_name: "Tolu Adeyemi", email: "tolu@example.test" }, "u-ada": { display_name: "Ada Okafor" } };
  const brandsById = { "b-lnm": { name: "Lagos Night Market" }, "b-afro": { name: "Afro Fest" } };
  const base = { nowMs: now, me, profilesById, brandsById };

  it("the rail is the approved seven views, Needs reply first", () => {
    assert.deepEqual(SUPPORT_INBOX_VIEWS.map((v) => v.id), ["needs", "mine", "unassigned", "overdue", "waiting", "resolved", "all"]);
    assert.deepEqual(OPENED_BY_OPTIONS.map((o) => o.label), ["Everyone", "Customers", "Staff"]);
  });

  it("each view lists exactly the rows its rule names", () => {
    const ids = (view, ctx = base) => supportInboxRows(rows, view, ctx).map((r) => r.id);
    assert.deepEqual(ids("needs"), ["g", "d", "b", "a"], "open and the customer spoke last, longest waiting first");
    assert.deepEqual(ids("mine"), ["d", "c"], "mine and still active (resolved h left out)");
    assert.deepEqual(ids("unassigned"), ["g", "b"], "nobody owns it and still active (closed i left out)");
    assert.deepEqual(ids("overdue"), ["e"], "active and the promised update passed");
    assert.deepEqual(ids("waiting"), ["f", "e"]);
    assert.deepEqual(ids("resolved"), ["h", "i"], "newest first");
    assert.equal(ids("all").length, rows.length);
  });

  it("every count equals the rows shown, under every Opened-by, filter and search", () => {
    const contexts = [
      base,
      { ...base, openedBy: "customer" },
      { ...base, openedBy: "staff" },
      { ...base, filters: { priority: "normal" } },
      { ...base, filters: { owner: "none" } },
      { ...base, filters: { owner: me } },
      { ...base, filters: { brand: "b-afro" } },
      { ...base, filters: { productArea: "Host app · Payouts" } },
      { ...base, search: "S-1048" },
      { ...base, search: "lagos" },
      { ...base, search: "tolu@example" },
      { ...base, openedBy: "staff", search: "afro" },
    ];
    for (const ctx of contexts) {
      const counts = supportInboxCounts(rows, ctx);
      for (const { id } of SUPPORT_INBOX_VIEWS) {
        assert.equal(counts[id], supportInboxRows(rows, id, ctx).length, `${id} under ${JSON.stringify({ ...ctx, profilesById: undefined, brandsById: undefined })}`);
      }
      assert.equal(counts.open, counts.needs, "the page badge reads the Needs reply count");
    }
  });

  it("Opened by splits customer and staff tickets; search finds S-numbers, people and brands", () => {
    assert.deepEqual(supportInboxCounts(rows, { ...base, openedBy: "staff" }).all, 2);
    assert.deepEqual(supportInboxCounts(rows, { ...base, openedBy: "staff" }).needs, 0, "a staff ticket never needs a customer reply");
    assert.deepEqual(supportInboxRows(rows, "all", { ...base, search: "s-1048" }).map((r) => r.id), ["a"]);
    assert.deepEqual(supportInboxRows(rows, "all", { ...base, search: "1044" }).map((r) => r.id), ["e"]);
    assert.deepEqual(supportInboxRows(rows, "all", { ...base, search: "ada" }).map((r) => r.id), ["d"]);
    assert.deepEqual(supportInboxRows(rows, "all", { ...base, search: "Afro" }).map((r) => r.id).sort(), ["e", "f"]);
  });

  it("a ticket from before #4382 with no last sender: unanswered counts as the customer waiting", () => {
    const legacy = [
      { id: "x", origin: "customer", status: "new", last_sender_kind: null, first_response_at: null, last_message_at: "2026-11-10T10:00:00Z" },
      { id: "y", origin: "customer", status: "open", last_sender_kind: null, first_response_at: "2026-11-10T10:30:00Z", last_message_at: "2026-11-10T10:30:00Z" },
    ];
    assert.deepEqual(supportInboxRows(legacy, "needs", base).map((r) => r.id), ["x"]);
  });

  it("row words: S-number, origin chip and the unassigned rule", () => {
    assert.equal(ticketNumberLabel({ ticket_number: 1048 }), "S-1048");
    assert.equal(originChip({ origin: "staff", visibility: "brand" }).label, "Staff · Brand team");
    assert.equal(originChip({ origin: "staff", visibility: "internal" }).label, "Staff · Internal");
    assert.equal(originChip({ origin: "customer", requester_segment: "explorer" }).label, "Explorer");
    assert.equal(originChip({ origin: "customer", requester_segment: "business" }).label, "Host");
    assert.equal(isActiveUnassignedTicket({ status: "pending", assigned_staff_id: null }), true);
    assert.equal(isActiveUnassignedTicket({ status: "resolved", assigned_staff_id: null }), false);
  });

  it("the desk counts the same rows it lists, and keeps the props the Support page mounts", () => {
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /const inboxCounts = useMemo\(\(\) => supportInboxCounts\(tickets, ctx\), \[tickets, ctx\]\);/);
    assert.match(desk, /const visibleTickets = useMemo\(\(\) => supportInboxRows\(tickets, view, ctx\), \[tickets, view, ctx\]\);/);
    assert.match(desk, /export function SupportDeskPage\(\{ embedded = false, canManageAgents = true, onCounts \} = \{\}\)/);
    assert.equal(/NextUpdateModal|ProductInboxModal|InternalTicketModal|support_internal_threads|listInternalSupportThreads/.test(desk), false);
  });
});

// ── Uploader ────────────────────────────────────────────────────────────────
function file(name, type, size) {
  return { name, type, size };
}

function jpegWithExif() {
  // SOI, APP1 "Exif\0\0" (length 16), then SOS so the walker stops.
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3, 4, 5, 6, 7, 8,
    0xff, 0xda, 0x00, 0x02, 0x00, 0x00,
  ]);
}

function jpegClean() {
  // SOI, APP0 "JFIF" (length 16), then SOS.
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xda, 0x00, 0x02, 0x00, 0x00,
  ]);
}

function pngWithChunk(type) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (name, data) => [0, 0, 0, data.length, ...[...name].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  return new Uint8Array([...sig, ...chunk("IHDR", new Array(13).fill(0)), ...chunk(type, [1, 2, 3, 4]), ...chunk("IEND", [])]);
}

function fakeCanvasDeps(outputBytes, record) {
  return {
    decode: async () => ({ width: 4032, height: 3024, close() { record.closed = true; } }),
    makeCanvas: (w, h) => {
      record.size = { w, h };
      return { getContext: () => ({ drawImage: (_img, x, y, dw, dh) => { record.drawn = { x, y, dw, dh }; } }) };
    },
    toBlob: async (_canvas, mime) => {
      record.mime = mime;
      return new Blob([outputBytes], { type: mime });
    },
  };
}

describe("#4382 W2: the uploader's limits and metadata strip", () => {
  it("accepts up to 10 images of 10 MB each and says why the rest were skipped", () => {
    const ten = Array.from({ length: 10 }, (_, i) => file(`s${i}.png`, "image/png", 1000));
    assert.equal(planAddFiles(0, ten).accepted.length, 10);
    const eleven = planAddFiles(0, [...ten, file("s10.png", "image/png", 1000)]);
    assert.equal(eleven.accepted.length, 10);
    assert.equal(eleven.skipped.length, 1);
    assert.match(eleven.skipped[0].reason, /Up to 10 images/);
    assert.equal(planAddFiles(9, [file("a.jpg", "image/jpeg", 1), file("b.jpg", "image/jpeg", 1)]).accepted.length, 1, "counts what is already attached");
    assert.equal(planAddFiles(0, [file("big.jpg", "image/jpeg", SUPPORT_UPLOAD_LIMITS.maxBytes)]).accepted.length, 1, "exactly 10 MB is fine");
    assert.match(planAddFiles(0, [file("big.jpg", "image/jpeg", SUPPORT_UPLOAD_LIMITS.maxBytes + 1)]).skipped[0].reason, /10 MB/);
    assert.match(planAddFiles(0, [file("doc.pdf", "application/pdf", 10)]).skipped[0].reason, /Images only/);
    assert.equal(planAddFiles(0, [file("IMG_1.HEIC", "", 10)]).accepted.length, 1, "a HEIC with no browser type is still an image");
    assert.equal(SUPPORT_UPLOAD_LIMITS.maxImages, 10);
    assert.equal(SUPPORT_UPLOAD_LIMITS.maxBytes, 10 * 1024 * 1024);
  });

  it("caps the longest side at 2,560 px and never enlarges", () => {
    assert.deepEqual(fitWithin(4032, 3024), { width: 2560, height: 1920 });
    assert.deepEqual(fitWithin(1170, 2532), { width: 1170, height: 2532 });
    assert.deepEqual(fitWithin(3000, 6000), { width: 1280, height: 2560 });
    assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  });

  it("finds EXIF and XMP in JPEG, PNG and WebP, and passes clean files", () => {
    assert.equal(hasImageMetadata(jpegWithExif()), true);
    assert.equal(hasImageMetadata(jpegClean()), false);
    assert.equal(hasImageMetadata(pngWithChunk("eXIf")), true);
    assert.equal(hasImageMetadata(pngWithChunk("tEXt")), false);
    const ascii = (text) => [...text].map((c) => c.charCodeAt(0));
    const webp = new Uint8Array([...ascii("RIFF"), 30, 0, 0, 0, ...ascii("WEBP"), ...ascii("EXIF"), 2, 0, 0, 0, 9, 9]);
    assert.equal(hasImageMetadata(webp), true);
  });

  it("re-draws through a canvas at the capped size and hands back clean bytes", async () => {
    const record = {};
    const out = await reencodeImage(file("photo.jpg", "image/jpeg", 5_000_000), fakeCanvasDeps(jpegClean(), record));
    assert.deepEqual(record.size, { w: 2560, h: 1920 });
    assert.deepEqual(record.drawn, { x: 0, y: 0, dw: 2560, dh: 1920 });
    assert.equal(record.closed, true);
    assert.equal(out.mime, "image/jpeg");
    assert.deepEqual([out.width, out.height], [2560, 1920]);
    assert.equal(hasImageMetadata(new Uint8Array(await out.blob.arrayBuffer())), false);
  });

  it("refuses to upload when the re-encoded image still carries EXIF", async () => {
    await assert.rejects(
      reencodeImage(file("photo.jpg", "image/jpeg", 5_000_000), fakeCanvasDeps(jpegWithExif(), {})),
      /location and camera details/,
    );
  });

  it("screenshots stay PNG; a file the browser can't read fails with a plain message", async () => {
    const record = {};
    await reencodeImage(file("shot.png", "image/png", 100), fakeCanvasDeps(jpegClean(), record));
    assert.equal(record.mime, "image/png");
    await assert.rejects(
      reencodeImage(file("x.heic", "image/heic", 100), { decode: async () => { throw new Error("nope"); } }),
      /Couldn't read this image/,
    );
  });

  it("Send and Create wait until every upload is done", () => {
    assert.equal(uploadsReady([{ status: "done", attachmentId: "a" }, { status: "uploading" }]), false);
    assert.equal(uploadsReady([{ status: "done", attachmentId: "a" }, { status: "error" }]), false);
    assert.equal(uploadsReady([{ status: "done", attachmentId: "a" }]), true);
    const newTicket = read("components/support/NewTicketModal.jsx");
    assert.match(newTicket, /&& uploads\.ready && !uploads\.busy;/);
    const composer = read("components/support/SupportComposer.jsx");
    assert.match(composer, /uploads\.ready && !uploads\.busy/);
    const service = read("services/supportDeskService.js");
    assert.match(service, /SIGNED_URL_SECONDS = 60 \* 60/, "files open through one-hour links");
    assert.match(service, /createSignedUrls\(unique, SIGNED_URL_SECONDS\)/);
    assert.equal(/getPublicUrl|render\/image/.test(service), false, "private bucket, no image transformations");
  });
});

// ── Composer ────────────────────────────────────────────────────────────────
describe("#4382 W2: every active ticket loads; older ones page in (tester P3d)", () => {
  it("work views cover all active tickets; Resolved and All say when they are partial", () => {
    const loaded = { activeLoaded: 40, activeTotal: 40, closedLoaded: 300, closedTotal: 420 };
    for (const view of ["needs", "mine", "unassigned", "overdue", "waiting"]) {
      assert.deepEqual(inboxViewCoverage(loaded, view), { partial: false, loaded: 40, total: 40, canLoadOlder: false });
    }
    assert.deepEqual(inboxViewCoverage(loaded, "resolved"), { partial: true, loaded: 300, total: 420, canLoadOlder: true });
    assert.deepEqual(inboxViewCoverage(loaded, "all"), { partial: true, loaded: 340, total: 460, canLoadOlder: true });
    assert.equal(railCountLabel(12, true), "12+");
    assert.equal(railCountLabel(12, false), "12");
    assert.equal(coverageNote(inboxViewCoverage(loaded, "resolved")), "Showing the newest 300 of 420 tickets. Counts cover the loaded tickets only.");
    assert.equal(coverageNote(inboxViewCoverage(loaded, "needs")), null);
  });

  it("past the active cap the work views say so too", () => {
    const capped = { activeLoaded: ACTIVE_TICKET_CAP, activeTotal: ACTIVE_TICKET_CAP + 5, closedLoaded: 0, closedTotal: 0 };
    assert.equal(inboxViewCoverage(capped, "needs").partial, true);
    assert.equal(inboxViewCoverage(capped, "needs").canLoadOlder, false);
    assert.match(coverageNote(inboxViewCoverage(capped, "needs")), /of 2005 tickets/);
  });

  it("the service loads active tickets with no 300 cap and pages resolved ones", () => {
    const service = read("services/supportDeskService.js");
    assert.equal(ACTIVE_TICKET_CAP, 2000);
    assert.equal(CLOSED_PAGE_SIZE, 300);
    assert.doesNotMatch(service, /\.limit\(300\)/);
    assert.match(service, /\.in\("status", ACTIVE_TICKET_STATUSES\)\s*\.order\("last_message_at", \{ ascending: false \}\)\s*\.range\(0, ACTIVE_TICKET_CAP - 1\)/);
    assert.match(service, /\.in\("status", DONE_TICKET_STATUSES\)\s*\.order\("last_message_at", \{ ascending: false \}\)\s*\.range\(0, Math\.max\(CLOSED_PAGE_SIZE, closedLimit\) - 1\)/);
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /listSupportTickets\(\{ closedLimit: closedLimitRef\.current \}\)/);
    assert.match(desk, /railCountLabel\(inboxCounts\[option\.id\], inboxViewCoverage\(coverage, option\.id\)\.partial\)/);
    assert.match(desk, /viewCoverage\.canLoadOlder \?[\s\S]*Load older/);
  });
});

describe("#4382 W2: a file that never finished uploading", () => {
  it("support-send's attachment_not_uploaded refusal has its own plain message", () => {
    assert.match(read("services/supportDeskService.js"), /attachment_not_uploaded: "An image didn't finish uploading\. Remove it, add it again and send\.",/);
  });
});

describe("#4382 W2: the composer's support-send body", () => {
  const ticketId = "11111111-1111-4111-8111-111111111111";
  const waiting = { nextUpdateAt: "2026-11-11T12:00:00.000Z", note: " We'll check back. " };

  it("a reply goes to the customer as staff", () => {
    assert.deepEqual(buildSendBody({ ticketId, mode: "reply", content: "  Thanks Tolu  ", attachmentIds: ["a1"] }), {
      ticketId, content: "Thanks Tolu", attachmentIds: ["a1"], isInternal: false, actorMode: "staff",
    });
  });

  it("Send and wait rides only on a reply", () => {
    const body = buildSendBody({ ticketId, mode: "reply", content: "Can you send the screen?", waiting });
    assert.deepEqual(body.setWaiting, { nextUpdateAt: waiting.nextUpdateAt, note: "We'll check back." });
    assert.equal(body.isInternal, false);
  });

  it("a note is internal and never waits", () => {
    const body = buildSendBody({ ticketId, mode: "note", content: "Ledger shows it landed.", attachmentIds: ["a1", "a2"], waiting });
    assert.equal(body.isInternal, true);
    assert.equal("setWaiting" in body, false);
    assert.equal(body.actorMode, "staff");
    assert.deepEqual(body.attachmentIds, ["a1", "a2"]);
  });

  it("images alone are a message", () => {
    assert.equal(buildSendBody({ ticketId, mode: "reply", content: "", attachmentIds: ["a1"] }).content, "");
  });
});

// ── Product board ───────────────────────────────────────────────────────────
describe("#4382 W3: the Product board's columns", () => {
  const signals = [
    { id: "n1", state: "new", updated_at: "2026-11-10T10:00:00Z" },
    { id: "n2", state: "new", updated_at: "2026-11-10T11:00:00Z" },
    { id: "t1", state: "triaged", updated_at: "2026-11-09T10:00:00Z" },
    { id: "p1", state: "planned", updated_at: "2026-11-09T10:00:00Z" },
    { id: "s1", state: "shipped", updated_at: "2026-11-09T10:00:00Z" },
    { id: "k1", state: "told", updated_at: "2026-11-08T10:00:00Z" },
    { id: "w1", state: "wont_do", updated_at: "2026-11-08T10:00:00Z" },
    { id: "z1", state: "needs_review", updated_at: "2026-11-08T10:00:00Z" },
  ];

  it("five columns, in stage order", () => {
    assert.deepEqual(BOARD_COLUMNS.map((c) => c.label), ["New", "Triaged", "Planned", "Shipped", "Told"]);
  });

  it("each item sits in one column; Won't do and unknown states sit in none", () => {
    const groups = groupSignals(signals);
    assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((s) => s.id)])), {
      new: ["n2", "n1"], triaged: ["t1"], planned: ["p1"], shipped: ["s1"], told: ["k1"],
    });
    assert.equal(columnFor({ state: "wont_do" }), null);
    assert.equal(columnFor({ state: "needs_review" }), null);
  });

  it("the Won't do filter lists only Won't do", () => {
    assert.deepEqual(groupSignals(signals, { showWontDo: true }).wont_do.map((s) => s.id), ["w1"]);
  });
});

// ── Tell reporters, once ────────────────────────────────────────────────────
describe("#4382 W3: Tell reporters can be sent once", () => {
  const ticketsById = {
    t1: { id: "t1", visibility: "person" },
    t2: { id: "t2", visibility: "brand" },
    t3: { id: "t3", visibility: "internal" },
  };
  const shipped = {
    state: "shipped",
    sources: [
      { source_kind: "support_ticket", source_id: "t1" },
      { source_kind: "support_ticket", source_id: "t2" },
      { source_kind: "support_ticket", source_id: "t3" },
      { source_kind: "community_idea", source_id: "idea-1" },
    ],
    drafts: [
      { id: "d-old", customer_status: "Planned", state: "draft", created_at: "2026-11-01T00:00:00Z" },
      { id: "d-live", customer_status: "Live", state: "draft", created_at: "2026-11-09T00:00:00Z" },
    ],
  };

  it("goes to the customer-visible tickets only, with the Live wording", () => {
    const state = tellReportersState(shipped, ticketsById);
    assert.equal(state.canSend, true);
    assert.deepEqual(state.recipients.map((t) => t.id), ["t1", "t2"]);
    assert.equal(state.draft.id, "d-live");
    assert.equal(tellButtonLabel(state.recipients.length), "Send to 2 people");
    assert.equal(tellButtonLabel(1), "Send to 1 person");
  });

  it("refuses while sending, after a send, once told, before shipped and with no Live wording", () => {
    assert.equal(tellReportersState(shipped, ticketsById, { sending: true }).canSend, false);
    assert.equal(tellReportersState(shipped, ticketsById, { sentOnce: true }).canSend, false);
    assert.equal(tellReportersState({ ...shipped, state: "told" }, ticketsById).canSend, false);
    assert.equal(tellReportersState({ ...shipped, state: "planned" }, ticketsById).canSend, false);
    assert.equal(tellReportersState({ ...shipped, drafts: [{ id: "d", customer_status: "Live", state: "sent" }] }, ticketsById).canSend, false);
  });

  it("the button is held by that guard and the send calls the once-only server function", () => {
    const card = read("components/support/ProductCardPanel.jsx");
    assert.match(card, /const tell = tellReportersState\(signal, ticketsById, \{ sending: telling, sentOnce \}\);/);
    assert.match(card, /async function sendTell\(\) \{\n\s+if \(!tell\.canSend \|\| !tell\.draft\) return;/);
    assert.match(card, /disabled=\{!tell\.canSend \|\| busy/);
    assert.match(card, /const result = await tellProductReporters\(signal\.id, tell\.draft\.id\);\n\s+setSentOnce\(true\);/);
    assert.match(read("services/productAvengersService.js"), /rpc\("issue_4382_tell_reporters"/);
    assert.match(read("services/productAvengersService.js"), /rpc\("issue_4382_set_wont_do"/);
  });
});

// ── Who runs the Product board (D3) ─────────────────────────────────────────
describe("#4382 W3: a founding partner runs the Product board", () => {
  const allTabs = [...SUPPORT_PAGE_TABS, ...COMMUNITY_PAGE_TABS];
  const partner = {
    role: "partner",
    status: "active",
    areas: ["admin_console", "community_support", "community_support_support", "community_support_community"],
  };
  const plainSupport = { role: "growth", status: "active", areas: ["community_support", "community_support_support"] };

  it("an active founding partner (role partner, admin console) sees the Product board", () => {
    assert.ok(allTabs.some((tab) => tab.id === "product"), "the Product board is a console tab");
    assert.equal(communitySupportCapabilities(partner).isAdmin, true);
    assert.ok(communitySupportTabsForAccess(partner, allTabs).some((tab) => tab.id === "product"));
  });

  it("plain Support staff, and a partner whose seat is not active, do not", () => {
    assert.equal(communitySupportTabsForAccess(plainSupport, allTabs).some((tab) => tab.id === "product"), false);
    assert.ok(communitySupportTabsForAccess(plainSupport, allTabs).some((tab) => tab.id === "support"));
    assert.equal(communitySupportTabsForAccess({ ...partner, status: "revoked" }, allTabs).some((tab) => tab.id === "product"), false);
  });

  it("the page mounts the board on the same admin-console capability", () => {
    assert.match(read("pages/CommunitySupportPage.jsx"), /activeTab === "product" && capabilities\.isAdmin && <ProductInboxPanel \/>/);
  });
});

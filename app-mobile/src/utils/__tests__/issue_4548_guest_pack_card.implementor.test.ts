// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4548 — the Explorer Guest pack card: what shows, for whom, until when, and
// how each row is labelled and opened.
//
// The server is not applied anywhere yet, so the read is not exercised against
// a backend: the display rules are pure functions and the wiring is a source
// contract (the card needs the RN renderer, which this Deno suite does not run).
//
// FAILS-ON-REVERT:
// - isGuestPackWindowOpen without the 24 h rule -> the cut-off cases fail.
// - guestPackRowKind labelling Drive/other links "pdf" -> the label case fails.
// - the card opening a link outside useOpenInMingla, or skipping isOnline ->
//   the source contract fails.

import {
  GUEST_PACK_GRACE_MS,
  guestPackRowKind,
  guestPackSite,
  hasGuestPackContent,
  isGuestPackUpdatedAfter,
  isGuestPackWindowOpen,
  isOrderGuestPackEligible,
  isRsvpGuestPackEligible,
  openableGuestPackItems,
  parseGuestPack,
} from "../guestPackDisplay.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(`../../../${rel}`, import.meta.url));

Deno.test("no pack (null) and an empty pack render nothing", () => {
  assertEquals(parseGuestPack(null), null, "null is no pack");
  assertEquals(parseGuestPack({ note: null, items: [], updatedAt: null }), null, "empty is no pack");
  assertEquals(parseGuestPack({ note: "  ", items: [] }), null, "blank note is no pack");
  assertEquals(parseGuestPack("junk"), null, "a non-object is no pack");
  assertEquals(hasGuestPackContent(null, []), false, "nothing to show");
  assertEquals(hasGuestPackContent("Gate code", []), true, "a note alone shows");
  assertEquals(hasGuestPackContent(null, [{}]), true, "a link alone shows");
});

Deno.test("the pack keeps the host's order and the wire shape", () => {
  const pack = parseGuestPack({
    note: "Use the side gate",
    items: [
      { label: "Menu", url: "https://a.example.com/menu.pdf" },
      { label: "Map", url: "https://b.example.com/map" },
      { label: 5, url: "https://c.example.com" },
    ],
    updatedAt: "2026-11-24T10:00:00Z",
  });
  assertEquals(pack?.items.map((i) => i.label), ["Menu", "Map"], "order kept, malformed dropped");
  assertEquals(pack?.updatedAt, "2026-11-24T10:00:00Z", "updatedAt kept");
});

Deno.test("row label: .pdf says Open PDF, everything else says Open", () => {
  assertEquals(guestPackRowKind("https://files.example.com/parking.pdf"), "pdf", "plain pdf");
  assertEquals(guestPackRowKind("https://files.example.com/Parking.PDF?dl=1"), "pdf", "case and query");
  assertEquals(guestPackRowKind("https://drive.google.com/file/d/abc123/view"), "page", "Drive is a web page");
  assertEquals(guestPackRowKind("https://example.com/pdf"), "page", "pdf in the path only");
  assertEquals(guestPackRowKind("https://example.com/a.pdf/extra"), "page", "not at the end");
  assertEquals(guestPackSite("https://www.example.com/x"), "example.com", "site without www");
});

Deno.test("24 hour cut-off uses the event's end time", () => {
  const ends = "2026-11-24T20:00:00Z";
  const at = (ms: number) => Date.parse(ends) + ms;
  assertEquals(isGuestPackWindowOpen({ endsAtIso: ends, now: at(-1000) }), true, "before it ends");
  assertEquals(isGuestPackWindowOpen({ endsAtIso: ends, now: at(GUEST_PACK_GRACE_MS) }), true, "exactly 24 h after");
  assertEquals(isGuestPackWindowOpen({ endsAtIso: ends, now: at(GUEST_PACK_GRACE_MS + 1) }), false, "just over 24 h");
  assertEquals(
    isGuestPackWindowOpen({ endsAtIso: null, startsAtIso: ends, now: at(GUEST_PACK_GRACE_MS + 1) }),
    false,
    "falls back to the start",
  );
  assertEquals(isGuestPackWindowOpen({ endsAtIso: null, startsAtIso: null }), true, "no times: stays");
  assertEquals(isGuestPackWindowOpen({ endsAtIso: "not a date" }), true, "unreadable: stays");
});

Deno.test("refunded, cancelled and pending bookings show nothing", () => {
  assertEquals(isOrderGuestPackEligible({ paymentStatus: "paid" }), true, "paid");
  assertEquals(isOrderGuestPackEligible({ paymentStatus: "partial_refund" }), true, "partly refunded");
  assertEquals(isOrderGuestPackEligible({ paymentStatus: "refunded" }), false, "refunded");
  assertEquals(isOrderGuestPackEligible({ paymentStatus: "cancelled" }), false, "cancelled");
  assertEquals(isOrderGuestPackEligible({ paymentStatus: "pending" }), false, "pending");
  assertEquals(isOrderGuestPackEligible({ paymentStatus: "paid", cancelledAt: "2026-11-01T00:00:00Z" }), false, "cancelled_at set");
  assertEquals(isOrderGuestPackEligible({ paymentStatus: null }), false, "unknown status");
  assertEquals(isRsvpGuestPackEligible({ status: "going", approvalStatus: "approved" }), true, "going and approved");
  assertEquals(isRsvpGuestPackEligible({ status: "going", approvalStatus: "pending" }), false, "pending guest");
  assertEquals(isRsvpGuestPackEligible({ status: "cancelled", approvalStatus: "approved" }), false, "not going");
});

Deno.test("a stored link the opener would refuse is hidden and reported", () => {
  const rejected: string[] = [];
  const classify = (url: string) => ({ kind: url.startsWith("https://") ? "web" : "invalid" });
  const items = openableGuestPackItems(
    [
      { label: "Ok", url: "https://example.com/a" },
      { label: "Bad", url: "javascript:alert(1)" },
    ],
    classify,
    (item) => rejected.push(item.url),
  );
  assertEquals(items.map((i) => i.label), ["Ok"], "only the openable item stays");
  assertEquals(rejected, ["javascript:alert(1)"], "the failure is reported");
});

Deno.test('"Updated" shows only when the pack changed after the booking', () => {
  assertEquals(isGuestPackUpdatedAfter("2026-11-24T10:00:00Z", "2026-11-20T10:00:00Z"), true, "later");
  assertEquals(isGuestPackUpdatedAfter("2026-11-19T10:00:00Z", "2026-11-20T10:00:00Z"), false, "earlier");
  assertEquals(isGuestPackUpdatedAfter("2026-11-24T10:00:00Z", null), false, "no booking time");
});

Deno.test("source contract: card, wiring, key and strings", () => {
  const card = read("src/components/purchases/GuestPackCard.tsx");
  if (/Linking\.|openBrowserAsync|WebBrowser/.test(card)) throw new Error("the card must open links only through useOpenInMingla");
  for (const needle of ["useOpenInMingla()", "isOnline()", "isGuestPackWindowOpen(", "return null", 'accessibilityLabel={'])
    if (!card.includes(needle)) throw new Error(`card is missing ${needle}`);
  if (!/if \(pack === null \|\| !hasGuestPackContent\(pack\.note, items\)\) return null;/.test(card))
    throw new Error("a null pack must render nothing");
  if (!card.includes("minHeight: 44")) throw new Error("rows need a 44pt target");

  const keys = read("src/hooks/queryKeys.ts");
  if (!/guestPack: \(userId: string, eventId: string\)/.test(keys)) throw new Error("the key lives in the purchases factory");
  if (/guestPack/.test(read("src/hooks/useMyEventGuestPack.ts")) === false) throw new Error("hook uses the key");

  const route = read("app/purchases/[kind]/[id].tsx");
  const shared = read("src/components/purchases/SharedPurchaseDetail.tsx");
  const rsvp = read("src/components/activity/RsvpPassSheet.tsx");
  for (const [name, src] of [["order route", route], ["shared detail", shared], ["rsvp pass", rsvp]])
    if (!src.includes("<GuestPackCard")) throw new Error(`${name} does not render the card`);

  const en = JSON.parse(read("src/i18n/locales/en/purchases.json")).guestPack;
  assertEquals(en.offline, "You're offline. Connect to open this link.", "offline copy");
  assertEquals(en.openPdf, "Open PDF", "pdf label");
  assertEquals(en.open, "Open", "page label");
  for (const key of ["title", "updated", "footer", "footerRsvp", "rowPdfLabel", "rowPageLabel"])
    if (typeof en[key] !== "string") throw new Error(`missing en string ${key}`);
});

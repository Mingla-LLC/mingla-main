// Issue #1789 (#1767 Phase 1) — venue-qr-sheet happy-path contract suite.
// SPEC #1788 P-10 (the canonical printed URL) + P-27 (the print rail).
//
// fails-on-revert, per test:
//   T-Q-URL-1/2/3 — delete the `?tab=menu` param, or swap the serving-venue
//     slug for the physical home's, or point the host at anything but
//     business.usemingla.com, and the assertion turns red. Each of those three
//     is a laminated card that opens the wrong thing.
//   T-Q-PDF-1/2/3 — delete the one-card-per-spot loop, the empty-input guard,
//     or the shared-rail reuse, and the assertion turns red.
//   T-Q-AUTH-1/2 — delete the Bearer requirement or the manager-plus rank gate
//     from index.ts and the source contract turns red. (The handler cannot be
//     imported: `serve()` runs at module load — the house source-contract idiom,
//     e.g. venue-reservation-confirm/__tests__/issue_1221_guest_token_authority.)
//   T-Q-ACTIVE-1 — delete `.eq("is_active", true)` and a dead QR reaches a
//     laminate. Red.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check \
//   supabase/functions/venue-qr-sheet/__tests__/issue_1789_venue_qr_sheet.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { qrSpotUrl } from "../qrSpotUrl.ts";
import { buildVenueQrSheetPdf } from "../../_shared/ticketPdf.ts";

const handlerSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("T-Q-URL-1 — the printed URL is the canonical P-10 string", () => {
  assertEquals(
    qrSpotUrl({
      brandSlug: "brasserie",
      servingVenueSlug: "kitchen",
      code: "kq7m3pd2xr",
    }),
    "https://business.usemingla.com/b/brasserie/v/kitchen?tab=menu&spot=kq7m3pd2xr&src=qr",
  );
});

Deno.test("T-Q-URL-2 — the SERVING venue's slug is printed, never the room's", () => {
  // D-3b: Room 204 lives in the Stay venue and orders from the Brasserie, so a
  // scan must open the Brasserie's menu. Passing the physical home's slug here
  // is the bug this test exists to catch.
  const url = qrSpotUrl({
    brandSlug: "grand-hotel",
    servingVenueSlug: "brasserie",
    code: "mn4pq7rs2t",
  });
  assertStringIncludes(url, "/v/brasserie?");
  assert(!url.includes("/v/rooms"));
});

Deno.test("T-Q-URL-3 — host + params: business.usemingla.com, tab=menu, src=qr", () => {
  const url = new URL(
    qrSpotUrl({ brandSlug: "b", servingVenueSlug: "v", code: "abcdefgh23" }),
  );
  // The ONLY host that app-opens on BOTH platforms today.
  assertEquals(url.origin, "https://business.usemingla.com");
  assertEquals(url.searchParams.get("tab"), "menu");
  assertEquals(url.searchParams.get("spot"), "abcdefgh23");
  assertEquals(url.searchParams.get("src"), "qr");
});

Deno.test("T-Q-PDF-1 — one A4 card per spot, bulk and single share the builder", async () => {
  const bulk = await buildVenueQrSheetPdf({
    brandName: "Brasserie Group",
    spots: [
      {
        venueName: "The Brasserie",
        spotLabel: "Table 12",
        servingLine: null,
        url: qrSpotUrl({
          brandSlug: "brasserie",
          servingVenueSlug: "kitchen",
          code: "kq7m3pd2xr",
        }),
      },
      {
        venueName: "Grand Hotel",
        spotLabel: "Room 204",
        servingLine: "Serving: The Brasserie · In-room dining",
        url: qrSpotUrl({
          brandSlug: "brasserie",
          servingVenueSlug: "kitchen",
          code: "mn4pq7rs2t",
        }),
      },
    ],
  });
  assertEquals(bulk.pageCount, 2);
  assertEquals(bulk.filename, "mingla-qr-spots.pdf");
  const bytes = Uint8Array.from(
    atob(bulk.contentBase64),
    (c) => c.charCodeAt(0),
  );
  const reloaded = await PDFDocument.load(bytes);
  assertEquals(reloaded.getPageCount(), 2);
  // A4 portrait, matching the shipped ticket/RSVP pages.
  const [w, h] = [
    reloaded.getPage(0).getWidth(),
    reloaded.getPage(0).getHeight(),
  ];
  assertEquals(Math.round(w), 595);
  assertEquals(Math.round(h), 842);

  const single = await buildVenueQrSheetPdf({
    brandName: "Brasserie Group",
    spots: [
      {
        venueName: "The Brasserie",
        spotLabel: "Table 12",
        servingLine: null,
        url: qrSpotUrl({
          brandSlug: "brasserie",
          servingVenueSlug: "kitchen",
          code: "kq7m3pd2xr",
        }),
      },
    ],
  });
  assertEquals(single.pageCount, 1);
  assertEquals(single.filename, "mingla-qr-spot.pdf");
});

Deno.test("T-Q-PDF-2 — an empty spot list is refused, never a blank sheet", async () => {
  await assertRejects(
    () => buildVenueQrSheetPdf({ brandName: "B", spots: [] }),
    Error,
    "venue_qr_sheet_no_spots",
  );
});

Deno.test("T-Q-PDF-3 — a non-WinAnsi label renders instead of killing the sheet", async () => {
  // ORCH-1195's lesson, inherited: pdf-lib StandardFonts throw on non-WinAnsi
  // glyphs. Every data-derived string goes through the shared `truncate`, so a
  // venue that names a table "Terrasse — Café №1 🍽" still gets a sheet.
  const result = await buildVenueQrSheetPdf({
    brandName: "Café Group",
    spots: [
      {
        venueName: "Terrasse — Café №1 🍽",
        spotLabel: "Table 1 — Terrasse",
        servingLine: "Serving: Café №1",
        url: qrSpotUrl({
          brandSlug: "cafe",
          servingVenueSlug: "cafe",
          code: "abcdefgh23",
        }),
      },
    ],
  });
  assertEquals(result.pageCount, 1);
  assert(result.byteLength > 0);
});

Deno.test("T-Q-AUTH-1 — a Bearer is REQUIRED in-code, not at the gateway", () => {
  assertStringIncludes(handlerSource, "userIdFromAuthHeader(req)");
  assertStringIncludes(handlerSource, 'jsonResponse({ error: "unauthorized" }, 401)');
});

Deno.test("T-Q-AUTH-2 — manager-plus rank is checked BEFORE any spot code is read", () => {
  assertStringIncludes(handlerSource, "biz_brand_effective_rank");
  assertStringIncludes(handlerSource, "RANK_EVENT_MANAGER = 40");
  assertStringIncludes(handlerSource, 'jsonResponse({ error: "not_authorized" }, 403)');
  const rankIndex = handlerSource.indexOf("biz_brand_effective_rank");
  const spotIndex = handlerSource.indexOf('.from("qr_spots")');
  assert(rankIndex > 0 && spotIndex > 0);
  assert(
    rankIndex < spotIndex,
    "the rank gate must run before qr_spots is queried",
  );
});

Deno.test("T-Q-ACTIVE-1 — only ACTIVE spots are printed", () => {
  assertStringIncludes(handlerSource, '.eq("is_active", true)');
});

Deno.test("T-Q-TTL-1 — the sheet lands in a private bucket behind a 60s signed URL", () => {
  assertStringIncludes(handlerSource, "SIGNED_URL_TTL_SECONDS = 60");
  assertStringIncludes(handlerSource, 'STORAGE_BUCKET = "venue-qr-sheets"');
  assertStringIncludes(handlerSource, "createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS)");
});

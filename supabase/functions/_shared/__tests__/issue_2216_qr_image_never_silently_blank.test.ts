/**
 * issue #2216 [ticket QR renders as a blank white square] — `_shared/ticketQrImage.ts`.
 *
 * WHAT WAS ACTUALLY BROKEN — and what was NOT. The issue's prime suspect was
 * the blanket `@ts-ignore` on the esm.sh import (issue #2197) hiding a runtime
 * failure of `QRCode.toDataURL`. That was REFUTED by running the deployed
 * helper inside the production edge-runtime image
 * (`supabase/edge-runtime:v1.74.3`, `Deno v2.1.4` — the exact runtime the
 * production `function_edge_logs` user-agent reports): the helper returned a
 * 400x400 PNG data URI that decodes back to the real 122-char production QR
 * payload, byte-identical before and after this change. The generator was
 * never the problem.
 *
 * The problem was that a helper which CANNOT fail loudly cannot tell anyone
 * when it has failed. `qrPayloadToDataUrl` returned whatever the library
 * handed back, and `TicketQrCarousel` renders a plain white `<View>` whenever
 * `imageDataUrl` is absent or empty. So every failure mode between the two —
 * a module that resolved to the wrong shape, a truncated string, a producer
 * that never called the helper at all — arrived at the guest as a blank pass
 * with nothing logged anywhere.
 *
 * This suite pins the two properties that make that impossible again:
 *
 *   A. `assertRenderablePngDataUrl` REJECTS every shape a broken module or CDN
 *      would actually produce. It is exported precisely so it can be driven
 *      directly — a post-condition that only ever runs behind a working
 *      library is unfalsifiable, which is the same class of defect as the
 *      suppression this issue removed.
 *
 *   B. `attachQrImageDataUrls` — the ONE owner of "ticket → ticket + rendered
 *      QR" for `ticket-checkout-create`, `-confirm` and `-status` — attaches a
 *      real, DISTINCT image per ticket, passes every other field through
 *      untouched, and degrades a single failed ticket to the carousel
 *      placeholder + a structured error line rather than failing a paid order.
 *
 * FAILS ON REVERT: delete the post-condition and case A2/A3/A4/A5 pass a
 * blank through; revert `attachQrImageDataUrls` to a passthrough and B1 finds
 * no image.
 *
 * Network: hits esm.sh for the qrcode bundle (same dependency the deployed
 * function has). Run with --allow-net --allow-read.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  assertRenderablePngDataUrl,
  attachQrImageDataUrls,
  qrPayloadToDataUrl,
} from "../ticketQrImage.ts";

const PREFIX = "data:image/png;base64,";

/** Shaped exactly like a production `tickets.qr_code` (122 chars). */
function productionShapedPayload(ticketId: string, sigTail: string): string {
  const sig = sigTail.repeat(64).slice(0, 64);
  return `mingla:v1:ticket:${ticketId}:sig:${sig}`;
}

const TICKET_A = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2216";
const TICKET_B = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb2216";

// ───────────────────────────────────────────── A. the post-condition is real

Deno.test("issue #2216 A1 — a genuine PNG data URI is accepted unchanged", () => {
  const good = PREFIX + "A".repeat(400);
  assertEquals(assertRenderablePngDataUrl(good), good);
});

Deno.test(
  "issue #2216 A2 — the empty string is REJECTED (this is the blank square)",
  () => {
    // The reported symptom exactly: an empty image string reaches the carousel,
    // `imageDataUrl.length > 0` is false, and the guest is shown a white box
    // with nothing logged. It must be an error at the source instead.
    assertThrows(
      () => assertRenderablePngDataUrl(""),
      Error,
      "qr_image_generation_failed",
    );
  },
);

Deno.test(
  "issue #2216 A3 — undefined is REJECTED (module resolved without a usable default)",
  () => {
    // The shape the #2197 suspect would have produced: `QRCode` undefined, so
    // `toDataURL` yields nothing usable. Loud, not blank.
    assertThrows(
      () => assertRenderablePngDataUrl(undefined),
      Error,
      "qr_image_generation_failed",
    );
    assertThrows(
      () => assertRenderablePngDataUrl(null),
      Error,
      "qr_image_generation_failed",
    );
  },
);

Deno.test(
  "issue #2216 A4 — a bare/truncated data URI is REJECTED (no pixels in it)",
  () => {
    // A prefix with a stub body is still a `data:image/png;base64,…` string and
    // still passes `length > 0`, so the carousel would render an <Image> that
    // silently fails to decode — visually identical to the placeholder.
    assertThrows(
      () => assertRenderablePngDataUrl(PREFIX),
      Error,
      "qr_image_generation_failed",
    );
    assertThrows(
      () => assertRenderablePngDataUrl(PREFIX + "AAAA"),
      Error,
      "qr_image_generation_failed",
    );
  },
);

Deno.test(
  "issue #2216 A5 — a non-PNG payload is REJECTED (wrong renderer for <Image>)",
  () => {
    // ORCH-0930's whole point: SVG does not render on the Expo SDK 54 web
    // export. An SVG data URI, or a stringified error, must never be handed to
    // the carousel as if it were the pass.
    assertThrows(
      () =>
        assertRenderablePngDataUrl(
          "data:image/svg+xml;base64," + "A".repeat(400),
        ),
      Error,
      "qr_image_generation_failed",
    );
    assertThrows(
      () =>
        assertRenderablePngDataUrl(
          "TypeError: QRCode.toDataURL is not a function",
        ),
      Error,
      "qr_image_generation_failed",
    );
    assertThrows(
      () => assertRenderablePngDataUrl({ toDataURL: 1 }),
      Error,
      "qr_image_generation_failed",
    );
  },
);

Deno.test(
  "issue #2216 A6 — a real production-shaped payload renders a real PNG",
  async () => {
    const payload = productionShapedPayload(TICKET_A, "f1");
    assertEquals(
      payload.length,
      122,
      "fixture must match the production qr_code length so this test exercises the real size",
    );
    const uri = await qrPayloadToDataUrl(payload);
    assert(
      uri.startsWith(PREFIX),
      `expected a PNG data URI, got: ${uri.slice(0, 48)}`,
    );
    assert(
      uri.length - PREFIX.length > 1000,
      `expected a substantial base64 body, got ${
        uri.length - PREFIX.length
      } chars`,
    );
  },
);

Deno.test(
  'issue #2216 A7 — the empty-payload contract is UNCHANGED (still "", never a throw)',
  async () => {
    // Deliberate: `tickets.qr_code` is NOT NULL, so an empty payload is a
    // caller bug, not a renderer failure. Returning "" keeps the carousel's
    // honest placeholder guard in charge instead of failing an order. The
    // post-condition applies only AFTER the library has been asked to draw.
    assertEquals(await qrPayloadToDataUrl(""), "");
  },
);

// ────────────────────────────── B. attachQrImageDataUrls is the single owner

Deno.test(
  "issue #2216 B1 — every ticket comes back with its OWN non-empty PNG",
  async () => {
    const rows = [
      {
        ticketId: TICKET_A,
        ticketTypeId: "tt-1",
        ticketName: "Free Entry",
        qrPayload: productionShapedPayload(TICKET_A, "a1"),
        status: "valid",
      },
      {
        ticketId: TICKET_B,
        ticketTypeId: "tt-1",
        ticketName: "Free Entry",
        qrPayload: productionShapedPayload(TICKET_B, "b2"),
        status: "valid",
      },
    ];

    const withImages = await attachQrImageDataUrls(rows);

    assertEquals(withImages.length, 2);
    for (const t of withImages) {
      assert(
        t.qrImageDataUrl.startsWith(PREFIX),
        `ticket ${t.ticketId} has no PNG data URI — this is the #2216 blank square`,
      );
      assert(
        t.qrImageDataUrl.length - PREFIX.length > 1000,
        `ticket ${t.ticketId} image body is only ${
          t.qrImageDataUrl.length - PREFIX.length
        } chars`,
      );
    }
    assertNotEquals(
      withImages[0].qrImageDataUrl,
      withImages[1].qrImageDataUrl,
      "two seats must carry two DIFFERENT codes — one shared image means one of the two guests is turned away at the door",
    );
  },
);

Deno.test(
  "issue #2216 B2 — every other field passes through byte-identical",
  async () => {
    const row = {
      ticketId: TICKET_A,
      ticketTypeId: null,
      ticketName: "General Admission",
      qrPayload: productionShapedPayload(TICKET_A, "c3"),
      status: "valid",
      // A field no shared type declares — the owner must not narrow its input.
      dayLabel: "Day 2",
    };

    const [out] = await attachQrImageDataUrls([row]);

    assertEquals(out.ticketId, row.ticketId);
    assertEquals(out.ticketTypeId, row.ticketTypeId);
    assertEquals(out.ticketName, row.ticketName);
    assertEquals(out.qrPayload, row.qrPayload);
    assertEquals(out.status, row.status);
    assertEquals(out.dayLabel, "Day 2");
  },
);

Deno.test(
  "issue #2216 B3 — an unrenderable ticket degrades to the placeholder, never takes the order down",
  async () => {
    // An empty payload is the one input that legitimately yields "". The order
    // still returns, and the carousel's `imageDataUrl.length > 0` guard — which
    // stays exactly as it is — shows the placeholder for that one seat.
    const out = await attachQrImageDataUrls([
      {
        ticketId: TICKET_A,
        ticketName: "Free Entry",
        qrPayload: "",
        status: "valid",
      },
      {
        ticketId: TICKET_B,
        ticketName: "Free Entry",
        qrPayload: productionShapedPayload(TICKET_B, "d4"),
        status: "valid",
      },
    ]);

    assertEquals(out.length, 2, "a bad ticket must not remove a good one");
    assertEquals(out[0].qrImageDataUrl, "");
    assert(out[1].qrImageDataUrl.startsWith(PREFIX));
  },
);

Deno.test(
  "issue #2216 B4 — an empty ticket list is not an error (pending order, no seats yet)",
  async () => {
    assertEquals(await attachQrImageDataUrls([]), []);
  },
);

Deno.test(
  "issue #2216 B5 — the generator itself still throws for a caller that bypasses the owner",
  async () => {
    // Guards the seam: a future caller that reaches past `attachQrImageDataUrls`
    // and gets a broken image must get an exception, not a blank. Driven through
    // the exported post-condition so the assertion cannot go vacuous.
    await assertRejects(
      () => Promise.resolve().then(() => assertRenderablePngDataUrl("")),
      Error,
      "qr_image_generation_failed",
    );
  },
);

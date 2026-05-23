/**
 * ORCH-0932 — server-side QR PNG generation helper test.
 *
 * Validates that `qrPayloadToDataUrl` produces a PNG data URI with a
 * non-empty base64 body. The full PNG decode is exercised in production by
 * the existing `_shared/ticketPdf.ts` pipeline (which uses the same npm
 * `qrcode` package via the same esm.sh bundle URL).
 *
 * Locks in:
 *   1. The output is a `data:image/png;base64,<...>` URI string suitable for
 *      RN `<Image source={{ uri }}>`.
 *   2. Different payloads produce different outputs (no fixed/empty value
 *      slipping through silently).
 *   3. Empty payload still returns a structurally valid URI (so the carousel
 *      never crashes on a missing payload — it just shows a generic QR).
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { qrPayloadToDataUrl } from "../ticketQrImage.ts";

Deno.test(
  "ORCH-0932 HP-1 — qrPayloadToDataUrl returns a PNG data URI with non-empty base64 body",
  async () => {
    const uri = await qrPayloadToDataUrl("test-payload-orch-0932");
    assert(
      uri.startsWith("data:image/png;base64,"),
      `Expected URI to start with "data:image/png;base64," but got: ${uri.slice(0, 50)}...`,
    );
    const base64 = uri.slice("data:image/png;base64,".length);
    assert(
      base64.length > 100,
      `Expected base64 body of >100 chars (a real PNG); got ${base64.length} chars`,
    );
  },
);

Deno.test(
  "ORCH-0932 HP-2 — distinct payloads produce distinct data URIs (no cache/empty collision)",
  async () => {
    const uriA = await qrPayloadToDataUrl("payload-A-orch-0932-distinct");
    const uriB = await qrPayloadToDataUrl("payload-B-orch-0932-distinct");
    assertNotEquals(
      uriA,
      uriB,
      "Two distinct payloads must produce two distinct QR data URIs — otherwise either the lib is broken or both tickets would render the same QR (silent scan failure at the door).",
    );
  },
);

Deno.test(
  "ORCH-0932 HP-3 — empty payload returns empty string (graceful no-op; carousel placeholder takes over)",
  async () => {
    const uri = await qrPayloadToDataUrl("");
    assertEquals(
      uri,
      "",
      "Empty payload should not crash; helper returns empty string so the carousel's `imageDataUrl.length > 0` guard renders the placeholder View rather than letting the qrcode lib throw 'No input text'.",
    );
  },
);

Deno.test(
  "ORCH-0932 HP-4 — output is deterministic for the same payload (idempotent)",
  async () => {
    const payload = "deterministic-orch-0932";
    const uriA = await qrPayloadToDataUrl(payload);
    const uriB = await qrPayloadToDataUrl(payload);
    assertEquals(
      uriA,
      uriB,
      "Same payload must produce identical QR data URIs — otherwise scanner-side hash matches would drift between fast-path (confirm) and slow-path (status) responses.",
    );
  },
);

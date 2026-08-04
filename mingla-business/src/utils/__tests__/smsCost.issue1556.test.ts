/**
 * Issue #1556 — the SMS composer's cost preview must measure the bytes the
 * adapter actually transmits. Asserted from INSIDE the Jest suite (the required
 * business check).
 *
 * ===========================================================================
 * TWO DEFECTS, ONE ROOT CAUSE
 * ===========================================================================
 * `smsCost.ts` exists to mirror the server adapter so the composer can quote an
 * honest segment count and campaign cost. It had drifted in BOTH directions:
 *
 *   1. FOOTER SUPPRESSION (the filed issue). #1541 end-anchored the guard in
 *      `composeSmsBody`; this module kept the loose `/reply stop/i`, so a body
 *      that MENTIONS the phrase without ENDING in the footer was previewed 24
 *      characters shorter than it ships — UNDER-reporting by a whole segment
 *      across the 153/160 and 67/70 boundaries.
 *
 *   2. GSM-7 SANITIZATION (#1556 D1). The adapter runs `sanitizeGsm7()` before
 *      transmitting; this module did not. iOS auto-substitutes a curly
 *      apostrophe, so "Don't miss it" was scored UCS-2 (70/seg) while the wire
 *      ships GSM-7 (160/seg) — an OVER-report of ~2.3x on ordinary copy, and
 *      over-quoting is the worse commercial direction.
 *
 * ===========================================================================
 * THIS TEST DRIVES BOTH IMPLEMENTATIONS — IT DOES NOT MIRROR THE SERVER
 * ===========================================================================
 * The server adapter is a Deno module (`.ts`-suffixed relative imports,
 * `Deno.env` in its transitive deps), so Jest cannot `import` it. Rather than
 * hand-copy a corpus of expected outputs — which is the very thing that
 * drifted — `./adapterParityHarness` READS `smsAdapter.ts` off disk and
 * EXECUTES the shipped function BODIES of `composeSmsBody` and `sanitizeGsm7`,
 * injecting their two dependencies. Those bodies are pure JS (all TypeScript
 * annotations live in the signatures, which are not extracted), so they run
 * verbatim. Every server value below is therefore COMPUTED BY RUNNING THE
 * SERVER. Change the adapter and this suite changes with it and fails — that is
 * what makes it falsifiable rather than decorative.
 *
 * The corpus is the SAME JSON file the Deno twin reads
 * (`supabase/functions/__tests__/fixtures/issue1556_sms_footer_corpus.json`).
 *
 * RESIDUAL LIMITATION, stated honestly: the extraction is STRUCTURAL. If the
 * adapter is refactored so the guard or the sanitizer no longer lives inline in
 * those two functions, the harness THROWS with an explicit message and this
 * suite fails loudly — it does not silently pass. That is the intended
 * direction: an unfalsifiable guard is worse than none, and #1556 exists
 * because a mirror drifted in silence. The authority remains the Deno twin,
 * `supabase/functions/__tests__/issue1556_sms_footer_parity.test.ts`, which
 * imports both real modules natively with no extraction at all.
 *
 * ===========================================================================
 * FAILS-ON-REVERT
 * ===========================================================================
 * Footer half — restore `if (/reply stop/i.test(body)) return body;` plus the
 * `body.length === 0 ? body :` short-circuit: L1/L2/L4/L6/L7 fail.
 * Sanitizer half — make `wireBody` skip `sanitizeGsm7`, or drop one character
 * class from the client's sanitizer: L2, L3, L4 and the L8 codepoint sweep fail.
 */

import {
  bodyWithFooter,
  computeSegments,
  estimateSmsCost,
  sanitizeGsm7 as clientSanitizeGsm7,
  wireBody,
} from "../smsCost";
// The SERVER adapter, made executable from Jest. The harness reads
// smsAdapter.ts and runs its SHIPPED composeSmsBody / sanitizeGsm7 bodies, so
// this suite drives the real server implementation rather than a replica. It
// lives in a separate non-test module so this file contains behaviour only.
import {
  CORPUS,
  CorpusEntry,
  serverAppends,
  serverComposeSmsBody,
  SERVER_STOP_FOOTER,
  serverSanitizeGsm7,
} from "./adapterParityHarness";

// Did the CLIENT append a footer? Derived by RUNNING it, never by re-stating
// its regex: when it suppresses it returns the trimmed body unchanged.
const clientAppends = (body: string): boolean => bodyWithFooter(body) !== body.trim();

const REQUIRED_IDS = [
  "mid-body-mention",
  "mid-body-mention-prose",
  "mid-body-mention-uppercase",
  "ends-with-footer",
  "ends-with-footer-trailing-space",
  "ends-with-footer-trailing-newlines",
  "ends-with-footer-lowercase",
  "ends-with-footer-mixed-case",
  "ends-with-footer-single-space-form",
  "footer-without-period",
  "footer-then-more-text",
  "empty",
  "whitespace-only",
  "gsm7-boundary-136-mention",
  "gsm7-boundary-137-mention",
  "gsm7-boundary-160-already-footered",
  "gsm7-boundary-161-already-footered",
  "ucs2-boundary-46-mention",
  "ucs2-boundary-47-mention",
  "smart-punctuation-mention",
  "smart-apostrophe-boundary",
  "ellipsis-grows-body",
  "curly-double-quotes",
  "dashes-and-bar",
  "nbsp-variants",
  "bullet-list",
  "prime-marks",
  "every-sanitized-class",
  "smart-punctuation-already-footered",
];

describe("#1556 — the composer measures what the SMS adapter transmits", () => {
  // -------------------------------------------------------------------------
  // L0 — vacuity guards. Discovering nothing is a FAILURE, never a pass.
  // -------------------------------------------------------------------------
  it("L0a — the extracted server composer and sanitizer actually run (canary)", () => {
    expect(SERVER_STOP_FOOTER).toBe("Reply STOP to opt out.");
    expect(serverSanitizeGsm7("don’t — wait…")).toBe("don't - wait...");
    expect(serverComposeSmsBody("Doors 8pm", true)).toBe(
      "Doors 8pm\n\nReply STOP to opt out.",
    );
    expect(serverComposeSmsBody("Doors 8pm", false)).toBe(
      "Doors 8pm Reply STOP to opt out.",
    );
  });

  it("L0b — the adapter's guard is still END-ANCHORED and it still sanitizes (#1541 not regressed)", () => {
    // Behavioural, not a grep. If either fails the REFERENCE itself moved —
    // STOP, do not "fix" the client to match.
    expect(serverAppends("Reply Stop plays tonight.", true)).toBe(true);
    expect(serverAppends("Doors 8pm. Reply STOP to opt out.", true)).toBe(false);
    expect(serverComposeSmsBody("Don’t", true)).toContain("Don't");
  });

  it("L0c — the shared corpus is present and still carries every adversarial case", () => {
    expect(CORPUS.issue).toBe(1556);
    expect(CORPUS.entries.length).toBeGreaterThanOrEqual(29);
    const ids = CORPUS.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of REQUIRED_IDS) {
      expect(ids).toContain(required);
    }
  });

  // -------------------------------------------------------------------------
  // L1 — THE FOOTER DRIFT LAW.
  // -------------------------------------------------------------------------
  it("L1 — client and server make the same suppression decision for every corpus body", () => {
    for (const e of CORPUS.entries) {
      expect({ id: e.id, appends: clientAppends(e.body) }).toEqual({
        id: e.id,
        appends: serverAppends(e.body, true),
      });
    }
  });

  // -------------------------------------------------------------------------
  // L2 — BYTE EQUALITY, no caveats. Before D1 this could only be stated
  // "modulo sanitizeGsm7". If you find yourself weakening it, that IS the drift.
  // -------------------------------------------------------------------------
  it("L2 — the client's wire body IS the adapter's wire body, byte for byte", () => {
    for (const e of CORPUS.entries) {
      expect({ id: e.id, wire: wireBody(e.body) }).toEqual({
        id: e.id,
        wire: serverComposeSmsBody(e.body, true),
      });
    }
  });

  // -------------------------------------------------------------------------
  // L3 — segment parity over the WHOLE corpus.
  // -------------------------------------------------------------------------
  it("L3 — previewed segment count equals the wire segment count", () => {
    let checked = 0;
    for (const e of CORPUS.entries) {
      expect({ id: e.id, segments: computeSegments(wireBody(e.body)) }).toEqual({
        id: e.id,
        segments: computeSegments(serverComposeSmsBody(e.body, true)),
      });
      checked++;
    }
    expect(checked).toBe(CORPUS.entries.length);
  });

  // -------------------------------------------------------------------------
  // L4 — the misquote in the units that bill.
  // -------------------------------------------------------------------------
  it("L4 — segment-boundary bodies bill exactly what the preview shows", () => {
    let pinned = 0;
    for (const e of CORPUS.entries) {
      if (e.expect === undefined) continue;
      const wire = serverComposeSmsBody(e.body, true);
      expect({ id: e.id, appends: clientAppends(e.body) }).toEqual({
        id: e.id,
        appends: e.expect.clientAppends,
      });
      expect({ id: e.id, len: wire.length }).toEqual({ id: e.id, len: e.expect.wireLength });
      expect({ id: e.id, seg: computeSegments(wire) }).toEqual({
        id: e.id,
        seg: e.expect.wireSegments,
      });
      expect({ id: e.id, seg: computeSegments(wireBody(e.body)) }).toEqual({
        id: e.id,
        seg: e.expect.wireSegments,
      });
      pinned++;
    }
    expect(pinned).toBe(8);
  });

  // -------------------------------------------------------------------------
  // L5 — both adapter routes. #1556 warns against assuming one.
  // -------------------------------------------------------------------------
  it("L5 — suppression is route-independent; only the separator differs", () => {
    for (const e of CORPUS.entries) {
      const decision = clientAppends(e.body);
      expect({ id: e.id, txn: serverAppends(e.body, false) }).toEqual({
        id: e.id,
        txn: decision,
      });
      if (!decision) continue;
      expect(serverComposeSmsBody(e.body, false).endsWith(` ${CORPUS.footer}`)).toBe(true);
      expect(serverComposeSmsBody(e.body, true).endsWith(`\n\n${CORPUS.footer}`)).toBe(true);
      expect(wireBody(e.body).endsWith(`\n\n${CORPUS.footer}`)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // L6 — the composer's empty state is UNCHANGED. `bodyWithFooter` mirrors the
  // adapter on the empty body (it appends), so the "nothing typed yet"
  // short-circuit lives in `estimateSmsCost`.
  // -------------------------------------------------------------------------
  it("L6 — an empty composer still estimates zero, and MMS billing is untouched", () => {
    const empty = estimateSmsCost("", 250);
    expect(empty.charCount).toBe(0);
    expect(empty.segmentsPerRecipient).toBe(0);
    expect(empty.totalSegments).toBe(0);
    expect(empty.estimatedCostMinor).toBe(0);

    const whitespace = estimateSmsCost("   \n  ", 250);
    expect(whitespace.charCount).toBe(0);
    expect(whitespace.totalSegments).toBe(0);

    // MMS with no caption: still one message per recipient at the MMS rate.
    const mms = estimateSmsCost("", 10, undefined, true);
    expect(mms.encoding).toBe("MMS");
    expect(mms.segmentsPerRecipient).toBe(1);
    expect(mms.totalSegments).toBe(10);
    expect(mms.estimatedCostMinor).toBe(20);

    // And the mirrored composer itself DOES append to an empty body, exactly
    // like the adapter — that is the parity the short-circuit used to block.
    expect(bodyWithFooter("")).toBe("\n\nReply STOP to opt out.");
    expect(serverComposeSmsBody("", true)).toBe("\n\nReply STOP to opt out.");
  });

  // -------------------------------------------------------------------------
  // L7 — the two defects, stated in the composer's own terms.
  // -------------------------------------------------------------------------
  it("L7a — a body mentioning 'reply stop' is costed on the WIRE body, not the shorter one", () => {
    const entry = CORPUS.entries.find((e) => e.id === "gsm7-boundary-137-mention");
    expect(entry).toBeDefined();
    const body = (entry as CorpusEntry).body;
    const est = estimateSmsCost(body, 1000);
    expect(est.charCount).toBe(serverComposeSmsBody(body, true).length);
    // TWO segments, not the one the loose guard reported.
    expect(est.segmentsPerRecipient).toBe(2);
    expect(est.totalSegments).toBe(2000);
    expect(est.estimatedCostMinor).toBe(2000);
  });

  it("L7b — a body with an iOS smart apostrophe is costed as GSM-7, not UCS-2", () => {
    const entry = CORPUS.entries.find((e) => e.id === "smart-apostrophe-boundary");
    expect(entry).toBeDefined();
    const body = (entry as CorpusEntry).body;
    // The raw body is NOT GSM-7 — the curly apostrophe is what fooled the old
    // estimator into UCS-2 and a 3-segment quote.
    expect(body).toContain("’");
    const est = estimateSmsCost(body, 1000);
    expect(est.encoding).toBe("GSM-7");
    expect(est.charCount).toBe(160);
    expect(est.segmentsPerRecipient).toBe(1); // was 3 before D1
    expect(est.totalSegments).toBe(1000);
    expect(est.estimatedCostMinor).toBe(1000); // was ~3000: a 3x over-quote
  });

  // -------------------------------------------------------------------------
  // L8 — THE SANITIZER, CODEPOINT BY CODEPOINT. The corpus proves agreement on
  // bodies someone thought to write down; this proves agreement on every
  // codepoint either side touches — including the three INVISIBLE space
  // characters that cannot be verified by reading the source.
  // -------------------------------------------------------------------------
  it("L8 — the client and server GSM-7 sanitizers agree on every codepoint", () => {
    const ranges: Array<[number, number]> = [
      [0x0020, 0x007f],
      [0x00a0, 0x00ff],
      [0x2000, 0x206f],
    ];
    let swept = 0;
    let folded = 0;
    for (const [lo, hi] of ranges) {
      for (let cp = lo; cp <= hi; cp++) {
        const ch = String.fromCodePoint(cp);
        const server = serverSanitizeGsm7(ch);
        expect({
          cp: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
          out: clientSanitizeGsm7(ch),
        }).toEqual({
          cp: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
          out: server,
        });
        if (server !== ch) folded++;
        swept++;
      }
    }
    // Vacuity: two do-nothing sanitizers would agree trivially.
    expect(swept).toBeGreaterThan(300);
    expect(folded).toBe(18);
  });

  // -------------------------------------------------------------------------
  // L9 — sanitization is applied to MEASUREMENT, not to what the composer
  // DISPLAYS. A brand's typed apostrophe is never silently rewritten in their
  // own draft — that is a product decision (#1556), deliberately not taken.
  // -------------------------------------------------------------------------
  it("L9 — bodyWithFooter preserves the author's characters; only wireBody folds them", () => {
    const typed = "Don’t miss it — tonight…";
    const displayed = bodyWithFooter(typed);
    expect(displayed).toContain("’");
    expect(displayed).toContain("—");
    expect(displayed).toContain("…");
    const measured = wireBody(typed);
    expect(measured).not.toContain("’");
    expect(measured).not.toContain("—");
    expect(measured).not.toContain("…");
    expect(measured).toBe(serverComposeSmsBody(typed, true));
  });
});

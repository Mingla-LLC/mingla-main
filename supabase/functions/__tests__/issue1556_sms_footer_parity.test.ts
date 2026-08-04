// Issue #1556 — the SMS composer's cost preview must measure the bytes the
// adapter actually transmits. Cross-runtime drift guard.
//
// ===========================================================================
// WHY THIS FILE EXISTS — TWO DEFECTS, ONE ROOT CAUSE
// ===========================================================================
// `smsCost.ts` exists to mirror the server adapter so the composer can quote an
// honest segment count and campaign cost before send. It had drifted from that
// adapter in BOTH directions at once:
//
//   1. FOOTER SUPPRESSION (the filed issue). #1541 end-anchored the STOP-footer
//      guard in `composeSmsBody`; the client mirror kept the loose
//      `/reply stop/i`. For any body that MENTIONS the phrase without ENDING in
//      the footer the preview scored a body 24 characters shorter than the wire
//      and UNDER-reported — by a whole segment across the 153/160 and 67/70
//      boundaries.
//
//   2. GSM-7 SANITIZATION (#1556 D1, folded in by the orchestrator). The
//      adapter runs `sanitizeGsm7()` before transmitting; the client did not.
//      An iOS keyboard auto-substitutes a curly apostrophe, so "Don't miss it"
//      was scored UCS-2 (70 chars/segment) while the wire ships GSM-7 (160) —
//      an OVER-report of roughly 2.3x on ordinary copy. Rarer under-report,
//      everyday over-report, same function, same cause: a mirror that was only
//      ever held together by a comment claiming it was byte-identical.
//
// The two rules live in different runtimes (Deno edge vs the RN/web business
// app), which is exactly why they drifted and why nothing caught it.
//
// ===========================================================================
// THIS TEST DRIVES BOTH REAL IMPLEMENTATIONS IN ONE PROCESS
// ===========================================================================
// It imports the SHIPPED server module (`composeSmsBody` — the function
// `marketing-send/index.ts` calls with stopFooterOwnLine:true — plus that
// module's own `sanitizeGsm7` and `computeSegments`) AND the SHIPPED client
// module, and executes both over ONE shared corpus. `smsCost.ts` is a pure,
// import-free TS module, so it loads directly under Deno. Nothing here is a
// source grep and nothing is a hand-mirrored expectation: every server
// expectation is computed by RUNNING the server.
//
// The corpus is a JSON fixture read from disk, and the Jest twin
// (`mingla-business/src/utils/__tests__/smsCost.issue1556.test.ts`) reads THE
// SAME FILE. One corpus, two runtimes.
//
// ===========================================================================
// FAILS-ON-REVERT
// ===========================================================================
// Footer half — restore `if (/reply stop/i.test(body)) return body;` and the
// `body.length === 0 ? body :` short-circuit: L1/L2/L4/L5/L6 fail on the
// mid-body-mention, boundary, footer-then-more-text and empty bodies.
// Sanitizer half — make `wireBody` return `bodyWithFooter(message)` unsanitized
// (or drop any one character class from the client's `sanitizeGsm7`): L2 fails
// byte equality, L3 reports UCS-2 segment counts for GSM-7 traffic, L4 fails on
// `smart-apostrophe-boundary` with 3 segments where 1 bills, and L7's codepoint
// sweep fails naming the exact codepoints that stopped folding.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

// SERVER — the shipped wire composer.
import {
  composeSmsBody,
  computeSegments as serverComputeSegments,
  sanitizeGsm7 as serverSanitizeGsm7,
} from "../_shared/adapters/smsAdapter.ts";
// CLIENT — the shipped preview composer.
import {
  bodyWithFooter,
  computeSegments as clientComputeSegments,
  sanitizeGsm7 as clientSanitizeGsm7,
  wireBody,
} from "../../../mingla-business/src/utils/smsCost.ts";

interface CorpusEntry {
  id: string;
  body: string;
  why: string;
  expect?: { clientAppends: boolean; wireLength: number; wireSegments: number };
}
interface Corpus {
  issue: number;
  footer: string;
  marketingSeparator: string;
  transactionalSeparator: string;
  entries: CorpusEntry[];
}

const CORPUS: Corpus = JSON.parse(
  Deno.readTextFileSync(
    new URL("./fixtures/issue1556_sms_footer_corpus.json", import.meta.url),
  ),
);

// Did this side append a footer? Derived by RUNNING each implementation and
// comparing against what that implementation returns when it suppresses. No
// regex is re-stated here.
const clientAppends = (body: string): boolean =>
  bodyWithFooter(body) !== body.trim();
const serverAppends = (body: string, ownLine: boolean): boolean =>
  composeSmsBody(body, ownLine) !== serverSanitizeGsm7(body.trim());

const REQUIRED_IDS = [
  // footer-suppression cases
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
  // sanitizer (D1) cases
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

// ---------------------------------------------------------------------------
// L0 — vacuity guard. Discovering zero (or a quietly narrowed) corpus is a
// FAILURE, never a pass.
// ---------------------------------------------------------------------------
Deno.test("#1556 L0 — the shared corpus is present and still carries every adversarial case", () => {
  assertEquals(CORPUS.issue, 1556);
  assertEquals(CORPUS.footer, "Reply STOP to opt out.");
  assertEquals(CORPUS.marketingSeparator, "\n\n");
  assertEquals(CORPUS.transactionalSeparator, " ");
  assert(
    CORPUS.entries.length >= 29,
    `corpus shrank to ${CORPUS.entries.length} entries — it may only grow`,
  );
  const ids = new Set(CORPUS.entries.map((e) => e.id));
  for (const required of REQUIRED_IDS) {
    assert(ids.has(required), `corpus lost the '${required}' case`);
  }
  assertEquals(ids.size, CORPUS.entries.length, "duplicate corpus ids");
});

// ---------------------------------------------------------------------------
// L1 — THE FOOTER DRIFT LAW. Client and server must make the SAME suppression
// decision for every body in the corpus.
// ---------------------------------------------------------------------------
Deno.test("#1556 L1 — client and server agree on footer suppression for every corpus body", () => {
  for (const e of CORPUS.entries) {
    assertEquals(
      clientAppends(e.body),
      serverAppends(e.body, true),
      `DRIFT on '${e.id}' (${e.why})\n  client: ${JSON.stringify(bodyWithFooter(e.body))}\n  server: ${JSON.stringify(composeSmsBody(e.body, true))}`,
    );
  }
});

// ---------------------------------------------------------------------------
// L2 — BYTE EQUALITY, no caveats. The client's `wireBody` must equal the
// adapter's transmitted body exactly. (Before D1 this law could only be stated
// "modulo sanitizeGsm7"; the client now runs the sanitizer, so the modulo is
// gone. If you find yourself weakening this assertion, that IS the drift.)
// ---------------------------------------------------------------------------
Deno.test("#1556 L2 — the client's wire body IS the adapter's wire body, byte for byte", () => {
  for (const e of CORPUS.entries) {
    assertEquals(
      wireBody(e.body),
      composeSmsBody(e.body, true),
      `wire != preview for '${e.id}' (${e.why})`,
    );
  }
});

// ---------------------------------------------------------------------------
// L3 — segment parity over the WHOLE corpus. The user-visible defect in both
// directions: the composer's segment count must equal the count the adapter
// computes on the real wire body.
// ---------------------------------------------------------------------------
Deno.test("#1556 L3 — previewed segment count equals the wire segment count", () => {
  let checked = 0;
  for (const e of CORPUS.entries) {
    const wire = composeSmsBody(e.body, true);
    assertEquals(
      clientComputeSegments(wireBody(e.body)),
      serverComputeSegments(wire),
      `segment under/over-report on '${e.id}' (${e.why})`,
    );
    checked++;
  }
  assertEquals(checked, CORPUS.entries.length, "L3 must cover the whole corpus");
});

// ---------------------------------------------------------------------------
// L4 — the boundary bodies, pinned numerically. This is the misquote in the
// units that bill: `gsm7-boundary-137-mention` previewed as ONE segment and
// shipped as TWO; `smart-apostrophe-boundary` previewed as THREE and ships as
// ONE. Per recipient, across the whole audience.
// ---------------------------------------------------------------------------
Deno.test("#1556 L4 — segment-boundary bodies bill exactly what the preview shows", () => {
  let pinned = 0;
  for (const e of CORPUS.entries) {
    if (e.expect === undefined) continue;
    const wire = composeSmsBody(e.body, true);
    assertEquals(clientAppends(e.body), e.expect.clientAppends, `append decision for '${e.id}'`);
    assertEquals(wire.length, e.expect.wireLength, `wire length for '${e.id}'`);
    assertEquals(
      serverComputeSegments(wire),
      e.expect.wireSegments,
      `wire segments for '${e.id}'`,
    );
    assertEquals(
      clientComputeSegments(wireBody(e.body)),
      e.expect.wireSegments,
      `PREVIEW segments must equal BILLED segments for '${e.id}' (${e.why})`,
    );
    pinned++;
  }
  assertEquals(pinned, 8, "all eight boundary bodies must be pinned");
});

// ---------------------------------------------------------------------------
// L5 — BOTH adapter routes. #1556 warns against assuming one: the client
// mirrors the MARKETING (own-line) route, but the suppression DECISION is
// route-independent and must be. Only the separator differs.
// ---------------------------------------------------------------------------
Deno.test("#1556 L5 — suppression is route-independent; only the separator differs", () => {
  for (const e of CORPUS.entries) {
    const decision = clientAppends(e.body);
    assertEquals(
      serverAppends(e.body, false),
      decision,
      `transactional route disagrees on '${e.id}' (${e.why})`,
    );
    assertEquals(
      serverAppends(e.body, true),
      decision,
      `marketing route disagrees on '${e.id}' (${e.why})`,
    );
    if (!decision) continue;
    assert(
      composeSmsBody(e.body, false).endsWith(` ${CORPUS.footer}`),
      `transactional footer must be single-space for '${e.id}'`,
    );
    assert(
      composeSmsBody(e.body, true).endsWith(`\n\n${CORPUS.footer}`),
      `marketing footer must be own-line for '${e.id}'`,
    );
    assert(
      wireBody(e.body).endsWith(`\n\n${CORPUS.footer}`),
      `client wire body must mirror the MARKETING form for '${e.id}'`,
    );
  }
});

// ---------------------------------------------------------------------------
// L6 — parity survives re-composition.
//
// NOTE (a real shared property, not a drift): a body that trims to EMPTY is NOT
// a fixed point on either side. Both compose `"\n\nReply STOP to opt out."`, and
// the second pass trims the leading blank line. The server does exactly the
// same thing, so the two never disagree — which is what this law asserts. The
// fixed-point property itself is asserted only where it holds.
// ---------------------------------------------------------------------------
Deno.test("#1556 L6 — client and server stay in agreement under re-composition", () => {
  for (const e of CORPUS.entries) {
    assertEquals(
      wireBody(wireBody(e.body)),
      composeSmsBody(composeSmsBody(e.body, true), true),
      `re-composition diverges on '${e.id}' (${e.why})`,
    );
    if (e.body.trim().length === 0) continue;
    const preview = wireBody(e.body);
    assertEquals(wireBody(preview), preview, `client not a fixed point on '${e.id}'`);
    const marketing = composeSmsBody(e.body, true);
    assertEquals(composeSmsBody(marketing, true), marketing, `server(marketing) not a fixed point on '${e.id}'`);
    const txn = composeSmsBody(e.body, false);
    assertEquals(composeSmsBody(txn, false), txn, `server(transactional) not a fixed point on '${e.id}'`);
  }
});

// ---------------------------------------------------------------------------
// L7 — THE SANITIZER, CODEPOINT BY CODEPOINT (#1556 D1).
//
// The corpus proves the sanitizers agree on the bodies someone thought to write
// down. This proves they agree on every codepoint either one touches —
// including the three INVISIBLE space characters (U+00A0, U+2007, U+202F) that
// cannot be verified by reading the source, which is precisely how a
// hand-copied character class drifts. Drop one character from either side's
// class and this fails naming the exact codepoint.
// ---------------------------------------------------------------------------
Deno.test("#1556 L7 — the client and server GSM-7 sanitizers agree on every codepoint", () => {
  const ranges: Array<[number, number]> = [
    [0x0020, 0x007f], // ASCII
    [0x00a0, 0x00ff], // Latin-1 supplement (incl. NBSP)
    [0x2000, 0x206f], // General Punctuation: curly quotes, dashes, ellipsis,
    //                   bullet, primes, U+2007, U+202F
  ];
  let swept = 0;
  let folded = 0;
  for (const [lo, hi] of ranges) {
    for (let cp = lo; cp <= hi; cp++) {
      const ch = String.fromCodePoint(cp);
      const client = clientSanitizeGsm7(ch);
      const server = serverSanitizeGsm7(ch);
      assertEquals(
        client,
        server,
        `sanitizer drift at U+${cp.toString(16).toUpperCase().padStart(4, "0")}: client ${JSON.stringify(client)} vs server ${JSON.stringify(server)}`,
      );
      if (server !== ch) folded++;
      swept++;
    }
  }
  // Vacuity: a sweep that folded NOTHING would pass trivially against two
  // do-nothing sanitizers. The adapter maps 18 codepoints (5 single quotes,
  // 5 double, 3 dashes, 1 ellipsis, 3 spaces, 1 bullet).
  assert(swept > 300, `sweep covered only ${swept} codepoints`);
  assertEquals(folded, 18, `expected 18 folded codepoints, saw ${folded}`);
});

// ---------------------------------------------------------------------------
// L8 — the client's sanitizer is applied to MEASUREMENT, not to what the
// composer DISPLAYS. `bodyWithFooter` must stay unsanitized so a brand's typed
// apostrophe is never silently rewritten in their own draft (see #1556 — that
// is a product decision, deliberately not taken here).
// ---------------------------------------------------------------------------
Deno.test("#1556 L8 — bodyWithFooter preserves the author's characters; only wireBody folds them", () => {
  const typed = "Don’t miss it — tonight…";
  const displayed = bodyWithFooter(typed);
  assert(displayed.includes("’"), "the displayed body must keep the author's smart apostrophe");
  assert(displayed.includes("—"), "the displayed body must keep the author's em dash");
  assert(displayed.includes("…"), "the displayed body must keep the author's ellipsis");
  const measured = wireBody(typed);
  assert(
    !measured.includes("’") && !measured.includes("—") && !measured.includes("…"),
    "the measured wire body must carry NONE of them",
  );
  // And the measured body is exactly what the adapter will transmit.
  assertEquals(measured, composeSmsBody(typed, true));
});

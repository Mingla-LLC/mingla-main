// Issue #1556 — STOP-footer suppression must not drift between the SERVER
// adapter and the CLIENT composer cost preview.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// #1541 end-anchored the suppression guard in `composeSmsBody`. The client
// mirror in `mingla-business/src/utils/smsCost.ts` kept the old loose
// `/reply stop/i`, so for any body that MENTIONS the phrase without ENDING in
// the footer the preview scored a body 24 characters shorter than the wire and
// UNDER-REPORTED segments and campaign cost — by a whole segment across the
// 153/160 (GSM-7) and 67/70 (UCS-2) boundaries.
//
// The two rules live in different runtimes (Deno edge vs the RN/web business
// app), which is exactly why they drifted, and the only thing holding them
// together was a comment asserting they were "kept byte-identical" — a claim
// that was true when written and silently stopped being true. That failure
// family is #1553.
//
// ===========================================================================
// THIS TEST DRIVES BOTH REAL IMPLEMENTATIONS IN ONE PROCESS
// ===========================================================================
// It imports the SHIPPED server module (`composeSmsBody`, the function
// `marketing-send/index.ts` calls with stopFooterOwnLine:true) AND the SHIPPED
// client module (`bodyWithFooter`, what SmsComposeCard / SmsPreviewPane /
// compose.tsx render) and executes both over ONE shared corpus. `smsCost.ts`
// is a pure, import-free TS module, so it loads directly under Deno — the same
// crossing `orch_1289_stop_footer_wire_preview_parity.tester.test.ts` already
// makes. Nothing here is a source grep and nothing is a hand-mirrored
// expectation: every server expectation is computed by RUNNING the server.
//
// The corpus is a JSON fixture read from disk, and the Jest twin
// (`mingla-business/src/utils/__tests__/smsCost.issue1556.test.ts`) reads THE
// SAME FILE. One corpus, two runtimes — adding an adversarial case covers both
// sides at once and neither can quietly narrow it.
//
// ===========================================================================
// FAILS-ON-REVERT
// ===========================================================================
// Restore `if (/reply stop/i.test(body)) return body;` (and the
// `body.length === 0 ? body :` empty short-circuit) in smsCost.ts and:
//   - L1 fails on `mid-body-mention`, `mid-body-mention-prose`,
//     `mid-body-mention-uppercase`, `footer-then-more-text`, both GSM-7 and
//     both UCS-2 boundary bodies, `smart-punctuation-mention`, `empty` and
//     `whitespace-only` — the client suppresses where the server appends;
//   - L2 fails byte-equality on the same entries;
//   - L4 fails with the exact under-report: 1 segment previewed, 2 billed.
// A guard that still passes against the loose rule is not a guard.
//
// KNOWN GAP, kept visible rather than papered over (reported on #1556, not
// fixed here): the adapter also runs `sanitizeGsm7()` over the composed body;
// the client does not. So a body typed with an iOS smart apostrophe is scored
// UCS-2 (70/seg) client-side while the wire ships GSM-7 (160/seg) — the
// INVERSE error, an over-report. L2 therefore asserts equality MODULO that
// sanitizer, and L3 (segment parity) is scoped to sanitizer-clean bodies with
// the sensitive entry flagged in the fixture. When that second divergence is
// closed, drop the `sanitizerSensitive` flag and L3 covers the whole corpus.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

// SERVER — the shipped wire composer.
import {
  composeSmsBody,
  computeSegments as serverComputeSegments,
  sanitizeGsm7,
} from "../_shared/adapters/smsAdapter.ts";
// CLIENT — the shipped preview composer.
import {
  bodyWithFooter,
  computeSegments as clientComputeSegments,
} from "../../../mingla-business/src/utils/smsCost.ts";

interface CorpusEntry {
  id: string;
  body: string;
  why: string;
  sanitizerSensitive?: boolean;
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
// comparing against what that implementation returns when it suppresses:
// the client returns the trimmed body, the server returns the sanitized
// trimmed body. No regex is re-stated here.
const clientAppends = (body: string): boolean =>
  bodyWithFooter(body) !== body.trim();
const serverAppends = (body: string, ownLine: boolean): boolean =>
  composeSmsBody(body, ownLine) !== sanitizeGsm7(body.trim());

// ---------------------------------------------------------------------------
// L0 — vacuity guard. Discovering zero (or a quietly narrowed) corpus is a
// FAILURE, never a pass. Every adversarial case #1556 names is required by id.
// ---------------------------------------------------------------------------
Deno.test("#1556 L0 — the shared corpus is present and still carries every adversarial case", () => {
  assertEquals(CORPUS.issue, 1556);
  assertEquals(CORPUS.footer, "Reply STOP to opt out.");
  assertEquals(CORPUS.marketingSeparator, "\n\n");
  assertEquals(CORPUS.transactionalSeparator, " ");
  assert(
    CORPUS.entries.length >= 20,
    `corpus shrank to ${CORPUS.entries.length} entries — it may only grow`,
  );
  const ids = new Set(CORPUS.entries.map((e) => e.id));
  for (
    const required of [
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
    ]
  ) {
    assert(ids.has(required), `corpus lost the '${required}' case`);
  }
  assertEquals(ids.size, CORPUS.entries.length, "duplicate corpus ids");
});

// ---------------------------------------------------------------------------
// L1 — THE DRIFT LAW. Client and server must make the SAME footer-suppression
// decision for every body in the corpus. This is the assertion #1556 exists to
// add: it is false on the loose guard and true on the end-anchored one.
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
// L2 — byte equality, modulo the server's GSM-7 sanitizer (see KNOWN GAP).
// Stronger than L1: catches separator drift and trim/order drift too.
// ---------------------------------------------------------------------------
Deno.test("#1556 L2 — the wire body equals the preview body, byte for byte, modulo sanitizeGsm7", () => {
  for (const e of CORPUS.entries) {
    assertEquals(
      composeSmsBody(e.body, true),
      sanitizeGsm7(bodyWithFooter(e.body)),
      `wire != preview for '${e.id}' (${e.why})`,
    );
  }
});

// ---------------------------------------------------------------------------
// L3 — segment parity. The actual user-visible defect: the composer's segment
// count must equal the count the adapter computes on the real wire body.
// Scoped to sanitizer-clean bodies while the KNOWN GAP above is open.
// ---------------------------------------------------------------------------
Deno.test("#1556 L3 — previewed segment count equals the wire segment count", () => {
  let checked = 0;
  for (const e of CORPUS.entries) {
    if (e.sanitizerSensitive === true) continue;
    const wire = composeSmsBody(e.body, true);
    assertEquals(
      clientComputeSegments(bodyWithFooter(e.body)),
      serverComputeSegments(wire),
      `segment under/over-report on '${e.id}' (${e.why})`,
    );
    checked++;
  }
  assert(checked >= 19, `L3 covered only ${checked} bodies — corpus narrowed`);
});

// ---------------------------------------------------------------------------
// L4 — the boundary bodies, pinned numerically. This is the under-report in
// the units that bill: on the loose guard `gsm7-boundary-137-mention` previews
// as ONE segment and ships as TWO, per recipient, across the whole audience.
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
      clientComputeSegments(bodyWithFooter(e.body)),
      e.expect.wireSegments,
      `PREVIEW segments must equal BILLED segments for '${e.id}' (${e.why})`,
    );
    pinned++;
  }
  assertEquals(pinned, 6, "all six boundary bodies must be pinned");
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
    // When a footer IS appended the two routes differ in separator ONLY, and
    // the client mirrors the marketing one.
    assert(
      composeSmsBody(e.body, false).endsWith(` ${CORPUS.footer}`),
      `transactional footer must be single-space for '${e.id}'`,
    );
    assert(
      composeSmsBody(e.body, true).endsWith(`\n\n${CORPUS.footer}`),
      `marketing footer must be own-line for '${e.id}'`,
    );
    assert(
      bodyWithFooter(e.body).endsWith(`\n\n${CORPUS.footer}`),
      `client preview must mirror the MARKETING form for '${e.id}'`,
    );
  }
});

// ---------------------------------------------------------------------------
// L6 — parity survives re-composition. Running either composer over its own
// output must keep the two sides in agreement.
//
// NOTE (a real shared property, not a drift): a body that trims to EMPTY is
// NOT a fixed point on either side. Both compose `"\n\nReply STOP to opt out."`,
// and the second pass trims the leading blank line to `"Reply STOP to opt
// out."`. The server does exactly the same thing, so the two never disagree —
// which is precisely what this law asserts. The fixed-point property itself is
// asserted only where it actually holds (trim-non-empty bodies).
// ---------------------------------------------------------------------------
Deno.test("#1556 L6 — client and server stay in agreement under re-composition", () => {
  for (const e of CORPUS.entries) {
    assertEquals(
      composeSmsBody(composeSmsBody(e.body, true), true),
      sanitizeGsm7(bodyWithFooter(bodyWithFooter(e.body))),
      `re-composition diverges on '${e.id}' (${e.why})`,
    );
    if (e.body.trim().length === 0) continue;
    const preview = bodyWithFooter(e.body);
    assertEquals(bodyWithFooter(preview), preview, `client not a fixed point on '${e.id}'`);
    const marketing = composeSmsBody(e.body, true);
    assertEquals(composeSmsBody(marketing, true), marketing, `server(marketing) not a fixed point on '${e.id}'`);
    const txn = composeSmsBody(e.body, false);
    assertEquals(composeSmsBody(txn, false), txn, `server(transactional) not a fixed point on '${e.id}'`);
  }
});

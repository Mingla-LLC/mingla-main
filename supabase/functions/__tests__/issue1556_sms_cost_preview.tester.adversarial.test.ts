// ===========================================================================
// #1556 [sms cost preview] — TESTER ADVERSARIAL SUITE
// ===========================================================================
// Independent of the implementor's `issue1556_sms_footer_parity.test.ts`, and
// deliberately attacking from a DIFFERENT ANGLE. That suite drives both shipped
// implementations over a 29-body corpus someone thought to write down. Its
// weakness is definitional: a hand-authored corpus can only contain the cases
// its author imagined, and both prior issues in this chain (#1541, #1553)
// shipped a guard that agreed with a corpus while disagreeing with reality.
//
// So this suite never reads that corpus. It attacks with:
//
//   ADV-1  an INDEPENDENT GSM 03.38 encoder, written from the standard rather
//          than from either Mingla implementation, swept across every length
//          either encoding can take.
//   ADV-2  the EXTENDED-TABLE septet gap — a real residual under-report that
//          survives #1556, pinned as a KNOWN GAP so it cannot be forgotten.
//   ADV-3  a FULL-BMP sanitizer sweep (63,488 non-surrogate codepoints) whose
//          expected fold set is DERIVED BY RUNNING THE SERVER, never hardcoded.
//   ADV-4  a seeded DIFFERENTIAL FUZZ over 3,000 generated bodies — the case
//          nobody wrote down.
//   ADV-5  the DISPLAY contract, including the empty-body law that closed
//          T-1556-EMPTY-DISPLAY.
//   ADV-6  proof that the function these suites test is the function that
//          actually ships.
//   ADV-7  the empty-draft render guard, asserted so it cannot be satisfied by
//          a DUPLICATE ungated render — the one shape #1556 L9 lets through.
//
// Every group carries a vacuity guard: a group that examined nothing FAILS.
// A check that can pass by matching nothing is the failure family this whole
// chain exists to close.
// ===========================================================================

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

// SERVER — the shipped wire composer.
import {
  composeSmsBody,
  computeSegments as serverComputeSegments,
  sanitizeGsm7 as serverSanitizeGsm7,
} from "../_shared/adapters/smsAdapter.ts";
// CLIENT — the shipped preview/estimate module.
import {
  bodyWithFooter,
  computeSegments as clientComputeSegments,
  estimateSmsCost,
  sanitizeGsm7 as clientSanitizeGsm7,
  wireBody,
} from "../../../mingla-business/src/utils/smsCost.ts";

// ---------------------------------------------------------------------------
// An INDEPENDENT reference encoder. Transcribed from GSM 03.38 + 3GPP TS 23.040
// concatenation rules, NOT copied from either implementation under test — the
// whole point is that it can disagree with both.
//
//   - basic-table character   -> 1 septet
//   - extended-table character-> 2 septets (ESC 0x1B + the character)
//   - single segment          -> 160 septets; concatenated -> 153 (UDH costs 7)
//   - UCS-2                   -> UTF-16 code units; 70 single / 67 concatenated
// ---------------------------------------------------------------------------
const REF_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const REF_EXT = "^{}\\[~]|€";

function refIsGsm7(text: string): boolean {
  for (const ch of text) {
    if (REF_BASIC.indexOf(ch) === -1 && REF_EXT.indexOf(ch) === -1) return false;
  }
  return true;
}

/** TRUE septet cost — the unit a GSM carrier actually bills. */
function refSeptets(text: string): number {
  let n = 0;
  for (const ch of text) n += REF_EXT.indexOf(ch) !== -1 ? 2 : 1;
  return n;
}

/** TRUE segment count. */
function refSegments(text: string): number {
  if (refIsGsm7(text)) {
    const s = refSeptets(text);
    return s <= 160 ? 1 : Math.ceil(s / 153);
  }
  const units = text.length; // UTF-16 code units — correct for UCS-2
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

// ===========================================================================
// ADV-1 — THE SEGMENT ARITHMETIC IS RIGHT, judged by an encoder that is not
// either implementation.
//
// #1556 makes the preview measure the same BYTES as the wire. That is only half
// of "the quote is honest": the two can agree perfectly and still both be wrong
// about how many segments those bytes cost. This sweeps every length across
// both encodings and both boundary families (160/153 and 70/67) and checks the
// shipped counters against the reference.
// ===========================================================================
Deno.test("#1556 ADV-1 — client and server segment counts match an INDEPENDENT GSM 03.38 encoder across every length", () => {
  let checked = 0;
  let multiSegmentSeen = 0;
  let ucs2Seen = 0;

  // GSM-7, basic table only — 'a' is a basic-table character.
  for (let n = 1; n <= 500; n++) {
    const body = "a".repeat(n);
    const ref = refSegments(body);
    assertEquals(
      clientComputeSegments(body),
      ref,
      `CLIENT segment count wrong for a ${n}-char GSM-7 body (reference says ${ref})`,
    );
    assertEquals(
      serverComputeSegments(body),
      ref,
      `SERVER segment count wrong for a ${n}-char GSM-7 body (reference says ${ref})`,
    );
    if (ref > 1) multiSegmentSeen++;
    checked++;
  }

  // UCS-2 — 'ж' is outside GSM-7 entirely, so the whole body is UCS-2.
  for (let n = 1; n <= 300; n++) {
    const body = "ж".repeat(n);
    const ref = refSegments(body);
    assertEquals(
      clientComputeSegments(body),
      ref,
      `CLIENT segment count wrong for a ${n}-char UCS-2 body (reference says ${ref})`,
    );
    assertEquals(
      serverComputeSegments(body),
      ref,
      `SERVER segment count wrong for a ${n}-char UCS-2 body (reference says ${ref})`,
    );
    if (ref > 1) multiSegmentSeen++;
    ucs2Seen++;
    checked++;
  }

  // Vacuity: a sweep that never crossed a boundary, or never exercised UCS-2,
  // proves nothing about boundaries or encodings.
  // (GSM-7 lengths 161..500 = 340 multi-segment; UCS-2 lengths 71..300 = 230.)
  assertEquals(checked, 800, "ADV-1 must sweep all 800 lengths");
  assertEquals(multiSegmentSeen, 570, `only ${multiSegmentSeen} multi-segment cases`);
  assertEquals(ucs2Seen, 300, `only ${ucs2Seen} UCS-2 cases`);
});

// ===========================================================================
// ADV-2 — KNOWN GAP T-1556-EXT-SEPTETS (tester finding, P2).
//
// The GSM-7 EXTENDED table (`^ { } \ [ ~ ] | €`) costs TWO septets per
// character: an escape byte plus the character. Both implementations count
// `text.length`, so a body carrying extended characters is quoted SHORT — the
// same direction, and for boundary bodies the same magnitude, as the defect
// this issue was filed for. The server acknowledges the approximation in a
// comment ("the dispatcher only needs cost observability, not billing
// precision"); the CLIENT is a money quote shown to a brand, where it is not
// merely observability.
//
// This is PRE-EXISTING and PARITY-PRESERVING: client and server are wrong
// together, so #1556's wire-parity contract still holds. It is pinned here
// rather than left as prose so it cannot rot into folklore.
//
// WHAT WOULD CLOSE IT: count septets (extended = 2) instead of `.length` in
// BOTH `computeSegments` implementations, then flip the assertions below.
// ===========================================================================
Deno.test("#1556 ADV-2 PIN: extended-table characters cost two septets and BOTH sides under-count (KNOWN GAP)", () => {
  // Deliberately shaped like the corpus's `smart-apostrophe-boundary`: a typed
  // body whose WIRE form lands exactly on 160 UTF-16 units. The footer adds 24
  // ("\n\n" + 22), so the typed body is 136 characters, one of them a '€'.
  const typed = "a".repeat(135) + "€";
  assertEquals(typed.length, 136);

  const wire = wireBody(typed);
  assertEquals(wire, composeSmsBody(typed, true), "wire parity must hold here too");
  assertEquals(wire.length, 160, "the wire body is exactly 160 UTF-16 units");
  // ...but 161 SEPTETS, because the '€' carries an escape byte.
  assertEquals(refSeptets(wire), 161);
  assertEquals(refSegments(wire), 2, "the carrier bills TWO segments");

  // PARITY (the #1556 contract) still holds — the two agree with each other.
  assertEquals(
    clientComputeSegments(wire),
    serverComputeSegments(composeSmsBody(typed, true)),
    "REGRESSION: client and server disagree on an extended-table body — that IS #1556 drift",
  );

  // ...and they are BOTH wrong against the carrier. When this assertion starts
  // failing, the septet fix has landed: delete this pin and close
  // T-1556-EXT-SEPTETS.
  assertEquals(
    clientComputeSegments(wire),
    1,
    "PIN BROKEN (good news): the composer now counts extended-table septets. " +
      "Verify it matches refSegments(), delete this pin, and close T-1556-EXT-SEPTETS.",
  );
  assertNotEquals(
    clientComputeSegments(wire),
    refSegments(wire),
    "the gap this pin documents is closed — see the message above",
  );

  // The commercial shape of the gap, in the units a brand reads: half the bill.
  const est = estimateSmsCost(typed, 1000);
  assertEquals(est.encoding, "GSM-7");
  assertEquals(est.segmentsPerRecipient, 1);
  assertEquals(est.totalSegments, 1000, "quoted 1,000 segments against 2,000 billed");
});

// ===========================================================================
// ADV-3 — THE SANITIZERS AGREE ON THE WHOLE BASIC MULTILINGUAL PLANE.
//
// The implementor's sweep covers 336 codepoints in three hand-chosen ranges. A
// character folded by one side and NOT covered by those ranges would pass. This
// sweeps all 65,024 non-surrogate BMP codepoints, and — critically — derives
// the expected fold set BY RUNNING THE SERVER rather than hardcoding a count,
// so adding a codepoint to the SERVER alone is caught by identity, not by an
// arithmetic coincidence.
// ===========================================================================
Deno.test("#1556 ADV-3 — client and server sanitizers are identical across the entire BMP", () => {
  const serverFolds = new Map<number, string>();
  const clientFolds = new Map<number, string>();
  let swept = 0;

  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates are not characters
    const ch = String.fromCharCode(cp);
    const s = serverSanitizeGsm7(ch);
    const c = clientSanitizeGsm7(ch);
    assertEquals(
      c,
      s,
      `sanitizer drift at U+${cp.toString(16).toUpperCase().padStart(4, "0")}: ` +
        `client ${JSON.stringify(c)} vs server ${JSON.stringify(s)}`,
    );
    if (s !== ch) serverFolds.set(cp, s);
    if (c !== ch) clientFolds.set(cp, c);
    swept++;
  }

  // The fold SETS must be identical — not merely the same size. A codepoint
  // added to one side and a different one added to the other would keep the
  // counts equal; this refuses that.
  assertEquals(
    [...clientFolds.keys()].sort((a, b) => a - b),
    [...serverFolds.keys()].sort((a, b) => a - b),
    "the two sanitizers fold DIFFERENT codepoint sets",
  );

  // Vacuity: two do-nothing sanitizers agree trivially. Refuse that, and refuse
  // a sweep that silently narrowed.
  // 0x0000..0xFFFF is 65,536 codepoints; 0xD800..0xDFFF (2,048) are surrogates.
  assertEquals(swept, 63488, "the BMP sweep narrowed");
  assert(
    serverFolds.size >= 18,
    `only ${serverFolds.size} codepoints fold — the sanitizer has been gutted`,
  );
  // The classes the adapter documents must each be represented.
  for (const cp of [0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026, 0x00a0, 0x2007, 0x202f, 0x2022]) {
    assert(
      serverFolds.has(cp),
      `U+${cp.toString(16).toUpperCase()} is no longer folded by the adapter`,
    );
  }
  // And the fold targets must themselves be GSM-7-safe, or sanitizing achieves
  // nothing: folding into another non-GSM-7 character would still force UCS-2.
  for (const [cp, out] of serverFolds) {
    for (const ch of out) {
      assert(
        REF_BASIC.indexOf(ch) !== -1 || REF_EXT.indexOf(ch) !== -1,
        `U+${cp.toString(16).toUpperCase()} folds to ${JSON.stringify(out)}, which is NOT GSM-7`,
      );
    }
  }
});

// ===========================================================================
// ADV-4 — SEEDED DIFFERENTIAL FUZZ.
//
// The corpus contains the cases someone imagined. This generates 3,000 bodies
// nobody wrote down, from an alphabet chosen to hit every seam at once: GSM
// basic, GSM extended, every sanitizer-foldable class, footer fragments in
// mixed case, and trailing whitespace. Deterministic (fixed seed) so a failure
// is reproducible in CI.
//
// The law: whatever the body, the client's measured wire body IS the adapter's
// transmitted body, and the previewed segment count IS the billed one.
// ===========================================================================
Deno.test("#1556 ADV-4 — 3,000 fuzzed bodies: preview and wire never diverge", () => {
  // xorshift32 — a deterministic PRNG, so CI failures reproduce exactly.
  let seed = 0x1556c057;
  const rnd = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

  const ATOMS = [
    // GSM-7 basic
    "a", "Z", "7", " ", ".", "!", "\n", "é", "ü", "£",
    // GSM-7 extended (two septets each)
    "€", "[", "]", "{", "}", "~", "^", "|", "\\",
    // sanitizer-foldable — every documented class
    "‘", "’", "‚", "‛", "′",
    "“", "”", "„", "‟", "″",
    "–", "—", "―", "…",
    " ", " ", " ", "•",
    // outside GSM-7 entirely -> forces UCS-2
    "ж", "字",
    // footer fragments, mixed case — the #1556 suppression seam
    "Reply STOP to opt out.", "reply stop to opt out.", "Reply Stop",
    "reply stop to opt out", "Reply STOP to opt out. ",
  ];

  let appended = 0;
  let suppressed = 0;
  let folded = 0;
  let multiSegment = 0;
  let ucs2 = 0;

  for (let i = 0; i < 3000; i++) {
    const n = 1 + Math.floor(rnd() * 24);
    let body = "";
    for (let k = 0; k < n; k++) body += pick(ATOMS);
    if (rnd() < 0.15) body += "   ";
    if (rnd() < 0.1) body = "   " + body;

    // THE LAW: the measured body is the transmitted body, byte for byte.
    assertEquals(
      wireBody(body),
      composeSmsBody(body, true),
      `preview/wire divergence on fuzz case ${i}: ${JSON.stringify(body)}`,
    );
    // And the quote equals the bill.
    assertEquals(
      clientComputeSegments(wireBody(body)),
      serverComputeSegments(composeSmsBody(body, true)),
      `segment divergence on fuzz case ${i}: ${JSON.stringify(body)}`,
    );
    // Suppression is route-independent — only the separator may differ.
    const clientDecision = bodyWithFooter(body) !== body.trim();
    const serverTxn =
      composeSmsBody(body, false) !== serverSanitizeGsm7(body.trim());
    assertEquals(
      serverTxn,
      clientDecision,
      `suppression decision differs by route on fuzz case ${i}: ${JSON.stringify(body)}`,
    );

    if (clientDecision) appended++;
    else suppressed++;
    if (serverSanitizeGsm7(body) !== body) folded++;
    const w = wireBody(body);
    if (clientComputeSegments(w) > 1) multiSegment++;
    if (!refIsGsm7(w)) ucs2++;
  }

  // Vacuity: a fuzz run that only ever produced one shape of body proves one
  // shape of body. Every interesting class must actually have been generated.
  assert(appended > 200, `only ${appended} bodies gained a footer`);
  assert(suppressed > 20, `only ${suppressed} bodies had the footer suppressed`);
  assert(folded > 500, `only ${folded} bodies exercised the sanitizer`);
  assert(multiSegment > 100, `only ${multiSegment} bodies crossed a segment boundary`);
  assert(ucs2 > 100, `only ${ucs2} bodies were UCS-2`);
});

// ===========================================================================
// ADV-5 — WHAT THE COMPOSER DISPLAYS.
//
// #1556's contract is that only MEASUREMENT moved: a brand's typed apostrophe
// must never be rewritten inside their own draft.
//
// HISTORY, because the second assertion below looks like it is pinning a bug
// and is not. The first #1556 commit dropped `body.length === 0 ? body :` from
// `bodyWithFooter` to reach byte-exact parity with the adapter — correct for
// the wire, because `composeSmsBody` has no empty-body guard either. But
// `SmsPreviewPane` renders `bodyWithFooter(body)` directly and its empty guard
// was `body.trim().length === 0 && !hasMedia`, so a brand who attached a photo
// before typing fell through the media branch and saw a bare opt-out footer in
// an otherwise empty bubble. Tester finding T-1556-EMPTY-DISPLAY (P2), CLOSED
// at 877c5e6e0 by gating the bubble's body `Text` on `hasTypedBody` at the
// DISPLAY call site.
//
// So `bodyWithFooter("")` composing the footer is now the LAW, not the defect:
// it is what keeps the client in step with the adapter. Restoring a
// short-circuit inside `bodyWithFooter` to "fix" a preview would re-open the
// drift this issue closed, and the assertion below is what stops that. The
// display half is asserted separately, in ADV-7.
// ===========================================================================
Deno.test("#1556 ADV-5 — the author's own characters survive into the draft they see", () => {
  const typed = "Don’t miss it — doors 9pm…";
  const displayed = bodyWithFooter(typed);
  for (const ch of ["’", "—", "…"]) {
    assert(
      displayed.includes(ch),
      `the composer rewrote the author's ${JSON.stringify(ch)} in their own draft`,
    );
  }
  // ...while the measured body carries none of them, and IS the wire body.
  const measured = wireBody(typed);
  for (const ch of ["’", "—", "…"]) {
    assert(!measured.includes(ch), `the measured body kept ${JSON.stringify(ch)}`);
  }
  assertEquals(measured, composeSmsBody(typed, true));
});

Deno.test("#1556 ADV-5 — an empty draft still composes the footer, because the adapter does", () => {
  // The measurement path: an empty draft estimates zero, as the composer shows.
  const est = estimateSmsCost("", 250);
  assertEquals(est.charCount, 0, "an empty draft must still estimate zero");
  assertEquals(est.segmentsPerRecipient, 0);
  assertEquals(est.totalSegments, 0);
  assertEquals(est.estimatedCostMinor, 0);
  // MMS billing is likewise untouched: one message per recipient.
  const mms = estimateSmsCost("", 10, undefined, true);
  assertEquals(mms.encoding, "MMS");
  assertEquals(mms.totalSegments, 10);

  // THE LAW. `composeSmsBody` has no empty-body guard, so neither may
  // `bodyWithFooter`. If this starts failing, someone has "fixed" a preview by
  // short-circuiting the composer — which is the #1556 drift, reopened.
  assertEquals(
    bodyWithFooter(""),
    "\n\nReply STOP to opt out.",
    "REGRESSION: bodyWithFooter no longer mirrors the adapter on an empty body. " +
      "An empty draft is a UI state — gate it at the DISPLAY call site " +
      "(SmsPreviewPane, see ADV-7), never inside the composer.",
  );
  assertEquals(bodyWithFooter("   \n "), "\n\nReply STOP to opt out.");
  assertEquals(bodyWithFooter(""), composeSmsBody("", true));
  assertEquals(wireBody(""), composeSmsBody("", true));
});

// ===========================================================================
// ADV-6 — THE FUNCTION UNDER TEST IS THE FUNCTION THAT SHIPS.
//
// Both #1556 suites import `composeSmsBody` by NAME. Neither proves that
// `send()` — the only path to a provider — actually calls it. A refactor that
// left `composeSmsBody` in place as dead code while `send()` composed the body
// some other way would keep every parity assertion green while the wire quietly
// diverged from the preview: precisely the #1556 failure shape, one level up.
//
// The same hazard applies to the client: `estimateSmsCost` must measure
// `wireBody`, not `bodyWithFooter`, or the sanitizer half silently reverts.
// ===========================================================================
Deno.test("#1556 ADV-6 — send() composes via composeSmsBody, and the estimate measures wireBody", () => {
  const adapterSrc = Deno.readTextFileSync(
    new URL("../_shared/adapters/smsAdapter.ts", import.meta.url),
  );
  const clientSrc = Deno.readTextFileSync(
    new URL("../../../mingla-business/src/utils/smsCost.ts", import.meta.url),
  );

  // Vacuity: prove we actually read both modules before asserting about them.
  assert(adapterSrc.length > 5000, "adapter source did not load");
  assert(clientSrc.length > 1000, "client source did not load");

  // The single provider-bound composition in send().
  const sendCompose = adapterSrc.match(
    /const body = composeSmsBody\(\s*input\.message,\s*input\.stopFooterOwnLine === true,\s*\);/,
  );
  assert(
    sendCompose !== null,
    "send() no longer composes the wire body via composeSmsBody(input.message, input.stopFooterOwnLine === true) — " +
      "every #1556 parity assertion is now testing a function that may not ship.",
  );
  // ...and the segment count recorded on the delivery row is computed from it.
  assert(
    /const segments = computeSegments\(body\);/.test(adapterSrc),
    "send() no longer records segments from the composed body",
  );

  // The client's estimate must measure the SANITIZED wire body.
  assert(
    /const wire = message\.trim\(\)\.length === 0 \? "" : wireBody\(message\);/.test(
      clientSrc,
    ),
    "estimateSmsCost no longer measures wireBody() — the #1556 sanitizer fix has been reverted",
  );
  // And wireBody must be sanitizeGsm7 ∘ bodyWithFooter, in that order.
  assert(
    /export function wireBody\(message: string\): string \{\s*return sanitizeGsm7\(bodyWithFooter\(message\)\);\s*\}/
      .test(clientSrc),
    "wireBody is no longer sanitizeGsm7(bodyWithFooter(...))",
  );

  // Behavioural confirmation that the two really are the same rule: the marketing
  // route's own-line separator is what the client mirrors.
  const sample = "Doors 9pm";
  assertEquals(wireBody(sample), composeSmsBody(sample, true));
  assertNotEquals(wireBody(sample), composeSmsBody(sample, false));
});

// ===========================================================================
// ADV-7 — THE EMPTY-DRAFT RENDER GUARD, ASSERTED SO IT CANNOT BE DECORATED.
//
// #1556 L9 pins the display half of T-1556-EMPTY-DISPLAY with two source
// assertions: that `hasTypedBody` is computed, and that a `styles.bubbleText`
// Text appears inside a `{hasTypedBody ? (` gate. I attacked L9 from both
// directions it was designed for and it held:
//
//   - restore the short-circuit inside `bodyWithFooter` (fix the screen at the
//     wire's expense)      -> L9(a) FAILS
//   - delete the gate from the pane (keep the wire, re-break the screen)
//                          -> L9(b) FAILS
//
// It does NOT hold against a third shape: keep the gated Text and ADD a SECOND,
// UNGATED `styles.bubbleText` render of the same `wire`. Both of L9's regexes
// still match, L9 passes, and the bare footer is back on screen for a photo-only
// draft. Verified: with a duplicate ungated render added, L9 reports ok.
//
// A gate is only a gate if nothing renders around it. This closes that shape by
// asserting the body text is rendered EXACTLY ONCE and that the single
// occurrence sits inside the guard.
//
// HONEST CEILING, stated rather than implied: this is a source contract, not a
// mounted render. `mingla-business`'s default jest config carries no RN render
// libraries, so this component cannot be mounted in the suite that runs on every
// PR — the same ceiling `metaOrch1281SmsPreview.test.tsx` documents. Closing it
// properly needs a dedicated `jest.*.render.cjs` config and workflow; recorded
// as a tester finding rather than papered over.
// ===========================================================================
Deno.test("#1556 ADV-7 — the bubble body renders exactly once, inside the typed-body gate", () => {
  const paneSrc = Deno.readTextFileSync(
    new URL(
      "../../../mingla-business/src/components/marketing/SmsPreviewPane.tsx",
      import.meta.url,
    ),
  );

  // Vacuity: locate the render before asserting anything about it.
  assert(paneSrc.length > 500, "vacuity: SmsPreviewPane.tsx did not load");
  assert(
    paneSrc.includes("hasTypedBody"),
    "vacuity: the typed-body guard is gone entirely — re-derive this assertion",
  );

  // EXACTLY ONE body-text render. A second, ungated one re-opens
  // T-1556-EMPTY-DISPLAY while satisfying #1556 L9's regexes.
  const renders = paneSrc.match(/style=\{styles\.bubbleText\}/g) ?? [];
  assertEquals(
    renders.length,
    1,
    `the bubble body Text is rendered ${renders.length} times. A SECOND, ungated ` +
      `render re-opens T-1556-EMPTY-DISPLAY (a photo-only draft shows a bare STOP ` +
      `footer) while still satisfying #1556 L9 — which is why this law counts.`,
  );

  // ...and that single render is INSIDE the guard.
  assert(
    /\{hasTypedBody \? \(\s*<Text\s+style=\{styles\.bubbleText\}/.test(paneSrc),
    "REGRESSION (T-1556-EMPTY-DISPLAY): the bubble body Text is not gated on hasTypedBody",
  );
  assert(
    /const hasTypedBody = body\.trim\(\)\.length > 0;/.test(paneSrc),
    "the typed-body guard must key off the TRIMMED body, so a whitespace-only draft previews nothing",
  );

  // The guard must not have been bought by re-routing the pane: ORCH-1281 and
  // ORCH-1289 both require the bubble to render the COMPOSED body, footer and
  // all, once something is typed.
  assert(
    /const wire = bodyWithFooter\(body\);/.test(paneSrc),
    "the pane no longer previews bodyWithFooter(body) — ORCH-1281/1289 contract broken",
  );
  // And the composed body the pane shows is exactly what #1556 says it shows:
  // the author's characters, unfolded.
  assertEquals(bodyWithFooter("Don’t miss it"), "Don’t miss it\n\nReply STOP to opt out.");
});

/**
 * Issue #1556 — STOP-footer suppression parity, asserted from INSIDE the Jest
 * suite (the required business check).
 *
 * ===========================================================================
 * WHAT DRIFTED
 * ===========================================================================
 * #1541 end-anchored the suppression guard in the server adapter's
 * `composeSmsBody`. The client mirror here kept the loose `/reply stop/i`, so
 * a body that MENTIONS the phrase without ENDING in the footer was previewed
 * 24 characters shorter than it ships — UNDER-reporting segments and campaign
 * cost, by a whole segment across the 153/160 (GSM-7) and 67/70 (UCS-2)
 * boundaries.
 *
 * ===========================================================================
 * THIS TEST DRIVES BOTH IMPLEMENTATIONS — IT DOES NOT MIRROR THE SERVER
 * ===========================================================================
 * The server adapter is a Deno module (`.ts`-suffixed relative imports,
 * `Deno.env` in its transitive deps), so Jest cannot `import` it. Rather than
 * hand-copy a corpus of expected outputs — which is the very thing that
 * drifted — this test READS `smsAdapter.ts` off disk and EXECUTES the shipped
 * function BODIES of `composeSmsBody` and `sanitizeGsm7`, injecting their two
 * dependencies (`STOP_FOOTER`, `sanitizeGsm7`). Those bodies are pure JS (all
 * TypeScript annotations live in the signatures, which are not extracted), so
 * they run verbatim. Change the adapter's guard and THIS TEST CHANGES WITH IT
 * and fails — that is what makes it falsifiable rather than decorative.
 *
 * The corpus is the SAME JSON file the Deno twin reads
 * (`supabase/functions/__tests__/fixtures/issue1556_sms_footer_corpus.json`),
 * so one adversarial case added there covers both runtimes and neither side
 * can quietly narrow it.
 *
 * RESIDUAL LIMITATION, stated honestly: the extraction is STRUCTURAL. If the
 * adapter is refactored so the guard no longer lives inline in
 * `composeSmsBody` (moved to a helper, split across functions), extraction
 * fails and this test FAILS LOUDLY with an explicit message — it does not
 * silently pass. That is the intended direction: an unfalsifiable guard is
 * worse than none, and #1556 exists because a mirror drifted in silence. The
 * authority remains the Deno twin,
 * `supabase/functions/__tests__/issue1556_sms_footer_parity.test.ts`, which
 * imports both real modules natively.
 *
 * ===========================================================================
 * FAILS-ON-REVERT
 * ===========================================================================
 * Restore `if (/reply stop/i.test(body)) return body;` plus the
 * `body.length === 0 ? body :` short-circuit in smsCost.ts and L1/L2/L4 fail on
 * the mid-body-mention, boundary, footer-then-more-text and empty bodies.
 *
 * KNOWN GAP (reported on #1556, NOT fixed here): the adapter also runs
 * `sanitizeGsm7()` over the composed body and this module does not, so smart
 * punctuation is scored UCS-2 client-side while the wire ships GSM-7 — the
 * inverse error. L2 asserts equality modulo that sanitizer and L3 is scoped to
 * sanitizer-clean bodies, so the gap stays visible instead of papered over.
 */

import { readFileSync } from "fs";
import path from "path";

import { bodyWithFooter, computeSegments, estimateSmsCost } from "../smsCost";

const REPO_ROOT = path.join(__dirname, "../../../..");
const ADAPTER_PATH = path.join(
  REPO_ROOT,
  "supabase/functions/_shared/adapters/smsAdapter.ts",
);
const CORPUS_PATH = path.join(
  REPO_ROOT,
  "supabase/functions/__tests__/fixtures/issue1556_sms_footer_corpus.json",
);

const ADAPTER_SRC = readFileSync(ADAPTER_PATH, "utf8");

interface CorpusEntry {
  id: string;
  body: string;
  why: string;
  sanitizerSensitive?: boolean;
  expect?: { clientAppends: boolean; wireLength: number; wireSegments: number };
}
const CORPUS: {
  issue: number;
  footer: string;
  marketingSeparator: string;
  transactionalSeparator: string;
  entries: CorpusEntry[];
} = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));

/**
 * Extract the BODY of a top-level function from the adapter source by
 * brace-matching from its signature. Throws loudly (never returns a silent
 * empty string) so a refactor cannot make this suite vacuous.
 */
function extractFunctionBody(name: string): string {
  const sigIdx = ADAPTER_SRC.indexOf(`export function ${name}(`);
  if (sigIdx === -1) {
    throw new Error(
      `#1556 EXTRACTION FAILED: \`export function ${name}(\` is gone from ${ADAPTER_PATH}. ` +
        `The adapter was refactored — re-derive this test against the new shape. ` +
        `Do NOT delete the assertion; that is how #1556 happened.`,
    );
  }
  const open = ADAPTER_SRC.indexOf("{", sigIdx);
  if (open === -1) throw new Error(`#1556 EXTRACTION FAILED: no body for ${name}`);
  let depth = 0;
  for (let i = open; i < ADAPTER_SRC.length; i++) {
    const ch = ADAPTER_SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return ADAPTER_SRC.slice(open + 1, i);
    }
  }
  throw new Error(`#1556 EXTRACTION FAILED: unbalanced braces in ${name}`);
}

function extractStopFooter(): string {
  const m = ADAPTER_SRC.match(/const STOP_FOOTER = ("(?:[^"\\]|\\.)*");/);
  if (m === null) {
    throw new Error(
      "#1556 EXTRACTION FAILED: STOP_FOOTER literal not found in smsAdapter.ts",
    );
  }
  return JSON.parse(m[1]) as string;
}

const SERVER_STOP_FOOTER = extractStopFooter();

// The adapter's SHIPPED sanitizer body, executed here.
const serverSanitizeGsm7 = new Function(
  "input",
  extractFunctionBody("sanitizeGsm7"),
) as (input: string) => string;

// The adapter's SHIPPED composer body, executed here with its two deps injected.
const rawCompose = new Function(
  "message",
  "stopFooterOwnLine",
  "STOP_FOOTER",
  "sanitizeGsm7",
  extractFunctionBody("composeSmsBody"),
) as (
  message: string,
  ownLine: boolean,
  footer: string,
  sanitize: (s: string) => string,
) => string;

const serverComposeSmsBody = (message: string, ownLine = false): string =>
  rawCompose(message, ownLine, SERVER_STOP_FOOTER, serverSanitizeGsm7);

// Did each side append a footer? Derived by RUNNING each implementation and
// comparing against what it returns when it suppresses. No regex is re-stated.
const clientAppends = (body: string): boolean => bodyWithFooter(body) !== body.trim();
const serverAppends = (body: string, ownLine: boolean): boolean =>
  serverComposeSmsBody(body, ownLine) !== serverSanitizeGsm7(body.trim());

describe("#1556 — STOP-footer parity between smsCost.ts and the SMS adapter", () => {
  // -------------------------------------------------------------------------
  // L0 — vacuity guards. The extraction must have produced a WORKING server
  // composer, and the shared corpus must still carry every adversarial case.
  // Discovering nothing is a FAILURE, never a pass.
  // -------------------------------------------------------------------------
  it("L0a — the extracted server composer actually runs (canary)", () => {
    expect(SERVER_STOP_FOOTER).toBe("Reply STOP to opt out.");
    expect(serverSanitizeGsm7("don’t — wait…")).toBe("don't - wait...");
    expect(serverComposeSmsBody("Doors 8pm", true)).toBe(
      "Doors 8pm\n\nReply STOP to opt out.",
    );
    expect(serverComposeSmsBody("Doors 8pm", false)).toBe(
      "Doors 8pm Reply STOP to opt out.",
    );
  });

  it("L0b — the adapter's guard is still END-ANCHORED (#1541 not regressed)", () => {
    // Behavioural, not a grep: a mid-body mention must still receive a footer
    // on the SERVER. If this fails the reference itself moved — STOP, do not
    // "fix" the client to match.
    expect(serverAppends("Reply Stop plays tonight.", true)).toBe(true);
    expect(serverAppends("Doors 8pm. Reply STOP to opt out.", true)).toBe(false);
  });

  it("L0c — the shared corpus is present and still carries every adversarial case", () => {
    expect(CORPUS.issue).toBe(1556);
    expect(CORPUS.entries.length).toBeGreaterThanOrEqual(20);
    const ids = CORPUS.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of [
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
    ]) {
      expect(ids).toContain(required);
    }
  });

  // -------------------------------------------------------------------------
  // L1 — THE DRIFT LAW.
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
  // L2 — byte equality, modulo the server's GSM-7 sanitizer (KNOWN GAP).
  // -------------------------------------------------------------------------
  it("L2 — the wire body equals the preview body byte for byte, modulo sanitizeGsm7", () => {
    for (const e of CORPUS.entries) {
      expect({ id: e.id, wire: serverComposeSmsBody(e.body, true) }).toEqual({
        id: e.id,
        wire: serverSanitizeGsm7(bodyWithFooter(e.body)),
      });
    }
  });

  // -------------------------------------------------------------------------
  // L3 — segment parity: the composer's count must equal the wire's count.
  // Scoped to sanitizer-clean bodies while the KNOWN GAP is open.
  // -------------------------------------------------------------------------
  it("L3 — previewed segment count equals the wire segment count", () => {
    let checked = 0;
    for (const e of CORPUS.entries) {
      if (e.sanitizerSensitive === true) continue;
      expect({
        id: e.id,
        segments: computeSegments(bodyWithFooter(e.body)),
      }).toEqual({
        id: e.id,
        segments: computeSegments(serverComposeSmsBody(e.body, true)),
      });
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(19);
  });

  // -------------------------------------------------------------------------
  // L4 — the under-report in the units that bill.
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
      expect({ id: e.id, len: wire.length }).toEqual({
        id: e.id,
        len: e.expect.wireLength,
      });
      expect({ id: e.id, seg: computeSegments(wire) }).toEqual({
        id: e.id,
        seg: e.expect.wireSegments,
      });
      expect({ id: e.id, seg: computeSegments(bodyWithFooter(e.body)) }).toEqual({
        id: e.id,
        seg: e.expect.wireSegments,
      });
      pinned++;
    }
    expect(pinned).toBe(6);
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
      expect(bodyWithFooter(e.body).endsWith(`\n\n${CORPUS.footer}`)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // L6 — the composer's empty state is UNCHANGED by this fix. `bodyWithFooter`
  // now mirrors the adapter on the empty body (it appends), so the "nothing
  // typed yet" short-circuit moved up into `estimateSmsCost`. The composer must
  // still show 0 chars / 0 segments / 0 cost before you type, and a photo-only
  // MMS must still bill one message per recipient.
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
  // L7 — the defect, stated in the composer's own terms: a campaign body that
  // merely mentions the phrase must be costed on the body that actually ships.
  // -------------------------------------------------------------------------
  it("L7 — a body mentioning 'reply stop' is costed on the WIRE body, not the shorter one", () => {
    const entry = CORPUS.entries.find((e) => e.id === "gsm7-boundary-137-mention");
    expect(entry).toBeDefined();
    const body = (entry as CorpusEntry).body;
    const est = estimateSmsCost(body, 1000);
    const wire = serverComposeSmsBody(body, true);
    // The estimate is computed on the full wire body...
    expect(est.charCount).toBe(wire.length);
    // ...which is TWO segments, not the one the loose guard reported.
    expect(est.segmentsPerRecipient).toBe(2);
    expect(est.totalSegments).toBe(2000);
    expect(est.estimatedCostMinor).toBe(2000);
  });
});

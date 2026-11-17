// ORCH-1167-R2 [event-page-canonical layout polish] — implementor-owned
// happy-path regression for the 6 Seth-directed UI revisions.
//
// These are LAYOUT/STRUCTURE changes to the ONE shared body + its host adapters,
// so the regression is a SOURCE-STRUCTURAL contract (the strict-grep 9-section
// gate already asserts section ORDER; this asserts the R2 deltas). Each assertion
// is fails-on-revert: deleting the corresponding fix line flips the assertion.
//
// FAILS-ON-REVERT (proven by TRUE LINE DELETION in the implementation report):
//   • Change 1 — re-add the `styles.eyebrow` <Text> above the title in
//     EventOfferingBody → the "no date eyebrow above the title" assertion FAILS.
//   • Change 2 — re-add the `cityCountry` MetaChip to the metaRow → the "no
//     venue/city pill in the meta row" assertion FAILS.
//   • Change 4 — make `floatingPillVisible` conditional again (not `true`) in
//     either host → the "floating bar persistent" assertion FAILS.
//   • Change 5 — remove `EventTicketBox` export / `hideTicketBox` prop → FAILS.
//   • Change 6 — drop `contentBottomInset`/`reserveBarClearance` insets → FAILS.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const BODY = "packages/offering-rendering/EventOfferingBody.tsx";
const INDEX = "packages/offering-rendering/index.ts";
const WEB = "mingla-business/src/components/event/PublicEventPage.tsx";
const FOUNDATION = "mingla-business/src/components/event/FoundationEventPreview.tsx";
const CONSUMER = "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx";

// Strip block + line comments so assertions hit real code, not the explanatory
// prose in the change comments (which themselves mention the removed elements).
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("ORCH-1167-R2 — event-page layout polish (source-structural)", () => {
  const body = stripComments(read(BODY));
  const index = read(INDEX);

  it("change 1 — NO date eyebrow <Text> above the event title in the body", () => {
    // The removed eyebrow rendered `styles.eyebrow` with `event.dateLine`. After
    // the fix the lead block renders ONLY the title; `styles.eyebrow` is no longer
    // applied to any rendered element.
    expect(body).not.toMatch(/style=\{\[styles\.eyebrow/);
    // The date still appears ONCE — as a meta chip (section 3).
    expect(body).toMatch(/event\.dateLine/);
  });

  it("change 2 — NO venue/city pill in the meta row (city stays in section 8)", () => {
    // The removed pill was a MetaChip rendering `cityCountry` with the ⌖ glyph.
    // After the fix the metaRow renders only date + subline MetaChips; cityCountry
    // is referenced ONLY by the venue copy (section 8), never by a MetaChip.
    expect(body).not.toMatch(/<MetaChip[^>]*>\s*\{cityCountry\}/s);
    // The city is still derived + used by the "Where you'll be" venue copy.
    expect(body).toMatch(/cityCountry/);
  });

  it("change 3 — the date and the tags read as ONE fact block (issue #4420)", () => {
    // The pills + date band became the shared fact rows with the tag line
    // under them, rendered by ONE OfferingFactRows (no separate bands).
    expect(body.match(/<OfferingFactRows\b/g)?.length).toBe(1);
    expect(body).toMatch(/<OfferingFactRows[\s\S]*?facts=\{facts\}[\s\S]*?tags=\{tagLine\}/);
  });

  it("change 4 — the floating Get-tickets bar is PERSISTENT on both hosts", () => {
    const web = stripComments(read(WEB));
    const consumer = stripComments(read(CONSUMER));
    // Both hosts set the bar visible unconditionally (was a scroll/dock predicate).
    expect(web).toMatch(/floatingPillVisible\s*=\s*true/);
    expect(consumer).toMatch(/floatingPillVisible\s*=\s*true/);
    // The floating bar is still rendered (and still gated off desktop on web).
    expect(web).toMatch(/EventOfferingFloatingBar/);
    expect(consumer).toMatch(/EventOfferingFloatingBar/);
  });

  it("change 5 — EventTicketBox is exported + the body has hideTicketBox", () => {
    expect(index).toMatch(/EventTicketBox/);
    expect(index).toMatch(/EventTicketBoxProps/);
    expect(body).toMatch(/hideTicketBox/);
    expect(body).toMatch(/onTicketBoxLayout/);
    // issue #4420 — the premium frame keeps the ticket cards INLINE on every
    // width (desktop: the right column), hiding them only when sales are
    // closed, and the glass bar is the one place to continue.
    const web = stripComments(read(WEB));
    expect(web).toMatch(/hideTicketBox=\{acquisitionState\.kind !== "current"\}/);
    expect(web).toMatch(/inlineProceed=\{false\}/);
    expect(web).not.toMatch(/hideTicketBox=\{isDesktop/);
  });

  it("change 6 — bottom inset clears the floating bar on both hosts", () => {
    const web = stripComments(read(WEB));
    const consumer = stripComments(read(CONSUMER));
    const foundation = stripComments(read(FOUNDATION));
    // Web passes a non-zero phone inset = bar clearance + safe-area bottom.
    expect(web).toMatch(/FLOATING_BAR_CLEARANCE/);
    expect(web).toMatch(/contentBottomInset=\{[^}]*insets\.bottom/);
    // Foundation forwards contentBottomInset to the shell.
    expect(foundation).toMatch(/contentBottomInset/);
    // Consumer clears the bar with safe-area bottom in its scroll padding.
    expect(consumer).toMatch(/reserveBarClearance\s*=\s*\d+\s*\+\s*insets\.bottom/);
  });
});
